# Zoom Clone

A Zoom-style meetings app: sign in, host an instant meeting, schedule meetings, share an
invite link or Meeting ID, and run the meeting room with a waiting room, host controls,
chat and reactions.

Audio and video are not streamed; the meeting room keeps everyone's state (who is in,
muted, host, waiting) in sync through the API.

## Features

- Sign in with name and email (no password)
- Host an instant meeting; join with the invite link (`/j/<id>`) or the Meeting ID
- Instant meetings get a passcode for the invite, but guests join without typing it;
  scheduled meetings ask for theirs
- Schedule, edit and delete meetings (Personal Meeting ID or a generated ID, waiting room,
  passcode, video defaults, attachments); add to Google / Outlook / Yahoo calendar
- Meeting room: gallery view, mute / video toggles, participants panel, invite dialog,
  meeting chat (local only), reactions, raise hand, be right back
- Waiting room and host controls: admit, move to waiting room, rename, make host, remove,
  mute all, end for all; the host role passes on automatically when the host leaves
- Minimized floating meeting window while you browse the rest of the app
- Meetings end by themselves: scheduled meetings when their duration is up, instant meetings
  after 40 minutes; the host is warned in the last 10 minutes
- Browsers that close without leaving are checked out after 90 seconds

## Tech stack

| Layer    | Technology                                  |
| -------- | ------------------------------------------- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Backend  | Python 3.11+, FastAPI, Uvicorn, Pydantic    |
| Database | SQLite via SQLAlchemy 2.1                   |

## Database schema

SQLite, four tables (full definition with constraints and sample queries in `backend/schema_6.sql`):

```
users 1──N meetings 1──N meeting_participants
              meetings 1──N meeting_attachments
users 1──N meeting_participants (nullable: guests have no account)
```

| Table | Purpose | Key columns |
| ----- | ------- | ----------- |
| `users` | Accounts | `email` (unique), `display_name`, `personal_meeting_id` (unique 10 digits), `timezone` |
| `meetings` | Instant and scheduled meetings in one table | `meeting_code` (unique 11 digits), `host_id` → users, `meeting_type`, `status` (scheduled / live / ended / cancelled), `scheduled_start_at`, `duration_minutes`, `started_at`, `ended_at`, settings (`passcode`, `waiting_room_enabled`, video defaults, ...) |
| `meeting_participants` | One row per join, so leaving and rejoining keeps attendance history | `meeting_id` → meetings, `user_id` → users (nullable), `client_token` (one browser), `display_name`, `role` (host / participant), `status` (waiting / joined / left / removed), `is_muted`, `joined_at`, `left_at`, `last_seen_at` |
| `meeting_attachments` | Whiteboards and docs added when scheduling | `meeting_id` → meetings, `kind`, `title` |

Rules are enforced by the database itself: CHECK constraints keep each meeting's status and
timestamps consistent (a live meeting has `started_at` and no `ended_at`, an instant meeting has no
schedule, ...), and partial unique indexes allow at most one host in the room and one active row per
browser in a meeting. Timestamps are stored as UTC text; foreign keys cascade when a meeting is deleted.
The database is created and seeded with sample users and meetings on first start.

## Project structure

```
.
├── frontend/              Next.js app
│   ├── app/               Pages: home, sign in, join, schedule, meetings, meeting room, /j/<id>
│   ├── components/        Header, sidebar, meeting room panels, reactions, icons
│   └── lib/               API client, identity, room session hook
├── backend/               FastAPI app
│   ├── app/api/           Routes (mounted under /api)
│   ├── app/services/      Meeting, participant and user logic
│   ├── app/models/        SQLAlchemy models
│   ├── app/db/            Engine, init, seed data and upgrades of older databases
│   └── schema_6.sql       Database schema
└── render.yaml            Backend deployment on Render
```

## Run locally

Prerequisites: Node.js 20.9+ and Python 3.11+.

Backend (http://localhost:8000, API docs at `/docs`):

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The SQLite database is created in `backend/data/` with sample data on first start.
`python -m app.db.init_db --reset` rebuilds it.

Frontend (http://localhost:3000):

```bash
cd frontend
npm install
npm run dev
```

## Environment variables

Backend:

| Variable       | Default                          | Purpose                                         |
| -------------- | -------------------------------- | ----------------------------------------------- |
| `CORS_ORIGINS` | `http://localhost:3000`          | Comma-separated origins allowed to call the API |
| `FRONTEND_URL` | `http://localhost:3000`          | Used to build invite links                      |
| `DATABASE_URL` | `sqlite:///backend/data/zoom_clone.db` | Database location                        |

Frontend:

| Variable                   | Default                 | Purpose                 |
| -------------------------- | ----------------------- | ----------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | URL of the backend      |

## Assumptions

- **Login:** the assignment assumes a logged-in default user. As a bonus, there is a simple sign-in
  with name and email and no password; the account is remembered in the browser. Opening a meeting
  link while signed out asks you to sign in first and then returns to the meeting.
- **Audio and video are not streamed.** Mute, video, raise hand and the participant list are kept in
  sync through the API (each browser checks in every 3 seconds); there is no WebRTC.
- **Meeting chat and reactions are local:** they show on your own screen only.
- **Passcodes:** instant meetings get a passcode for the invite, but anyone with the link or the
  Meeting ID joins without typing it. Scheduled meetings ask for their passcode.
- **Time limits:** scheduled meetings end when their duration is up, instant meetings after 40
  minutes, like Zoom's free plan.
- **Scheduled meetings** can only be joined after the host starts them; until then guests see a
  "Waiting for the host" screen.
- **One browser = one participant.** Each browser has its own token, so the same account can join
  from two browsers as two participants.
- **Personal Meeting ID:** every user has a permanent 10-digit ID; scheduled meetings can use it
  instead of a generated 11-digit ID.

## Deployment

- **Backend on Render** (free): New → Blueprint → pick this repository; `render.yaml` sets it up.
  Set `FRONTEND_URL` and `CORS_ORIGINS` to the Vercel URL.
- **Frontend on Vercel** (free): import the repository, set Root Directory to `frontend`, and set
  `NEXT_PUBLIC_API_BASE_URL` to the Render URL.

On Render's free plan the service sleeps after 15 minutes without traffic (the first request
then takes about a minute), and its disk is not persistent, so the SQLite data is reset to the
sample data whenever the service restarts or redeploys.
