# Relay frontend implementation

The React application lives in `frontend/` and uses the existing FastAPI service as its source of truth. No sample records are included in application code. Browser test fixtures are confined to `frontend/tests/`.

## Screen and API map

Stitch project: `7008576518719428821` (Relay Operational Work Management). All six available HTML exports and the five page screenshots were retrieved through Stitch MCP. The current screens use a white sidebar, Inter typography, JetBrains Mono identifiers, slate surfaces, compact tables, and teal actions.

| Screen                             | Stitch screen ID                                            | API contracts                                                                                       |
| ---------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Attention Queue                    | `f326ecdee98442a98bd8cfb791edde99`                          | `GET /dashboard/attention`, `GET /teams`, `GET /teams/{id}/members`                                 |
| All Work                           | `d7322c7e44434ba2954ebf5dda03ff83`                          | `GET /work-items` with server search, filters, sort, and pagination                                 |
| Work Item Detail                   | `7262c17fdf224a12a4961f9840636878`                          | `GET/PATCH /work-items/{id}`, activity, transitions, assignment creation/removal, `POST /approvals` |
| Approvals                          | `7f7da90111244de7b88fe17a03c58476`                          | `GET /approvals`, `GET /approvals/{id}`, `POST /approvals/{id}/decision`                            |
| Teams and creation modal           | `c8c0716fe13447e6a3dc3c1c3b9256aa`                          | Teams, members, server work counts, `POST /teams`, `POST /work-items`, optional owner assignment    |
| Platform shell / Attention variant | `3cb8b049166941658e331e47a0662084`                          | Shared navigation and table reference                                                               |
| Authentication                     | No separate Stitch login screen exposed                     | `POST /auth/login`, `GET /auth/me`, `GET /auth/access`                                              |
| Users / Create User                | New requested page using existing Relay styles and controls | `GET /users`, `GET /roles`, `GET /teams`, `POST /users`                                             |

All API paths above have the `/api/v1` prefix. Frontend routes are `/attention`, `/work`, `/work/:id`, `/approvals`, `/teams`, `/users`, and `/login`.

## Backend additions

The backend initially provided write operations for teams and approvals but lacked directory reads. The implementation adds these additive contracts using the existing membership and permission rules:

- `GET /auth/access`: global grants plus effective grants for active team memberships. Work controls still require a team grant, including for administrators.
- `GET /teams`: teams where the current user has active membership and work read permission.
- `GET /teams/{team_id}/members`: active users in a readable team; no password hashes or credentials are exposed.
- `GET /approvals`: scoped, paginated approval list with status and team filters, associated work title, requester name, and decision eligibility.
- `GET /users`: directory with server search and pagination, account status, and role/team grants. Requires global `user:manage` permission, independently of frontend navigation.
- `GET /roles`: actual role choices and their team requirement, with the same global permission check. Creation retains the existing `POST /users` contract.
- Work-item responses now include `owner_id`, `assignments`, and `allowed_transitions`. Workflow rules are shared between response capabilities and transition validation.
- CORS permits the single configured `FRONTEND_ORIGIN`, with the methods and bearer/idempotency headers used by the client.

No database columns or constraints changed. The existing `alembic upgrade head` remains sufficient; no new migration is required.

Attention summaries use four supported count queries (`page_size=1`), each filtered by reason, team, and priority. Teams use supported count queries for open, blocked, and overdue work. Neither screen downloads all work to calculate counts in the browser. Counts use separate requests and therefore are not an atomic snapshot.

## State and mutations

TanStack Query caches server state. Useful All Work and Attention filters are stored in the URL. Lists are paginated on the server. Mutations update the detail cache from the server response and invalidate affected lists, counts, approvals, and activity.

An edit keeps the version that was loaded when editing began. A stale-version response preserves form values, fetches the latest item, and shows the attempted values beside server values. The user must explicitly acknowledge the comparison and submit again; there is no automatic replay. Assignment, transition, and approval-request conflicts also require review. Approval decisions handle already-decided and stale-version errors and refresh the current request.

Creation reuses its idempotency key when retrying an identical payload. Owner assignment is a separate backend operation. If creation succeeds but assignment fails, the client opens the created item and shows the assignment error so the user can complete it without creating another record.

## Authentication

The backend currently supports bearer JWTs and no cookie session or refresh endpoint. The client sends `Authorization: Bearer ...`, restores the user with `/auth/me`, clears cached user data on logout or 401, and stores the token only in `sessionStorage`. This restores a session within the current tab, but tokens remain accessible to JavaScript and are vulnerable to an XSS compromise. No secrets belong in `VITE_*` variables. HttpOnly cookies would require a corresponding backend authentication change.

