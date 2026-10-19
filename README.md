# Relay

Relay is a team work tracker for issues, assignments, approvals, comments, bookmarks, and optional AI summaries. It uses a React frontend, FastAPI backend, and PostgreSQL.

## Run locally

You need Docker Compose, Node.js 22.12+, and npm. Run the first commands from the repository root.

1. Create the backend configuration if it does not already exist:

   ```bash
   cp .env.example .env
   ```

   Set a long random `JWT_SECRET` in `.env`. The demo signup also needs `ADMIN_SIGNUP_KEY` to match `VITE_DEMO_ADMIN_SIGNUP_KEY` in `frontend/.env.example`. Set `POSTGRES_PASSWORD` if you want a database password other than the Compose development default. Keep the password in `DATABASE_URL` aligned if you run the API on your host.

2. Start PostgreSQL and the API:

   ```bash
   docker compose up -d --build
   ```

   The API applies migrations on startup. Check it at [http://localhost:8000/health](http://localhost:8000/health).

3. Start the frontend in another terminal. If `frontend/.env` already exists, skip the `cp` command and keep its current values:

   ```bash
   cd frontend
   cp .env.example .env
   npm ci
   npm run dev
   ```

   Open [http://localhost:5173](http://localhost:5173).

4. Open **Create an admin account** on the sign-in page. The demo displays its signup code and offers a **Use demo code** button. Create your account and initial team, then sign in. Signup is available only when the backend has a matching `ADMIN_SIGNUP_KEY` of at least 32 characters.

The demo code is public: **any visitor who can see it can create a workspace administrator**. The `relay-two-topaz.vercel.app` demo also shows the code when its frontend environment setting is absent. For a normal deployment, use a different private backend key and omit `VITE_DEMO_ADMIN_SIGNUP_KEY` from the frontend build. Set `FRONTEND_ORIGIN` to the deployed frontend URL and `VITE_API_BASE_URL` to the browser-reachable API URL.

## Use Relay

- **Attention** shows overdue, blocked, unassigned, and approval-pending work.
- **All Work** lets you search, filter, create, and update issues. Issue edits use version checks; review a conflict before retrying.
- **Issue details** include assignments, workflow, comments, bookmarks, activity, approval requests, and summaries.
- **Users** and **Teams** provide administration according to your permissions. An administrator does not automatically have approval authority.
- Set `GROQ_API_KEY` on the backend to enable summaries. Leave it empty to run without AI.

The API documentation is at [http://localhost:8000/docs](http://localhost:8000/docs). All application API routes use `/api/v1`.

## Useful commands

```bash
docker compose up -d             # Start existing services
docker compose up -d --build api # Rebuild the API and apply migrations
docker compose logs -f api       # Follow API logs
docker compose stop              # Stop without deleting database data
```

From `frontend/`, run `npm run build` for a production build or `npm run test:e2e` for browser tests. Backend tests use `.venv/bin/pytest -q` after installing `requirements.txt`; database tests need a disposable PostgreSQL `TEST_DATABASE_URL` whose database name ends in `_test`.

For implementation details, see [engineering decisions](ENGINEERING_DECISIONS.md), the [frontend notes](docs/RELAY_FRONTEND.md), and the [interview guide](docs/INTERVIEW_GUIDE.md).
