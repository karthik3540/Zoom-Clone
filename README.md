# Zoom Clone

A Zoom-style video meetings web app: create instant meetings, schedule meetings, join with a Meeting ID
or an invite link, and run the meeting room with a waiting room and host controls. The UI follows the
Zoom web app.

- **Live app:** https://zoom-clone-indol-nu.vercel.app
- **API docs:** https://zoom-clone-api-yyw9.onrender.com/docs

> The backend runs on Render's free plan: after 15 minutes without traffic it sleeps, so the first
> request can take about a minute.

## Features

### Core features

**1. Landing Dashboard**

- ✅ Clean, professional Zoom UI (home dashboard modeled on Zoom Workplace)
- ✅ Navbar with a profile menu (name, email, Sign out); Settings in the meeting sidebar
- ✅ **New Meeting**, **Join** and **Schedule** buttons on the dashboard (the navbar also has Schedule, Join and Host)
- ✅ Upcoming meetings section (dashboard card and the Meetings page)
- ✅ Recent meetings section (dashboard card and the Meetings page "Previous" tab)

**2. Instant Meeting Creation**

- ✅ Create a meeting instantly with **New Meeting**
- ✅ Unique 11-digit Meeting ID, generated randomly and unique in the database
- ✅ Shareable invite link (`/j/<meeting id>`) with Copy Invitation in Zoom's format
- ✅ Opens the meeting room straight away

**3. Join Meeting**

- ✅ Join with a Meeting ID or a pasted invite link (Join page), or by opening the invite link
- ✅ Enter a display name before joining ("Enter Meeting Info" screen)
- ✅ The meeting is looked up first; an unknown ID or link shows an error

**4. Schedule Meetings**

- ✅ Create scheduled meetings
- ✅ Title and description
- ✅ Date picker and time picker, with time zone
- ✅ Duration (hours and minutes)
- ✅ Invite link generated automatically
- ✅ Stored in the database
- ✅ Shown in the Upcoming meetings section

### Bonus features

- ✅ **Responsive design**: phone, tablet and desktop layouts
- ✅ **User authentication**: sign in with an email; a new email signs you up (no password, see Assumptions)
- ✅ **Host controls**: mute all and remove participant, plus admit from the waiting room, move to the
  waiting room, rename, make host and end the meeting for everyone

### Also included

- Edit and delete scheduled meetings; add them to Google, Outlook or Yahoo Calendar
- Personal Meeting ID (permanent 10-digit ID per user) usable for scheduled meetings
- Meeting passcodes and a waiting room
- Meeting room: gallery view, mute and video toggles, participants panel, invite dialog, chat,
  reactions, raise hand and "be right back"
- The host role passes automatically to the next participant when the host leaves
- "Waiting for the host" screen until the host starts a scheduled meeting
- Minimized floating meeting window while browsing the rest of the app
- 40-minute meeting limit with a countdown for the host in the last 10 minutes

## Tech stack

| Layer    | Technology                                       |
| -------- | ------------------------------------------------ |
| Frontend | Next.js 16 (App Router), React 19, TypeScript     |
| Backend  | Python, FastAPI, Uvicorn, Pydantic                |
| Database | SQLite with SQLAlchemy 2.1                        |
| Hosting  | Vercel (frontend), Render (backend)               |

## Database schema

Four tables. The full schema with every constraint, the seed data and example queries is in
[`backend/schema_6.sql`](backend/schema_6.sql).

```
users ──1:N── meetings ──1:N── meeting_participants
                  │
                  └──1:N── meeting_attachments

users ──1:N── meeting_participants   (user_id is empty for guests)
```

| Table | Purpose | Main columns |
| ----- | ------- | ------------ |
| `users` | Accounts | `email` (unique), `display_name`, `personal_meeting_id` (unique, 10 digits), `timezone` |
| `meetings` | Instant and scheduled meetings | `meeting_code` (unique, 11 digits), `host_id` → users, `title`, `description`, `meeting_type` (instant / scheduled), `status` (scheduled / live / ended / cancelled), `scheduled_start_at`, `duration_minutes`, `timezone`, `started_at`, `ended_at`, settings (`passcode`, `waiting_room_enabled`, video defaults, ...) |
| `meeting_participants` | One row per join, so leaving and rejoining keeps the attendance history | `meeting_id` → meetings, `user_id` → users, `display_name`, `role` (host / participant), `status` (waiting / joined / left / removed), `is_muted`, `joined_at`, `left_at`, `last_seen_at` |
| `meeting_attachments` | Whiteboards and docs added when scheduling | `meeting_id` → meetings, `kind`, `title` |