## Design fields not supported by the API

The implementation preserves the available layout and renders only supported business data. These design elements have no current data or action contract:

- Human work identifiers such as `OPS-104`: the API exposes UUIDs, displayed as shortened identifiers.
- SLA rules, triage velocity, throughput charts, capacity percentages, team leads, regional labels, and financial telemetry.
- Comments, watching, mentions, snooze, generic related-work linking, and notifications. The timeline displays real activity events; related work displays the supported parent link.
- Decision comments, request-more-information, and automatic payout behavior. The decision schema accepts only approval version and approved/rejected status.
- Password recovery, refresh tokens, and editing existing users' roles.

These features are not simulated. Team creation is shown only for users with the backend's global `team:manage` grant. Assignment controls follow actual effective grants; approval decisions also enforce requester/designated-approver restrictions. Backend authorization remains authoritative.

## Verification

From `frontend/`, run `npm ci`, `npm run typecheck`, `npm run build`, `npm run format:check`, and `npm run test:e2e`. Install Chromium once with `npx playwright install chromium`. Browser tests use isolated API fixtures and verify UI request contracts; they do not establish that a live PostgreSQL deployment works.

From the repository root, run `.venv/bin/pytest -q`. Database integration tests require a dedicated disposable `TEST_DATABASE_URL` whose database name ends with `_test`; they reset that database. New backend coverage checks directory visibility, active membership, approval scoping, assignment response freshness, workflow capabilities, and CORS.

## File map

- `frontend/src/App.tsx` and `main.tsx`: protected routing, login/logout, providers, and the shared shell.
- `frontend/src/pages/`: the five pages, creation modal, and query/filter helpers.
- `frontend/src/components/work-items/`: workflow, editing, properties/assignments, and activity components.
- `frontend/src/components/users/CreateUserDialog.tsx` and `frontend/src/pages/UsersPage.tsx`: permission-protected account directory and creation form, with validation, duplicate-email recovery, password visibility, and submission guards.
- `frontend/src/hooks/useWorkItemActions.ts`: authoritative cache updates and explicit conflict reconciliation.
- `frontend/src/api.ts`, `types.ts`, `ui.tsx`, and `styles.css`: HTTP handling, request/response types, shared controls, and Stitch styling.
- `frontend/package.json`, lockfile, Vite/Tailwind/TypeScript configuration, `.env.example`, and `index.html`: frontend build and configuration.
- `app/api/auth.py`, `approvals.py`, `work_items.py`, `app/schemas/api.py`, `app/models/entities.py`, and `app/services/workflow.py`: additive read contracts, assignment serialization, and shared workflow rules.
- `app/core/config.py`, `app/main.py`, `.env.example`, and `docker-compose.yml`: explicit frontend origin and CORS.
- `frontend/tests/relay.spec.ts`, `frontend/playwright.config.ts`, and `tests/test_frontend_contracts.py`: browser and backend contract coverage.
- `frontend/tests/users.spec.ts` and `tests/test_user_onboarding.py`: onboarding, role scope, global permissions, account login, and duplicate-submission coverage.
- `.gitignore`, `README.md`, and this document: generated-file exclusions, setup, design references, and API limitations.

The onboarding addition ran all 19 backend tests successfully against a newly created disposable PostgreSQL database, then removed that test database. The running Relay database was not reset. Browser tests use isolated API fixtures to check the original workflows and user administration. Production build, TypeScript, formatting, and relevant backend Ruff checks are also included in verification.

## Frontend onboarding

Only users with a global `user:manage` grant can see **Users** or open its page. Team-scoped grants do not qualify. The directory shows names, emails, account status, and assigned role scope; passwords are never returned. Role choices come from the backend instead of a client role hierarchy.

Create User collects a name, email, initial password, role, and team. Team-required roles cannot submit without a team. The existing administrator role allows a blank team for workspace-wide permissions or a selected team for a team-scoped grant; the form explains this distinction. Successful creation refreshes the directory and team members and clears the password from the form. Duplicate-email errors preserve inputs for correction. A synchronous submit guard prevents overlapping requests; the submitted payload is captured before the request begins. Credentials are not stored in query variables, URLs, logs, or browser storage.

Initial workspace setup still requires an administrator and seeded roles. Unrestricted public registration, invitation delivery, password recovery, and modification of existing accounts are outside this onboarding flow. `/signup` separately supports administrator registration using a private deployment code, with transactional role-catalog/account/team provisioning and a return to sign in.
