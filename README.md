# Relay — Operational Work Management

Relay is a web application for tracking operational issues, engineering tasks, incidents, payments, compliance work, and approval requests. Teams can assign owners, move issues through a workflow, discuss progress, save bookmarks, and generate short issue summaries with Groq.

The React frontend and FastAPI backend run independently. PostgreSQL stores application data; Groq is optional and is used only when a user requests a summary.

For an interview walkthrough, module explanations, trade-offs, and practice questions, see the [interview guide](docs/INTERVIEW_GUIDE.md).

## Contents

- [Features and pages](#features-and-pages)
- [Technology and architecture](#technology-and-architecture)
- [Prerequisites](#prerequisites)
- [Quick start: Docker backend](#quick-start-docker-backend)
- [Alternative: local Python backend](#alternative-local-python-backend)
- [Configuration](#configuration)
- [Users, teams, and permissions](#users-teams-and-permissions)
- [Working with issues](#working-with-issues)
- [Approvals](#approvals)
- [Bookmarks and comments](#bookmarks-and-comments)
- [Groq summaries](#groq-summaries)
- [API reference](#api-reference)
- [Database and migrations](#database-and-migrations)
- [Testing and checks](#testing-and-checks)
- [Deployment notes](#deployment-notes)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [Current limitations](#current-limitations)

## Features and pages

| Page          | Route        | What it provides                                                                                                                                          |
| ------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in       | `/login`     | Email/password authentication.                                                                                                                            |
| Attention     | `/attention` | Issues that are overdue, blocked, unassigned, or awaiting approval.                                                                                       |
| All Work      | `/work`      | Search, filters, sorting, pagination, and issue creation.                                                                                                 |
| Bookmarks     | `/bookmarks` | The signed-in user's saved issues, with search and filters.                                                                                               |
| Issue details | `/work/:id`  | Description, next action, prominent status controls, lifecycle pipeline, assignments, comments, activity, approval requests, bookmarks, and AI summaries. |
| Approvals     | `/approvals` | Visible requests and permitted approval/rejection actions.                                                                                                |
| Teams         | `/teams`     | Team information, work counts, and team creation for eligible administrators.                                                                             |
| Users         | `/users`     | User directory and account creation for workspace administrators.                                                                                         |

The interface adapts to desktop and mobile screens. Navigation moves to the bottom on mobile. Controls follow the current user's permissions; the backend checks permissions independently for every protected action.

## Technology and architecture

| Layer             | Technology                                     |
| ----------------- | ---------------------------------------------- |
| Frontend          | React 19, TypeScript, Vite 6, React Router 7   |
| Server state      | TanStack Query 5                               |
| Styling and icons | Tailwind CSS 4, application CSS, Lucide        |
| Backend           | Python, FastAPI, Pydantic                      |
| Persistence       | PostgreSQL 16, SQLAlchemy 2, Psycopg 3         |
| Schema migrations | Alembic                                        |
| Authentication    | Signed bearer JWTs, Argon2 password hashing    |
| AI integration    | Groq Chat Completions over HTTPX               |
| Verification      | Pytest, Playwright, Ruff, Prettier, TypeScript |

Requests pass through input validation, authentication, and team authorization before database operations. Work changes and their activity events share a transaction. Conditional version updates detect concurrent edits. The frontend updates its cache from server responses and refreshes affected lists.

See [engineering decisions](ENGINEERING_DECISIONS.md) for the architectural rationale and [frontend implementation notes](docs/RELAY_FRONTEND.md) for the original Stitch design references and UI contracts.

## Prerequisites

- Docker Engine with Docker Compose v2 for the database and, optionally, the API.
- Node.js 22.12+ and npm for the frontend.
- Python 3.12+ for the local backend alternative and backend tests.
- Available ports: `8000` for the API, `5173` for the frontend, and `5432` or another configured host port for PostgreSQL.
- A Groq API key only if you want issue summaries.

Run commands from the repository root unless a section explicitly switches to `frontend/`.

## Quick start: Docker backend

### 1. Configure the backend

For a new checkout:

```bash
cp .env.example .env
```

If `.env` already exists, edit it instead of replacing it. Set these values in the root `.env`:

```dotenv
POSTGRES_PASSWORD=replace-with-your-local-database-password
POSTGRES_PORT=5433
DATABASE_URL=postgresql+psycopg://relay:replace-with-your-local-database-password@localhost:5433/relay
JWT_SECRET=replace-with-a-long-random-secret
JWT_ALGORITHM=HS256
ACCESS_TOKEN_MINUTES=60
FRONTEND_ORIGIN=http://localhost:5173
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b
```

`POSTGRES_PASSWORD` must be added explicitly; the example file currently provides the database URL but does not declare that variable. Generate a JWT secret with:

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

The example above uses host port **5433** to avoid an existing PostgreSQL installation on 5432. You can use 5432 if it is available; keep `POSTGRES_PORT` and the port in the host `DATABASE_URL` consistent.

The password in `DATABASE_URL` must match `POSTGRES_PASSWORD`. URL-encode special characters in the URL password. The current Compose file constructs its internal database URL from `POSTGRES_PASSWORD`, so use a URL-safe password for that setup.

### 2. Start PostgreSQL and the API

```bash
docker compose up -d --build
```

Compose waits for PostgreSQL to become healthy, applies Alembic migrations, and starts FastAPI. It does **not** seed accounts automatically.

Check startup:

```bash
docker compose ps
docker compose logs --tail=100 api
curl http://localhost:8000/health
```

Expected health response:

```json
{ "status": "ok" }
```

The health endpoint confirms the API process responds; it is not a database readiness probe.

### 3. Bootstrap the development administrator

For a new local development database, run the explicit seed once. Enter an initial password with at least 12 characters:

```bash
read -rsp 'Development admin password: ' DEV_ADMIN_PASSWORD
printf '\n'
export DEV_ADMIN_PASSWORD
docker compose exec -e DEV_ADMIN_PASSWORD api python -m app.seed
unset DEV_ADMIN_PASSWORD
```

The seed creates:

- The role and permission catalog.
- An **Example Operations** team.
- A workspace administrator with email **`admin@example.test`**.
- Active membership for that administrator in the example team.

Use the password you entered to sign in. Running the seed again fills missing records but **does not reset an existing administrator's password**. This seed is intended for local development, not production account provisioning.

### 4. Start the frontend

In another terminal:

```bash
cd frontend
cp .env.example .env
npm ci
npm run dev
```

Preserve an existing `frontend/.env` if it is already configured. Open **http://localhost:5173** and sign in.

| Service        | Local address                      |
| -------------- | ---------------------------------- |
| Frontend       | http://localhost:5173              |
| API base       | http://localhost:8000/api/v1       |
| Swagger UI     | http://localhost:8000/docs         |
| ReDoc          | http://localhost:8000/redoc        |
| OpenAPI schema | http://localhost:8000/openapi.json |
| Health         | http://localhost:8000/health       |

### Daily commands

```bash
# Start existing backend services.
docker compose up -d

# Rebuild after backend code changes, and apply new migrations.
docker compose up -d --build api

# Apply changed Compose environment values without rebuilding code.
docker compose up -d api

# Follow API logs.
docker compose logs -f api

# Stop services while preserving the database volume.
docker compose stop
```

A plain `docker compose restart api` does not apply changed Compose environment values; recreate the service using `up -d api`.

## Alternative: local Python backend

This option runs PostgreSQL in Docker and FastAPI on your host for automatic code reload. Configure the root `.env` as above, including the matching database password and host port.

```bash
docker compose up -d db
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/alembic upgrade head
```

If an API container is already using port 8000, stop it before starting the host API:

```bash
docker compose stop api
```

For a new development database, bootstrap accounts:

```bash
read -rsp 'Development admin password: ' DEV_ADMIN_PASSWORD
printf '\n'
export DEV_ADMIN_PASSWORD
.venv/bin/python -m app.seed
unset DEV_ADMIN_PASSWORD
```

Start FastAPI:

```bash
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend settings load from the root `.env`. Run these commands from the repository root. Stop the host API with `Ctrl+C`.

If an existing virtual environment was created with `uv` and has no pip, install dependencies with:

```bash
uv pip install --python .venv/bin/python -r requirements.txt
```

## Configuration

### Backend: root `.env`

| Variable               | Purpose / default                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`         | SQLAlchemy PostgreSQL URL for a host-run backend. Compose overrides it with a connection to `db:5432`.                         |
| `POSTGRES_PASSWORD`    | Database initialization password used by Compose; defaults to `relay-dev-only` when omitted. Set it explicitly for your setup. |
| `POSTGRES_PORT`        | Published PostgreSQL host port; Compose default `5432`.                                                                        |
| `JWT_SECRET`           | Required JWT signing secret. Changing it invalidates existing tokens.                                                          |
| `JWT_ALGORITHM`        | Signing algorithm; application default `HS256`.                                                                                |
| `ACCESS_TOKEN_MINUTES` | Access token lifetime; application default `60`.                                                                               |
| `FRONTEND_ORIGIN`      | Exact permitted browser origin; default `http://localhost:5173`.                                                               |
| `GROQ_API_KEY`         | Optional server-side Groq key. Empty means summaries are unavailable.                                                          |
| `GROQ_MODEL`           | Model sent to Groq; default `openai/gpt-oss-120b`.                                                                             |
| `DEV_ADMIN_PASSWORD`   | Shell environment variable read by the explicit development seed, not by normal API startup. Minimum 12 characters.            |
| `TEST_DATABASE_URL`    | Disposable database URL used by backend tests; database name must end in `_test`.                                              |

For host-run FastAPI, environment variables override `.env` settings. Compose explicitly passes `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN`, `GROQ_API_KEY`, and `GROQ_MODEL` to the API. Add any further runtime overrides, such as token lifetime, to the Compose service environment when deploying.

### Frontend: `frontend/.env`

```dotenv
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

This is a browser-reachable API URL, including `/api/v1`. Restart Vite after changing it. Production frontend values are embedded at build time, so rebuild after a change.

Keep database passwords, JWT signing secrets, and Groq keys out of `VITE_*` variables. Everything exposed through those variables is browser-visible.

### PostgreSQL host versus container addresses

| API location       | PostgreSQL address                                        |
| ------------------ | --------------------------------------------------------- |
| API on your host   | `localhost:<POSTGRES_PORT>`, for example `localhost:5433` |
| API inside Compose | `db:5432`, regardless of the published host port          |

A PostgreSQL volume keeps its original database credentials. Changing `POSTGRES_PASSWORD` after initialization does not change the database user's password inside an existing volume. Update the actual database password deliberately or restore the matching configuration.

## Users, teams, and permissions

### Onboard an employee through the frontend

1. Sign in as a **workspace administrator**.
2. Open **Users → Create User**.
3. Enter full name, email, an initial password of at least 12 characters, role, and team.
4. Submit the form and share the initial credentials separately.
5. The employee can sign in immediately; there is no additional account approval step.

Email addresses are normalized to lowercase and trimmed. Duplicate emails return a conflict. The user directory supports search and pagination and displays role scope and account status. Passwords and password hashes are not returned in the directory.

There is currently no public signup, invitation email, password reset, or forced initial-password change.

### Role capabilities

These are the permissions assigned by the development seed. Team actions also require active membership in the relevant team.

| Capability                                        | ADMIN                | TEAM_LEAD | ENGINEER / SUPPORT_AGENT | FINANCE | MANAGER |
| ------------------------------------------------- | -------------------- | --------- | ------------------------ | ------- | ------- |
| View issues; bookmark, comment, request summaries | Yes                  | Yes       | Yes                      | Yes     | Yes     |
| Create and edit issues                            | Yes                  | Yes       | Yes                      | No      | No      |
| Assign / remove assignments                       | Yes                  | Yes       | No                       | No      | No      |
| Change status, except closing                     | Yes                  | Yes       | Yes                      | No      | Yes     |
| Close issues                                      | Yes                  | Yes       | No                       | No      | No      |
| Request approval                                  | Yes                  | Yes       | Yes                      | No      | No      |
| Approve / reject requests                         | No                   | Yes       | No                       | Yes     | Yes     |
| Manage team membership                            | Yes                  | Yes       | No                       | No      | No      |
| Create teams                                      | Workspace grant only | No        | No                       | No      | No      |
| List / create workspace users and list roles      | Workspace grant only | No        | No                       | No      | No      |

**Scope matters:** creating an `ADMIN` without a team creates a workspace-wide grant. Creating an `ADMIN` with a team creates a team-scoped grant; that account cannot administer workspace users. Other roles require a team when creating an account.

Even a workspace administrator needs active membership in a team to access its issues. An administrator created without a team has no membership from that creation operation; the development seed separately adds membership for the initial admin.

Membership and permission grants are separate records. Adding an existing user through the memberships API gives membership, not an additional role grant. Editing existing role grants is not exposed through a management UI or API yet.

## Working with issues

### Fields

Issues have a UUID, team, creator, title, description, type, priority, next action, due date, status, optional parent, timestamps, and version. Assignments identify the owner, contributors, and reviewers. At most one assignment can have the `OWNER` role.

Supported types:

```text
CUSTOMER_ISSUE  ENGINEERING  INCIDENT  PAYMENT  COMPLIANCE  APPROVAL  OTHER
```

Supported priorities: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.

### Lifecycle

New issues start at `OPEN`. The highlighted **Change status** bar shows permitted actions near the top of the detail page.

| Current status | Allowed next statuses   |
| -------------- | ----------------------- |
| `OPEN`         | `IN_PROGRESS`           |
| `IN_PROGRESS`  | `BLOCKED`, `RESOLVED`   |
| `BLOCKED`      | `IN_PROGRESS`           |
| `RESOLVED`     | `CLOSED`, `IN_PROGRESS` |
| `CLOSED`       | None                    |

Closing additionally requires `work_item:close`. The API returns workflow candidates in `allowed_transitions`; the frontend filters them by the user's permissions.

### Attention queue

The queue returns each visible issue once, with every applicable reason:

- **Overdue:** due date is in the past, and the issue is neither resolved nor closed.
- **Blocked:** status is `BLOCKED`.
- **Unassigned:** no owner assignment exists; contributors alone do not count as an owner.
- **Pending approval:** at least one approval request remains pending.

Closed issues are excluded from the queue.

### Concurrent edits and retries

Editing fields, changing status, assigning/removing users, and requesting approval require the current **work item version**. Each successful operation increments that version. A stale version returns `409 stale_version`.

The frontend retains attempted changes, loads the latest values, and asks the user to review and explicitly resubmit. It does not silently overwrite another user's changes.

Work-item creation accepts `Idempotency-Key`. A retry by the same actor with the same key and identical payload returns the existing issue. Reusing that key with a different payload returns a conflict. Key records have no automatic expiration.

## Approvals

Request an approval from the issue detail page using an approval type and reason. Eligible approvers use the **Approvals** page to approve or reject it.

A decision requires:

- An active account, active team membership, and `approval:decide` permission for the issue's team.
- A pending request and its current **approval version**.
- A different user from the requester.
- The designated approver's identity when `approver_id` is set.

Seeded **Team Lead, Finance, and Manager** roles can decide requests. The **Admin role cannot decide approvals** by default. Create a separate eligible account in the same team to test the full request/decision flow.

The frontend request form does not designate an approver; any eligible teammate other than the requester may decide. The API optionally accepts `approver_id` to restrict the decision to one eligible account.

Approval decisions record activity but do not automatically change issue status or execute payment actions. Requests use work item versions; decisions use approval versions. The schema includes `CANCELLED`, but there is currently no cancellation endpoint.

## Bookmarks and comments

### Bookmarks

- Select **Bookmark issue** on an issue detail page; select **Bookmarked** again to remove it.
- Open **Bookmarks** in the navigation to view your saved issues.
- The Bookmarks page always requests saved issues, even after clearing its search and filters.
- All Work also offers a saved-work filter.
- Bookmarks are private to the signed-in user and persist in PostgreSQL.
- Saving an issue does not grant access. If team access is removed, that issue no longer appears in accessible bookmark results.
- Repeated save/remove API requests are safe; they do not create duplicates.

### Comments

Anyone who can view an issue can comment, including employees without issue-edit permission. Comments are visible to other users who can view that issue.

The thread shows author names and posting times, newest first, with pagination. Comments must contain non-whitespace text and may be at most **10,000 characters**. The frontend preserves the draft when posting fails.

Comments are displayed as text. Posting a comment records a `COMMENTED` activity event but does not increment the work item version. Comment editing, deletion, mentions, and attachments are not implemented.

## Groq summaries

### Enable summaries

Create a key in the [Groq Console](https://console.groq.com/keys) and set it in the **root backend `.env`**:

```dotenv
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=openai/gpt-oss-120b
```

Recreate the Docker API service after changing configuration:

```bash
docker compose up -d api
```

For a host-run backend, restart FastAPI. Use a model available to your Groq account; `GROQ_MODEL` is configurable.

### Generate and view a summary

On an issue, select **Summarize issue** in **Issue at a glance**. Select **Refresh summary** after issue updates or new discussion.

- Summaries are generated on demand as one plain-text paragraph of **100–150 whitespace-separated words**. The backend removes presentation markup, joins the text into one paragraph, and trims overlong output at a sentence boundary within the requested range when possible. Short output receives one expansion request; output still below 100 words returns an error.
- They are not saved in PostgreSQL and do not automatically update when the issue changes.
- The browser displays a single text paragraph, without Markdown rendering, headings, or bullet points.
- Returned text is rendered as ordinary React text, not HTML.
- The model is instructed to return only natural prose, without formatting or unsupported facts.

### Data sent to Groq

The backend sends the issue title, status, priority, up to **20,000 description characters**, up to **4,000 next-action characters**, and the **30 most recent comments**, limited to **1,000 characters per comment**. It does not include account credential fields, full activity history, or approval records in the summary context.

Issue text is sent to an external provider when a summary is requested. The API key remains on the backend. Summaries use supplied context and can omit details or contain mistakes; review them before acting on them.

The integration calls Groq's [Chat Completions API](https://console.groq.com/docs/api-reference). Each backend HTTP call has a 30-second timeout; up to two calls may be made for a format/length correction. The frontend allows 75 seconds for this request. Groq is optional: missing configuration affects summaries, not bookmarks, comments, or issue workflows.

| Summary response             | Meaning                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `502 summary_invalid_format` | Provider output remained below the required length after one expansion request. |
| `503 summary_not_configured` | Backend Groq key is missing.                                                    |
| `429 summary_rate_limited`   | Provider rate limit or quota response.                                          |
| `504 summary_timeout`        | Provider request timed out.                                                     |
| `502 summary_unavailable`    | Provider failure, invalid configuration, or unreadable response.                |

## API reference

All paths below are relative to **`/api/v1`**, except `/health`. Protected routes require:

```http
Authorization: Bearer <access_token>
```

Use Swagger UI at `/docs` for the complete request and response schemas.

### Authentication and administration

| Method | Path                           | Purpose                                                                        |
| ------ | ------------------------------ | ------------------------------------------------------------------------------ |
| `POST` | `/auth/login`                  | Authenticate with email and password; return a bearer token.                   |
| `GET`  | `/auth/me`                     | Current user.                                                                  |
| `GET`  | `/auth/access`                 | Global permissions and effective permissions per active team.                  |
| `GET`  | `/users`                       | Paginated user directory; global `user:manage` required.                       |
| `POST` | `/users`                       | Create an account, role grant, and optional team membership.                   |
| `GET`  | `/roles`                       | Role choices and whether they require a team; global `user:manage` required.   |
| `GET`  | `/teams`                       | Readable teams with active membership.                                         |
| `POST` | `/teams`                       | Create a team and add the creator's membership; global `team:manage` required. |
| `GET`  | `/teams/{team_id}/members`     | Active accounts with active membership in a readable team.                     |
| `POST` | `/teams/{team_id}/memberships` | Add/reactivate membership; requires that team's `team:manage`.                 |

### Issues and collaboration

| Method   | Path                                     | Purpose                                                  |
| -------- | ---------------------------------------- | -------------------------------------------------------- |
| `GET`    | `/work-items`                            | List visible issues.                                     |
| `POST`   | `/work-items`                            | Create an issue; optional `Idempotency-Key` header.      |
| `GET`    | `/work-items/{id}`                       | Issue details and workflow candidates.                   |
| `PATCH`  | `/work-items/{id}`                       | Update editable fields using work item version.          |
| `POST`   | `/work-items/{id}/transitions`           | Change status using work item version.                   |
| `POST`   | `/work-items/{id}/assignments`           | Add an assignment using work item version.               |
| `DELETE` | `/work-items/{id}/assignments/{user_id}` | Remove assignment; JSON body contains work item version. |
| `GET`    | `/work-items/{id}/activity`              | Paginated activity.                                      |
| `GET`    | `/work-items/{id}/bookmark`              | Current user's bookmark state.                           |
| `PUT`    | `/work-items/{id}/bookmark`              | Save a private bookmark; no request body.                |
| `DELETE` | `/work-items/{id}/bookmark`              | Remove bookmark; `204` response.                         |
| `GET`    | `/work-items/{id}/comments`              | Paginated comments, newest first.                        |
| `POST`   | `/work-items/{id}/comments`              | Post `{"body":"Your comment"}`.                          |
| `POST`   | `/work-items/{id}/summary`               | Generate a summary; no request body.                     |
| `GET`    | `/dashboard/attention`                   | Visible issues and attention reasons.                    |

Bookmarks, comments, and summary requests do **not** require or increment a work item version.

### Approval endpoints

| Method | Path                       | Purpose                                            |
| ------ | -------------------------- | -------------------------------------------------- |
| `GET`  | `/approvals`               | Visible requests; default status filter `PENDING`. |
| `POST` | `/approvals`               | Request approval using work item version.          |
| `GET`  | `/approvals/{id}`          | Read a visible approval.                           |
| `POST` | `/approvals/{id}/decision` | Approve/reject using approval version.             |

### Filters and pagination

Work item filters: `team_id`, `status`, `priority`, `type`, `assignee_id`, `overdue`, `bookmarked`, and `search`. `bookmarked=true` refers to the authenticated user's saved items. Search matches title and description without case sensitivity.

Sort fields: `created_at`, `updated_at`, `due_at`, `priority`, `status`. Direction: `asc` or `desc`. Priority/status sorting uses the stored values rather than a custom business ranking.

Paginated endpoints return:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 20
}
```

Pages start at 1. The default page size is 20 and the maximum is 100. User directory filters include `search`; approval filters include `status` and `team_id`; attention filters include `team_id`, `reason`, and `priority`.

### Example requests

Sign in using Swagger UI or the frontend. For command-line requests, set `TOKEN` to the returned access token and replace the UUID placeholders:

```bash
curl -X POST http://localhost:8000/api/v1/work-items \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: investigate-payments-001' \
  -d '{"team_id":"TEAM_UUID","title":"Investigate failed payments","type":"PAYMENT","priority":"HIGH"}'

curl -X PATCH http://localhost:8000/api/v1/work-items/ITEM_UUID \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"version":1,"next_action":"Inspect processor logs"}'

curl -X PUT http://localhost:8000/api/v1/work-items/ITEM_UUID/bookmark \
  -H "Authorization: Bearer $TOKEN"

curl -X POST http://localhost:8000/api/v1/work-items/ITEM_UUID/comments \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"body":"Investigating the processor logs now."}'

curl 'http://localhost:8000/api/v1/work-items?bookmarked=true&page=1' \
  -H "Authorization: Bearer $TOKEN"
```

### Error contract

```json
{
  "detail": {
    "code": "stale_version",
    "message": "Work item changed; fetch the latest version and retry"
  }
}
```

| HTTP status | Typical meaning                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| `401`       | Missing, invalid, expired token, inactive account, or invalid login.                                         |
| `403`       | Missing permission or required active membership.                                                            |
| `404`       | Resource absent or issue inaccessible to the caller.                                                         |
| `409`       | Stale version, duplicate data, conflicting assignment, repeated decision, or mismatched idempotency payload. |
| `422`       | Invalid input, reference, workflow transition, or filter.                                                    |

Validation responses also include field locations and error types. Inaccessible issues return 404 to avoid exposing their existence. Approval reads follow the issue's visibility rules.

## Database and migrations

PostgreSQL is the supported database; SQLite is not a substitute for these models and tests.

Core tables include users, teams, memberships, roles, permissions, role grants, work items, assignments, approvals, activity events, idempotency records, bookmarks, and comments.

Migrations:

| Revision                   | Change                                 |
| -------------------------- | -------------------------------------- |
| `0001`                     | Initial schema.                        |
| `0002_issue_collaboration` | Private bookmarks and shared comments. |

For a host-run backend:

```bash
.venv/bin/alembic current
.venv/bin/alembic upgrade head
```

Compose API startup already runs `alembic upgrade head`. Startup does not call SQLAlchemy `create_all`, and the frontend does not create database tables.

When changing models, add a new migration rather than editing applied revisions. Review generated migration operations before applying them. Schema upgrades and initial user seeding are separate steps.

The `relay_pg` named volume preserves database contents across container restarts and normal `docker compose down`. **`docker compose down -v` deletes the Compose database volume and its data.** It is not required for normal updates or migrations.

## Testing and checks

### Backend tests

Install `requirements.txt` in the virtual environment. Integration tests require a **dedicated disposable PostgreSQL database** with a name ending in `_test`:

```bash
docker compose up -d db
docker compose exec -T db createdb -U relay relay_test

# Replace the password and port to match your local database configuration.
export TEST_DATABASE_URL='postgresql+psycopg://relay:YOUR_URL_ENCODED_PASSWORD@localhost:5433/relay_test'
.venv/bin/pytest -q
unset TEST_DATABASE_URL
```

The database fixture **drops and recreates application tables in the configured test database**. Never use the application's `relay` database for this setting. A non-`_test` database name is rejected. Without `TEST_DATABASE_URL`, database integration tests are skipped; a successful smoke-only run does not establish database integration correctness.

After testing, you may remove the dedicated test database:

```bash
docker compose exec -T db dropdb -U relay relay_test
```

Coverage includes authentication, team isolation, role permissions, version conflicts, creation idempotency, assignments, approvals, user onboarding, directory access, bookmarks, comments, and mocked Groq responses/errors. Live Groq requests are not necessary for the automated suite.

### Frontend checks

From `frontend/`:

```bash
npm ci
npm run typecheck
npm run build
npm run format:check
npx playwright install chromium
npm run test:e2e
```

The production build runs TypeScript's project build and writes `frontend/dist/`. Playwright starts its own Vite server on **127.0.0.1:4173**; leave that port available. Its API fixtures test UI behavior and request contracts, including single-paragraph summary display. They do not replace live backend integration testing.

### Formatting and lint

For Python files you change:

```bash
.venv/bin/ruff check path/to/changed_file.py
.venv/bin/ruff format --check path/to/changed_file.py
```

The repository also contains older Python files that are not fully normalized to Ruff's current formatting. A repository-wide formatting check may report those independently of your changes.

### Manual integration checklist

With a running API and frontend:

1. Sign in as the development admin and create an employee and a separate Team Lead, Finance, or Manager in the same team.
2. Create an issue, assign an owner, update its next action, and change its status.
3. Bookmark it and open **Bookmarks**; confirm another account does not inherit that bookmark.
4. Post a comment as the employee and view it as another authorized teammate.
5. Request approval as one account, then decide it using a different eligible account.
6. Configure Groq, request a summary, and verify a single plain-text paragraph of 100–150 words.
7. Open the same issue in two sessions, edit both, and check the conflict/review flow.

## Deployment notes

The included Compose setup is a local development baseline. For a deployed environment:

- Build the frontend with a browser-reachable `VITE_API_BASE_URL`, including `/api/v1`.
- Serve `frontend/dist/` through a static web server configured to return `index.html` for application routes such as `/bookmarks` and `/work/:id`.
- Set `FRONTEND_ORIGIN` to the exact deployed frontend origin, including its scheme and port where applicable.
- Use HTTPS, runtime secrets, deliberate account provisioning, database backups, and appropriate network access controls.
- Apply migrations as a controlled deployment step. The Compose command applies them automatically; the standalone Dockerfile's default command starts Uvicorn without migrations.
- The current Dockerfile copies the repository, and `.dockerignore` does not exclude the root `.env`. Account for this before building distributable images with local secrets present; use a secret-safe build context and runtime configuration.
- The frontend is not served by FastAPI or included as a separate Compose service. Host it independently.

The browser stores its access token in `sessionStorage` and clears authentication/cache state on logout or a 401 response. Tokens are accessible to JavaScript; there are no HttpOnly cookie sessions, refresh tokens, or server-side logout/revocation endpoint.

## Troubleshooting

### Docker socket permission denied

For an error mentioning `/var/run/docker.sock`, first verify Docker is running and that your account is allowed to use it:

```bash
sudo systemctl start docker
sudo usermod -aG docker "$USER"
```

Log out and back in, or start a shell with `newgrp docker`, then retry `docker compose ps`. On a system configured with the Docker group, `sg docker -c 'docker compose ps'` can use the updated group in a fresh process. Docker group membership grants powerful host access; only add trusted users. Avoid making the socket world-writable.

### Port 5432 is already in use

Set `POSTGRES_PORT=5433` in root `.env` and use `localhost:5433` in the host `DATABASE_URL`. Recreate the database service with `docker compose up -d db`. Inside Compose, the API still connects to `db:5432`.

### Database authentication fails

Check that the URL password and `POSTGRES_PASSWORD` match the actual database user password. Existing volumes retain their initialized credentials. Changing `.env` alone does not rotate those credentials. Also check whether a previously exported shell variable is overriding the `.env` value.

### API cannot connect to PostgreSQL

Check `docker compose ps`, database health, credentials, and the host/container address table above. A local Python process uses the published host port; the API container uses the `db` service name. Apply migrations before attempting to use application endpoints.

### Frontend cannot reach the API or reports CORS errors

Confirm the API is responding on port 8000, `VITE_API_BASE_URL` ends in `/api/v1`, and `FRONTEND_ORIGIN` exactly matches the browser origin. `localhost` and `127.0.0.1` are different origins. Restart/recreate the affected service after configuration changes.

### No account can sign in

Startup does not create users. Bootstrap a new development database with the seed, or sign in with an existing account. Re-running the seed does not reset an existing password. Expired tokens require signing in again.

### Users is missing from navigation

User administration requires a **global** `user:manage` grant. Team Lead and team-scoped Admin accounts do not qualify. Use the workspace administrator.

### Cannot approve a request

Use a separate Team Lead, Finance, or Manager in the issue's team. Check active membership, a pending request, designated approver restrictions, and whether the account is also the requester. Admin alone does not grant approval authority.

### A bookmark no longer appears

Bookmarks belong to the current account and remain subject to issue access. Check the account, active team membership, and any filters on the Bookmarks page.

### Summary is unavailable

Set `GROQ_API_KEY` on the backend, verify the configured model is available, and recreate/restart the API. A key in `frontend/.env` is not used by the backend. Rate limits, provider failures, and timeouts are surfaced in the summary panel; see the summary response table above.

### Missing tables after an update

Run `.venv/bin/alembic upgrade head` for a host-run backend or rebuild/recreate the Compose API. Do not reset the database volume to install migrations.

### Browser refresh returns 404 after deployment

Configure the static host's SPA fallback to serve `index.html` for client routes. The API server does not supply this frontend fallback.

## Project structure

```text
app/
  api/                 Authentication, users, teams, issues, approvals, dashboard, collaboration
  core/                Settings, password/JWT helpers, error helpers
  db/                  SQLAlchemy base and sessions
  models/              Database entities
  schemas/             Request/response models
  services/            Authorization, conditional mutations, workflow, Groq summaries
  main.py              FastAPI application, routers, CORS, error handlers
  seed.py              Explicit development role/team/admin bootstrap
alembic/versions/       Versioned schema migrations
frontend/
  src/
    components/        Issue workflow, discussion/summary panels, user creation
    hooks/             Shared issue mutation/conflict handling
    pages/             Application pages and forms
    App.tsx            Authentication, routing, navigation, shared shell
    api.ts             HTTP client and API methods
    types.ts           Frontend contracts
    ui.tsx             Shared UI components
    styles.css         Application styles
  tests/               Playwright fixtures and browser checks
  .env.example         Browser API URL example
  package.json         Frontend dependencies and commands
tests/                 Backend smoke, database, authorization, and integration tests
docs/                  Frontend implementation notes
.env.example           Backend configuration example
docker-compose.yml     Local PostgreSQL/API services
Dockerfile             API container build
requirements.txt       Python dependencies
ENGINEERING_DECISIONS.md
README.md
```

## Current limitations

- No public registration, email invitations, password recovery, password-change workflow, or existing-user role editing API/UI.
- No application rate limiting, refresh tokens, server-side token revocation, or automated idempotency-key cleanup.
- No comment editing/deletion, attachments, mentions, watchers, or notifications.
- No approval cancellation endpoint, decision notes, request-more-information action, or automatic payment execution.
- No stored or automatically refreshed summaries; summaries include bounded issue context rather than the full history.
- No issue deletion, closed-issue reopening, SLA engine, capacity model, or financial telemetry.
- Activity is append-only through application endpoints, but is not tamper-proof against database administrators.
- No production load-testing or operational certification is implied by the local automated checks.
