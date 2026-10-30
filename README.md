# Hopsnop

A text-first social network built with security and the protection of its
users' data as the main concern. It is the practical part of the diploma
thesis *Design and Implementation of a Secure Social Media Platform with
Enhanced User Data Protection* (Computer Engineering, Vistula University).

| Part | What it is | Documentation |
| --- | --- | --- |
| [`backend/`](backend) | FastAPI, SQLAlchemy and Alembic on PostgreSQL. Accounts, sessions, posts, follows, stories, data export, account deletion and retention | [backend/README.md](backend/README.md) |
| [`frontend/`](frontend) | Next.js and React. Runs in the browser and talks to the API only | [frontend/README.md](frontend/README.md) |

```
browser ──► frontend (Next.js, :3000) ──► backend API (FastAPI, :8000) ──► PostgreSQL (:5433)
                pages and scripts            every rule and every check          the data
```

The frontend is not a security boundary. Every rule about who may read or
change what is enforced by the API, and the frontend only reflects it.

## Running it locally

You need Docker, Python 3.12 and Node.js 22 or newer. Each block starts in
the repository's root folder, in a terminal of its own.

The database and the API:

```bash
cd backend
docker compose up -d
cp .env.example .env                  # once
python3 -m venv .venv                 # once
source .venv/bin/activate
pip install -r requirements-dev.txt   # once, and after requirements change
alembic upgrade head
uvicorn app.main:app --reload
```

The frontend:

```bash
cd frontend
cp .env.example .env.local            # once
npm install
npm run dev
```

Open <http://localhost:3000>. Use `localhost`, not `127.0.0.1`: the session
cookie only travels between addresses the browser counts as the same site.
Registration links are written to the API's log in development; see
[Email](backend/README.md#email).

## Checks

The same checks run on every push and pull request (`.github/workflows/ci.yml`).

The backend's tests need a database of their own, empty; how to make one is
in [backend/README.md, Tests](backend/README.md#tests). Then, from the root:

```bash
(cd backend && DATABASE_URL=postgresql+psycopg://hopsnop:hopsnop@localhost:5433/hopsnop_test pytest)
```

The frontend's, from the root:

```bash
cd frontend
npm run lint
npx next typegen && npx tsc --noEmit
npm test
npm run build
```

## API types

The frontend's API types are checked against the backend's OpenAPI schema
(`frontend/lib/api-contract.ts`). After changing anything the API accepts or
returns, regenerate both files and commit them with the change. From the
repository's root folder, with the backend's virtual environment active:

```bash
(cd backend && python -m app.openapi > openapi.json)
(cd frontend && npm run api:types && npx tsc --noEmit)
```

The schema is built from the code alone and touches no database, but it
reads the backend's `.env` like any other command of the API.

`tsc` then names every frontend type that no longer matches. CI fails if the
committed schema or types are not what the backend produces.
