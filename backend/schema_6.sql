-- =====================================================================
-- Zoom Clone - SQLite schema (final, revision 6)
-- 4 tables:  users 1--N meetings 1--N meeting_participants
--                          meetings 1--N meeting_attachments
--
-- Revision 6 = schema_5.sql plus meeting_participants.last_seen_at: when
-- each browser last checked in. A browser in a meeting checks in every few
-- seconds; one that goes silent (its tab was closed without Leave) is
-- checked out as if it had left, so meetings no longer stay 'live' forever.
-- Only meeting_participants changes. A database built from schema_5.sql is
-- upgraded by rebuilding meeting_participants once (SQLite cannot add a
-- column with a CURRENT_TIMESTAMP default), copying every row unchanged;
-- last_seen_at starts at the upgrade time (backend/app/db/migrations.py).
--
-- Revision 5 = schema_4.sql plus the participant status 'waiting', so
-- meetings.waiting_room_enabled is enforced: a participant waits until the
-- host admits them. Only meeting_participants changes: its status CHECK,
-- its lifecycle CHECK and the one-row-per-browser index now include
-- 'waiting'; 'joined', 'left' and 'removed' keep their meaning. A database
-- built from schema_4.sql is upgraded by rebuilding meeting_participants
-- once, copying every row unchanged (backend/app/db/migrations.py).
--
-- Revision 4 = schema_3.sql plus meetings.meeting_id_type: a scheduled
-- meeting is joined either by its own generated 11-digit meeting_code or
-- by its host's 10-digit Personal Meeting ID. Every table, column,
-- constraint and index of schema_3.sql is kept unchanged. A database built
-- from schema_3.sql is upgraded by adding the column (every existing
-- meeting is 'generated') and its index (backend/app/db/migrations.py).
--
-- Revision 3 = schema_2.sql plus users.personal_meeting_id, the user's
-- permanent 10-digit Personal Meeting ID (PMI). Every table, column,
-- constraint and index of schema_2.sql is kept unchanged. A database
-- built from schema_2.sql is upgraded by rebuilding users once and giving
-- every existing user a PMI (backend/app/db/migrations.py).
--
-- Revision 2 = schema_1.sql plus the settings the Schedule / Manage
-- Meeting pages save (passcode, waiting room, encryption, notes, video
-- defaults, template) and meeting_attachments (whiteboards and docs).
-- Every table, column, constraint and index of schema_1.sql is kept
-- unchanged.
--
-- Conventions
--   * Timestamps are UTC text, space-separated: 'YYYY-MM-DD HH:MM:SS'.
--     Write them through ONE code path and never store the ISO 'T' form:
--     the CHECKs and ORDER BYs compare timestamps as strings, which is
--     only correct when every value has the same format.
--     Convert to the user's timezone in the frontend.
--   * Booleans are INTEGER 0/1, enforced by CHECK (x IN (0, 1)).
--   * Integer ids are internal. The public identifier of a meeting is
--     meeting_code (11 digits), and of a user personal_meeting_id
--     (10 digits), so sequential ids never appear in a URL.
--   * SQLite does NOT enforce foreign keys unless this pragma is set on
--     EVERY connection (do it in the ORM's connect hook).
--   * SQLite does not refresh updated_at by itself. The ORM owns it
--     (SQLAlchemy onupdate=..., Django auto_now=True).
--   * Derived, never stored: the invite link ({FRONTEND_URL}/j/{code})
--     and the "Add to calendar" links (Google, Outlook, Yahoo, .ics),
--     which are built from title, description, start, duration,
--     timezone and the invite link whenever they are shown.
--
-- Assumptions (copy into the README)
--   * Sign-in has no password: a browser signs in with a name and email
--     and then identifies itself by that user's id.
--   * Every meeting gets a freshly generated ID and runs once:
--     scheduled -> live -> ended. An ended meeting is not restarted.
--   * Meeting settings are stored as they are saved; enforcing them at
--     join time (passcode check, video defaults) is application logic.
--   * A live meeting ends by itself at its time limit: a scheduled meeting
--     duration_minutes after it started, an instant meeting 40 minutes
--     after (application logic; nothing extra is stored).
--   * Out of scope: instant meetings on the Personal Meeting ID (only
--     scheduled meetings may use it), recurring meetings, chat,
--     recordings, transcription, calendar integrations, and storing
--     audio/video/WebRTC state.
-- =====================================================================
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- users  (schema_1.sql plus personal_meeting_id, new in revision 3)
-- Seeded with one default user who is treated as logged in.
-- password_hash stays NULL until the login bonus is built, so adding
-- authentication later needs no migration.
--
-- personal_meeting_id : the user's Personal Meeting ID (PMI). Exactly 10
--                       digits, one per user, never changed once assigned.
--                       Not the same thing as meetings.meeting_code, which
--                       has 11 digits and is new for every meeting. TEXT,
--                       not INTEGER, so leading zeros are kept (any 10
--                       digits are valid). The backend generates it
--                       randomly when it creates the user and retries on
--                       the rare UNIQUE collision; it is never derived
--                       from id, email, time or a meeting code.
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    personal_meeting_id TEXT NOT NULL UNIQUE
                        CHECK (length(personal_meeting_id) = 10
                               AND personal_meeting_id NOT GLOB '*[^0-9]*'),
    display_name  TEXT    NOT NULL CHECK (length(trim(display_name)) > 0),
    avatar_url    TEXT,
    password_hash TEXT,
    timezone      TEXT    NOT NULL DEFAULT 'Asia/Kolkata',   -- IANA name
    created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- meetings
-- One table for instant and scheduled meetings: they differ only in the
-- two schedule columns, and the dashboard lists them together.
--
-- meeting_code : Zoom-style 11-digit id. TEXT, not INTEGER, because it is
--                an identifier (shown as "851 2345 6789"), not a number.
--                The backend generates it randomly and retries on the
--                rare UNIQUE collision.
-- invite link  : NOT stored. Derived as {FRONTEND_URL}/j/{public id},
--                so links never go stale when the deploy domain changes.
-- meeting_id_type (new in revision 4): which ID people use to join.
--                'generated' : the meeting's own meeting_code (11 digits).
--                'personal'  : the host's users.personal_meeting_id (10
--                              digits), read through host_id and never
--                              copied here, so it cannot drift from the
--                              user's permanent PMI. Scheduled meetings
--                              only. Every meeting still has its own
--                              unique meeting_code: it is the row's stable
--                              key (the owner's Manage/Edit/Delete links),
--                              and switching back to 'generated' reuses it.
--                Many meetings can share one PMI, as in Zoom; the PMI
--                resolves to the host's live personal meeting, else the
--                next upcoming one, so at most one may be live at a time
--                (uq_meetings_one_live_personal_per_host). The column is
--                last because revision 4 adds it with ALTER TABLE.
-- scheduled_start_at / duration_minutes : the PLAN.
-- started_at / ended_at                 : what ACTUALLY happened.
-- status       : has no default on purpose. An instant meeting is created
--                'live', a scheduled one 'scheduled', so every insert
--                must say which. 'cancelled' = called off before it
--                started; the Delete button removes the row instead.
--
-- Settings (new in revision 2). One meeting has exactly one set of
-- settings, so they are columns here rather than a separate table. The
-- defaults keep every schema_1 insert valid and change no behavior:
-- no passcode, no waiting room, enhanced encryption, notes off, video off.
--
-- passcode            : NULL = no passcode. Zoom's rule: 1-10 characters,
--                       letters, digits and @ * _ - only. Stored as typed
--                       because the host sees it on the details page and
--                       it is part of the invite; it is a meeting passcode,
--                       not an account password. Only the host may read it.
--                       Joining asks for it only for a scheduled meeting;
--                       an instant meeting always gets one, but anyone with
--                       its link or ID joins without typing it.
-- waiting_room_enabled: joiners wait until the host admits them. Stored
--                       only: admitting people needs a participant state
--                       that schema_1 does not have (see SCHEMA_2_REVIEW.md).
-- encryption_mode     : 'enhanced' (Zoom's default) or 'end_to_end'.
-- notes_enabled /     : meeting notes on or off, and who can access them:
-- notes_scope           'organization_only' (only participants in the host's
--                       organization) or 'all_participants'. A scope is
--                       required exactly when notes are on.
-- host_video_enabled /: whether video starts on when the host / other
-- participant_video_enabled  participants join (seeds is_video_on at join).
-- template            : key of the meeting template chosen in the
--                       scheduler (NULL = none). The template catalog lives
--                       in the frontend; the key is stored so the details
--                       page can show it. Lowercase slug, at most 64 chars.
-- ---------------------------------------------------------------------
CREATE TABLE meetings (
    id                 INTEGER PRIMARY KEY,
    meeting_code       TEXT    NOT NULL UNIQUE
                       CHECK (length(meeting_code) = 11
                              AND meeting_code NOT GLOB '*[^0-9]*'),
    host_id            INTEGER NOT NULL
                       REFERENCES users(id) ON DELETE CASCADE,
    title              TEXT    NOT NULL CHECK (length(trim(title)) > 0),
    description        TEXT,
    meeting_type       TEXT    NOT NULL
                       CHECK (meeting_type IN ('instant', 'scheduled')),
    status             TEXT    NOT NULL
                       CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
    scheduled_start_at TEXT,
    duration_minutes   INTEGER CHECK (duration_minutes BETWEEN 1 AND 1440),
    timezone           TEXT    NOT NULL DEFAULT 'Asia/Kolkata',

    -- settings (revision 2)
    passcode                  TEXT
                              CHECK (passcode IS NULL
                                     OR (length(passcode) BETWEEN 1 AND 10
                                         AND passcode NOT GLOB '*[^A-Za-z0-9@*_-]*')),
    waiting_room_enabled      INTEGER NOT NULL DEFAULT 0
                              CHECK (waiting_room_enabled IN (0, 1)),
    encryption_mode           TEXT    NOT NULL DEFAULT 'enhanced'
                              CHECK (encryption_mode IN ('enhanced', 'end_to_end')),
    notes_enabled             INTEGER NOT NULL DEFAULT 0
                              CHECK (notes_enabled IN (0, 1)),
    notes_scope               TEXT
                              CHECK (notes_scope IN ('organization_only', 'all_participants')),
    host_video_enabled        INTEGER NOT NULL DEFAULT 0
                              CHECK (host_video_enabled IN (0, 1)),
    participant_video_enabled INTEGER NOT NULL DEFAULT 0
                              CHECK (participant_video_enabled IN (0, 1)),
    template                  TEXT
                              CHECK (template IS NULL
                                     OR (length(template) BETWEEN 1 AND 64
                                         AND template NOT GLOB '*[^a-z0-9_-]*')),

    started_at         TEXT,
    ended_at           TEXT,
    created_at         TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- revision 4
    meeting_id_type    TEXT    NOT NULL DEFAULT 'generated'
                       CHECK (meeting_id_type = 'generated'
                              OR (meeting_id_type = 'personal'
                                  AND meeting_type = 'scheduled')),

    -- scheduled meetings carry a plan; instant meetings never do
    CONSTRAINT ck_meetings_type_schedule CHECK (
           (meeting_type = 'scheduled' AND scheduled_start_at IS NOT NULL
                                       AND duration_minutes   IS NOT NULL)
        OR (meeting_type = 'instant'   AND scheduled_start_at IS NULL
                                       AND duration_minutes   IS NULL)
    ),
    -- an instant meeting starts the moment it is created
    CONSTRAINT ck_meetings_instant_starts_live CHECK (
        meeting_type = 'scheduled' OR status IN ('live', 'ended')
    ),
    -- one row per allowed state: status and timestamps cannot disagree
    CONSTRAINT ck_meetings_lifecycle CHECK (
           (status IN ('scheduled', 'cancelled')
                AND started_at IS NULL     AND ended_at IS NULL)
        OR (status = 'live'
                AND started_at IS NOT NULL AND ended_at IS NULL)
        OR (status = 'ended'
                AND started_at IS NOT NULL AND ended_at IS NOT NULL
                AND ended_at >= started_at)
    ),
    -- notes have a scope exactly when they are enabled (revision 2)
    CONSTRAINT ck_meetings_notes_scope CHECK (
           (notes_enabled = 0 AND notes_scope IS NULL)
        OR (notes_enabled = 1 AND notes_scope IS NOT NULL)
    )
);

-- Upcoming section: host_id = ? AND status IN ('scheduled', 'live')
CREATE INDEX idx_meetings_host_status_start
    ON meetings (host_id, status, scheduled_start_at);

-- Recent section: host_id = ? AND status = 'ended' ORDER BY ended_at DESC
CREATE INDEX idx_meetings_host_ended
    ON meetings (host_id, ended_at DESC)
    WHERE status = 'ended';

-- A PMI names one meeting at a time: at most one live personal meeting
-- per host (revision 4).
CREATE UNIQUE INDEX uq_meetings_one_live_personal_per_host
    ON meetings (host_id)
    WHERE meeting_id_type = 'personal' AND status = 'live';

-- ---------------------------------------------------------------------
-- meeting_participants  (schema_1.sql plus status 'waiting', revision 5,
--                        and last_seen_at, revision 6)
-- One row per JOIN (not per person), so leaving and rejoining keeps a
-- full attendance history.
--
-- user_id      : the account that joined. NULL for a visitor with no
--                account (possible once login exists). Without login it
--                is the default user in every browser, so it cannot tell
--                two people apart - client_token does that.
-- client_token : random UUID created by the browser on first visit and
--                kept in localStorage. It identifies one browser, which
--                lets a page refresh reuse its row instead of creating a
--                duplicate, stops a removed participant from rejoining,
--                and proves who is calling "leave".
--                It is a secret: NEVER return it in the participant list.
-- display_name : the name typed on the "enter your name" screen. A
--                snapshot, deliberately not read from users, because a
--                person may join under any name.
-- role         : the host is whoever starts the meeting, so it is stored
--                here; it cannot be derived from user_id without login.
-- is_muted / status = 'removed' : back the host-control bonus
--                (mute all / remove participant).
-- status       : 'waiting' (revision 5) = in the meeting's waiting room,
--                not yet admitted: when waiting_room_enabled, everyone but
--                the host enters this way. Not in the room, so not counted
--                as joined; the host admits (waiting -> joined), removes
--                (-> removed) or sends someone back (joined -> waiting).
--                'joined' = in the room. 'left' / 'removed' = gone, with
--                left_at. joined_at is when the row entered its current
--                waiting or joined state.
-- last_seen_at : (revision 6) when this browser last checked in; it checks
--                in every few seconds while waiting or in the room. A
--                waiting or joined row not seen for 90 seconds is checked
--                out as 'left', exactly like Leave (the host role passes on,
--                and the last one out ends the meeting).
-- ---------------------------------------------------------------------
CREATE TABLE meeting_participants (
    id           INTEGER PRIMARY KEY,
    meeting_id   INTEGER NOT NULL
                 REFERENCES meetings(id) ON DELETE CASCADE,
    user_id      INTEGER
                 REFERENCES users(id) ON DELETE SET NULL,
    client_token TEXT    NOT NULL CHECK (length(client_token) >= 16),
    display_name TEXT    NOT NULL CHECK (length(trim(display_name)) > 0),
    role         TEXT    NOT NULL DEFAULT 'participant'
                 CHECK (role IN ('host', 'participant')),
    status       TEXT    NOT NULL DEFAULT 'joined'
                 CHECK (status IN ('waiting', 'joined', 'left', 'removed')),
    is_muted     INTEGER NOT NULL DEFAULT 1 CHECK (is_muted IN (0, 1)),
    is_video_on  INTEGER NOT NULL DEFAULT 0 CHECK (is_video_on IN (0, 1)),
    joined_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at      TEXT,
    last_seen_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- revision 6

    -- waiting or in the room = no left_at; left or removed = has a left_at
    CONSTRAINT ck_participants_lifecycle CHECK (
           (status IN ('waiting', 'joined') AND left_at IS NULL)
        OR (status IN ('left', 'removed')
                AND left_at IS NOT NULL AND left_at >= joined_at)
    )
);

-- Roster of a meeting (and the lookups by meeting in the join flow)
CREATE INDEX idx_participants_meeting_status
    ON meeting_participants (meeting_id, status);

-- "Meetings I attended" for the Recent section
CREATE INDEX idx_participants_user_meeting
    ON meeting_participants (user_id, meeting_id);

-- One browser can be in a given meeting (waiting or joined) only once at a time
CREATE UNIQUE INDEX uq_participants_one_active_per_client
    ON meeting_participants (meeting_id, client_token)
    WHERE status IN ('waiting', 'joined');

-- A meeting has at most one host in the room at a time
CREATE UNIQUE INDEX uq_participants_one_active_host
    ON meeting_participants (meeting_id)
    WHERE status = 'joined' AND role = 'host';

-- ---------------------------------------------------------------------
-- meeting_attachments  (new in revision 2)
-- Whiteboards and docs attached to a meeting in the scheduler, listed on
-- the Manage Meeting page. A row records the attachment itself (kind and
-- name); whiteboard drawing and document editing are not part of this
-- schema. Attachments are configuration, not history: removing one
-- deletes its row, and deleting the meeting deletes them all.
-- ---------------------------------------------------------------------
CREATE TABLE meeting_attachments (
    id          INTEGER PRIMARY KEY,
    meeting_id  INTEGER NOT NULL
                REFERENCES meetings(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL CHECK (kind IN ('whiteboard', 'doc')),
    title       TEXT    NOT NULL CHECK (length(trim(title)) > 0),
    created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Attachments of a meeting, in the order they were added
CREATE INDEX idx_attachments_meeting
    ON meeting_attachments (meeting_id, id);


-- =====================================================================
-- Seed data (times are relative to "now", so the dashboard always has
-- upcoming and recent meetings whenever the database is rebuilt).
-- The schema_1 rows are unchanged; meeting 2 additionally carries saved
-- settings and two attachments, so the Manage Meeting page has a fully
-- configured example.
-- =====================================================================
-- Fixed PMIs keep a rebuilt database reproducible (new users get random ones).
INSERT INTO users (id, email, personal_meeting_id, display_name) VALUES
    (1, 'default.user@example.com', '4827319051', 'Default User'),      -- the "logged-in" user
    (2, 'priya.sharma@example.com', '6382719045', 'Priya Sharma'),
    (3, 'arjun.mehta@example.com',  '7150462938', 'Arjun Mehta');

INSERT INTO meetings
    (id, meeting_code, host_id, title, description, meeting_type,
     status, scheduled_start_at, duration_minutes, started_at, ended_at)
VALUES
    -- upcoming
    (1, '85123456789', 1, 'Weekly Team Sync', 'Sprint progress and blockers',
     'scheduled', 'scheduled', datetime('now', '+1 day'), 30, NULL, NULL);

-- upcoming, fully configured (same plan as in schema_1.sql)
INSERT INTO meetings
    (id, meeting_code, host_id, title, description, meeting_type,
     status, scheduled_start_at, duration_minutes, started_at, ended_at,
     passcode, waiting_room_enabled, encryption_mode, notes_enabled,
     notes_scope, host_video_enabled, participant_video_enabled, template)
VALUES
    (2, '86234567890', 1, 'Design Review', 'Review the new dashboard mockups',
     'scheduled', 'scheduled', datetime('now', '+3 days'), 60, NULL, NULL,
     'Rv7@x2', 1, 'enhanced', 1,
     'all_participants', 1, 0, NULL);

INSERT INTO meetings
    (id, meeting_code, host_id, title, description, meeting_type,
     status, scheduled_start_at, duration_minutes, started_at, ended_at)
VALUES
    -- recent
    (3, '87345678901', 1, 'Project Kickoff', 'Scope and timeline',
     'scheduled', 'ended', datetime('now', '-2 days'), 45,
     datetime('now', '-2 days'), datetime('now', '-2 days', '+42 minutes')),
    (4, '88456789012', 1, 'Default User''s Zoom Meeting', NULL,
     'instant', 'ended', NULL, NULL,
     datetime('now', '-1 day'), datetime('now', '-1 day', '+18 minutes')),
    -- hosted by someone else, attended by the default user
    (5, '89567890123', 2, 'Client Demo', 'Walkthrough for the client',
     'scheduled', 'ended', datetime('now', '-5 days'), 30,
     datetime('now', '-5 days'), datetime('now', '-5 days', '+33 minutes'));

-- one client_token per browser: the same person keeps the same token
INSERT INTO meeting_participants
    (meeting_id, user_id, client_token, display_name, role, status, joined_at, left_at)
VALUES
    (3, 1,    'seed-browser-0001-default-user', 'Default User', 'host',        'left', datetime('now', '-2 days'), datetime('now', '-2 days', '+42 minutes')),
    (3, 2,    'seed-browser-0002-priya-sharma', 'Priya Sharma', 'participant', 'left', datetime('now', '-2 days', '+1 minute'), datetime('now', '-2 days', '+42 minutes')),
    (3, 3,    'seed-browser-0003-arjun-mehta',  'Arjun Mehta',  'participant', 'left', datetime('now', '-2 days', '+3 minutes'), datetime('now', '-2 days', '+40 minutes')),
    (4, 1,    'seed-browser-0001-default-user', 'Default User', 'host',        'left', datetime('now', '-1 day'), datetime('now', '-1 day', '+18 minutes')),
    (4, NULL, 'seed-browser-0004-guest-rahul',  'Guest Rahul',  'participant', 'left', datetime('now', '-1 day', '+2 minutes'), datetime('now', '-1 day', '+18 minutes')),
    (5, 2,    'seed-browser-0002-priya-sharma', 'Priya Sharma', 'host',        'left', datetime('now', '-5 days'), datetime('now', '-5 days', '+33 minutes')),
    (5, 1,    'seed-browser-0001-default-user', 'Default User', 'participant', 'left', datetime('now', '-5 days', '+1 minute'), datetime('now', '-5 days', '+33 minutes'));

INSERT INTO meeting_attachments (meeting_id, kind, title) VALUES
    (2, 'whiteboard', 'Dashboard wireframes'),
    (2, 'doc',        'Design review agenda');


-- =====================================================================
-- Reference queries (:me = 1)
-- =====================================================================
-- DASHBOARD -----------------------------------------------------------
-- Upcoming: anything in progress, plus scheduled meetings whose planned
-- end has not passed yet. Live meetings come first.
--   SELECT * FROM meetings
--   WHERE host_id = :me
--     AND (status = 'live'
--          OR (status = 'scheduled'
--              AND datetime(scheduled_start_at, '+' || duration_minutes || ' minutes')
--                  >= datetime('now')))
--   ORDER BY status = 'live' DESC, COALESCE(scheduled_start_at, started_at);
--
-- Recent: ended meetings I hosted OR attended
--   SELECT m.* FROM meetings m
--   WHERE m.status = 'ended'
--     AND (m.host_id = :me
--          OR EXISTS (SELECT 1 FROM meeting_participants p
--                     WHERE p.user_id = :me AND p.meeting_id = m.id))
--   ORDER BY m.ended_at DESC LIMIT 10;
--
-- MEETING LIFECYCLE ---------------------------------------------------
-- New Meeting (instant): created already live (settings take their defaults)
--   INSERT INTO meetings (meeting_code, host_id, title, meeting_type, status, started_at)
--   VALUES (:code, :me, :title, 'instant', 'live', CURRENT_TIMESTAMP);
--
-- Schedule Meeting (plan + settings in one row)
--   INSERT INTO meetings (meeting_code, host_id, title, description, meeting_type,
--                         status, scheduled_start_at, duration_minutes, timezone,
--                         passcode, waiting_room_enabled, encryption_mode,
--                         notes_enabled, notes_scope, host_video_enabled,
--                         participant_video_enabled, template)
--   VALUES (:code, :me, :title, :description, 'scheduled',
--           'scheduled', :start_utc, :duration, :timezone,
--           :passcode, :waiting_room, :encryption, :notes, :notes_scope,
--           :host_video, :participant_video, :template);
--   INSERT INTO meeting_attachments (meeting_id, kind, title)
--   VALUES (:id, :kind, :title);                      -- once per attachment
--
-- Manage Meeting page: everything that was saved
--   SELECT * FROM meetings WHERE meeting_code = :code;
--   SELECT id, kind, title FROM meeting_attachments
--   WHERE meeting_id = :id ORDER BY id;
--
-- Edit a meeting before it starts (the ORM also sets updated_at)
--   UPDATE meetings SET title = :title, description = :description,
--          scheduled_start_at = :start_utc, duration_minutes = :duration,
--          timezone = :timezone, passcode = :passcode, ... , template = :template
--   WHERE id = :id AND status = 'scheduled';
--   DELETE FROM meeting_attachments WHERE id = :attachment_id AND meeting_id = :id;
--
-- Start a scheduled meeting
--   UPDATE meetings SET status = 'live', started_at = CURRENT_TIMESTAMP
--   WHERE id = :id AND status = 'scheduled';
--
-- End a meeting (both statements in ONE transaction). Also run when the
-- last participant leaves (or goes silent) and at the time limit.
--   UPDATE meeting_participants SET status = 'left', left_at = CURRENT_TIMESTAMP
--   WHERE meeting_id = :id AND status = 'joined';
--   UPDATE meetings SET status = 'ended', ended_at = CURRENT_TIMESTAMP
--   WHERE id = :id AND status = 'live';
--
-- JOIN FLOW -----------------------------------------------------------
-- 1. Validate the meeting exists and can be joined
--   SELECT id, title, status, passcode FROM meetings
--   WHERE meeting_code = :code AND status IN ('scheduled', 'live');
--
--    A 10-digit ID is a Personal Meeting ID (revision 4): the host's live
--    personal meeting, else the next one that has not finished.
--   SELECT m.* FROM meetings m JOIN users u ON u.id = m.host_id
--   WHERE u.personal_meeting_id = :pmi AND m.meeting_id_type = 'personal'
--     AND (m.status = 'live'
--          OR (m.status = 'scheduled'
--              AND datetime(m.scheduled_start_at, '+' || m.duration_minutes || ' minutes')
--                  >= datetime('now')))
--   ORDER BY m.status = 'live' DESC, m.scheduled_start_at, m.id LIMIT 1;
--
--    If passcode IS NOT NULL and meeting_type = 'scheduled', the browser
--    must supply it (compare in the application). An instant meeting's
--    passcode is not asked for.
--
-- 2. Was this browser removed by the host? Then refuse.
--   SELECT 1 FROM meeting_participants
--   WHERE meeting_id = :id AND client_token = :token AND status = 'removed';
--
-- 3. Already waiting or in the room (page refresh)? Then reuse that row.
--   SELECT id FROM meeting_participants
--   WHERE meeting_id = :id AND client_token = :token AND status IN ('waiting', 'joined');
--
-- 4. Otherwise join. role = 'host' only when starting the meeting and no
--    host is currently in the room. is_video_on starts from the meeting's
--    host_video_enabled / participant_video_enabled setting. With
--    waiting_room_enabled, everyone but the host gets status = 'waiting'
--    until the host admits them (revision 5).
--   INSERT INTO meeting_participants (meeting_id, user_id, client_token, display_name, role, is_video_on)
--   VALUES (:id, :me, :token, :display_name, :role, :video_on);
--
-- Leave
--   UPDATE meeting_participants SET status = 'left', left_at = CURRENT_TIMESTAMP
--   WHERE meeting_id = :id AND client_token = :token AND status = 'joined';
--
-- PRESENCE AND TIME LIMIT (revision 6) ---------------------------------
-- Check in (every poll of a browser that is waiting or in the room)
--   UPDATE meeting_participants SET last_seen_at = CURRENT_TIMESTAMP
--   WHERE meeting_id = :id AND client_token = :token AND status IN ('waiting', 'joined');
--
-- Silent browsers: each is checked out like Leave above
--   SELECT client_token FROM meeting_participants
--   WHERE meeting_id = :id AND status IN ('waiting', 'joined')
--     AND last_seen_at < datetime('now', '-90 seconds');
--
-- Live meetings past their time limit (then End a meeting, above)
--   SELECT id FROM meetings
--   WHERE status = 'live'
--     AND datetime(started_at, '+' || COALESCE(duration_minutes, 40) || ' minutes')
--         <= datetime('now');
--
-- HOST CONTROLS (bonus) -----------------------------------------------
-- Mute all
--   UPDATE meeting_participants SET is_muted = 1
--   WHERE meeting_id = :id AND status = 'joined' AND role <> 'host';
--
-- Remove participant
--   UPDATE meeting_participants SET status = 'removed', left_at = CURRENT_TIMESTAMP
--   WHERE id = :participant_id AND meeting_id = :id AND status = 'joined';