Design notes:

- **The database enforces the rules.** CHECK constraints keep a meeting's status and timestamps
  consistent (for example, a live meeting has a start time and no end time, and an instant meeting has no
  schedule). Partial unique indexes allow at most one host in the room and one active row per browser
  in a meeting.
- **Relationships.** Foreign keys cascade, so deleting a meeting removes its participants and
  attachments.
- **Stable formats.** Timestamps are stored in UTC.
- **Derived, not stored.** Invite links and calendar links are built from the meeting when needed.
- **Seed data.** The database is created and seeded with sample users and meetings on first start.

## Project structure

```
.
├── frontend/                 Next.js app
│   ├── app/                  Pages: home, sign in, join, schedule, meetings, meeting room, /j/<id>
│   ├── components/           Header, sidebar, dashboard cards, meeting room panels, icons
│   └── lib/                  API client, sign-in identity, meeting room session
├── backend/                  FastAPI app
│   ├── app/api/              HTTP routes (under /api)
│   ├── app/services/         Meeting, participant and user logic
│   ├── app/models/           SQLAlchemy models
│   ├── app/schemas/          Request and response models
│   ├── app/db/               Database setup, seed data and upgrades of older databases
│   └── schema_6.sql          Database schema
└── render.yaml               Backend deployment on Render
```

## Run locally

Requirements: Node.js 20.9+ and Python 3.11+.

**Backend** (http://localhost:8000, API docs at http://localhost:8000/docs):

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The SQLite database is created in `backend/data/` with sample data on first start.
To rebuild it from scratch: `python -m app.db.init_db --reset`.

**Frontend** (http://localhost:3000), in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

### Environment variables

| Where    | Variable                   | Default                 | Purpose                                         |
| -------- | -------------------------- | ----------------------- | ----------------------------------------------- |
| Backend  | `CORS_ORIGINS`             | `http://localhost:3000` | Comma-separated origins allowed to call the API |
| Backend  | `FRONTEND_URL`             | `http://localhost:3000` | Used to build invite links                      |
| Backend  | `DATABASE_URL`             | `backend/data/zoom_clone.db` | SQLite database location                   |
| Frontend | `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | URL of the backend                              |

## Assumptions, sample data and notes

1. **Email-based identification instead of full login.** Sign in with an email address; there is no
   password. An email that already exists opens that profile, and a new email creates a profile
   automatically. The account is remembered in the browser. Opening a meeting link while signed out
   asks you to sign in first and then returns you to the meeting.
2. **Sample accounts.** You can sign in with `user1@example.com` through `user10@example.com` (or any
   other email). The seed data also includes `default.user@example.com`, who already has upcoming and
   recent meetings to look at.
3. **Zoom Free plan.** Every meeting, instant or scheduled, ends 40 minutes after it starts, whatever
   duration was scheduled. The host sees a countdown and a warning in the last 10 minutes.
4. **Demo features.** Some Zoom controls are included only to keep the Zoom look and feel, for example
   screen sharing, host tools, backgrounds and upgrade links. They show the message *"This is a demo
   feature and is not available right now."*
5. **No audio or video streaming.** Mute, video, raise hand and the participant list are kept in sync
   through the API: each browser checks in every 3 seconds, and a browser that stops checking in for
   90 seconds is treated as having left. Meeting chat and reactions are shown on your own screen only.
6. **Passcodes.** Instant meetings get a passcode for the invite, but anyone with the link or the
   Meeting ID can join without typing it. Scheduled meetings ask for their passcode.
7. **One browser is one participant.** Each browser has its own token, so the same account joining
   from two browsers appears as two participants.
8. **Hosting.** On Render's free plan the disk is not persistent, so the live database goes back to
   the sample data whenever the backend restarts or is redeployed.

## Deployment

- **Backend on Render:** New → Blueprint → select this repository; `render.yaml` configures the service.
  Set `FRONTEND_URL` and `CORS_ORIGINS` to the Vercel URL.
- **Frontend on Vercel:** import the repository, set the Root Directory to `frontend`, and set
  `NEXT_PUBLIC_API_BASE_URL` to the Render URL.
