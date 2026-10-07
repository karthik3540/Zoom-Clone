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

## Deployment

- **Backend on Render** (free): New → Blueprint → pick this repository; `render.yaml` sets it up.
  Set `FRONTEND_URL` and `CORS_ORIGINS` to the Vercel URL.
- **Frontend on Vercel** (free): import the repository, set Root Directory to `frontend`, and set
  `NEXT_PUBLIC_API_BASE_URL` to the Render URL.

On Render's free plan the service sleeps after 15 minutes without traffic (the first request
then takes about a minute), and its disk is not persistent, so the SQLite data is reset to the
sample data whenever the service restarts or redeploys.
