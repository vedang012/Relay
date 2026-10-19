# Engineering decisions

These decisions describe the current Relay implementation. Each entry records the choice, why it was made, and the main consequence. See [README.md](README.md) for setup and API behavior.

## 1. Keep one API service and one PostgreSQL database

**Decision.** FastAPI modules share a SQLAlchemy data model and a single PostgreSQL database. Alembic manages schema changes. The React application calls the API over HTTP.

**Why.** Work items, assignments, approvals, and activity often change together. One database transaction keeps those changes consistent without coordinating services. A single deployment also keeps the current product easier to operate.

**Consequence.** The API and database scale as a unit, and PostgreSQL is required for features such as partial unique indexes and advisory locks. Separate services should follow measured scaling or ownership needs, not precede them.

## 2. Authorize every resource through a permission and active team membership

**Decision.** Role-permission grants determine capabilities. Work-item access also requires active membership in that item's team, including when a user has a global administrator grant. List queries apply the same scope in SQL; a direct request for an inaccessible work item returns 404. Approval decisions additionally require `approval:decide`, exclude the requester, and respect a designated approver.

**Why.** A global role should not make every team's issue data visible, and an item UUID should not bypass list filtering. Approval authority is distinct from account administration.

**Consequence.** Authorization needs membership and grant joins on reads and writes. The frontend can hide unavailable controls using `/auth/access`, but the API remains the authority.

## 3. Use optimistic concurrency for work items and approval decisions

**Decision.** Work-item edits, transitions, assignment changes, approval requests, and approval decisions submit the version the user read. A work-item update increments `version` only when `id` and the expected version match. An approval decision also requires `PENDING` status. A failed comparison returns 409 and commits no success activity event.

**Why.** People may leave an edit open while another person changes the same issue. Version checks prevent a later submission from silently overwriting that work without holding a lock during editing.

**Consequence.** Clients must handle conflicts. The work-item UI fetches the latest version and shows the attempted values for review; it does not automatically replay the mutation. This is item-level concurrency, so unrelated edits to one item can still conflict.

## 4. Commit activity with the change it describes

**Decision.** Work-item changes, comments, approval actions, and their activity events are written in the same database transaction. The event stores actor, type, timestamp, and relevant old, new, or detail values.

**Why.** The timeline should not claim a change that failed, or omit a change that committed through these API paths.

**Consequence.** Application endpoints provide a consistent history, but database administrators can alter it. The activity table is not a tamper-proof audit store, and there is no external event stream.

## 5. Make work-item creation retryable with an idempotency key

**Decision.** An optional `Idempotency-Key` identifies a creation attempt per actor and operation. The API stores the input hash and created item ID behind a unique database key. A matching retry returns the item; reuse with different input returns 409. The frontend retains the key while retrying an unchanged create payload.

**Why.** A network failure can hide a successful creation from the client. Retrying should not create a duplicate issue.

**Consequence.** This guarantee applies only to work-item creation. Owner assignment is a separate request; if it fails after creation, the UI opens the created item and reports that failure. Stored keys have no automated expiry or cleanup.

## 6. Require a deployment code for administrator signup

**Decision.** Public administrator signup is disabled unless `ADMIN_SIGNUP_KEY` contains at least 32 characters. The API compares the supplied code in constant time and creates the account, initial team, global admin grant, active membership, and role catalog in one transaction. A PostgreSQL transaction advisory lock serializes concurrent catalog provisioning; database uniqueness constraints cover account and team races.

**Why.** The app needs a production bootstrap path but has no tenant or invitation system. An unrestricted signup endpoint would grant workspace-wide access to anyone.

**Consequence.** The deployment operator must protect and rotate a private code. The demo intentionally publishes its signup code through `VITE_DEMO_ADMIN_SIGNUP_KEY` on `/signup`, so anyone with access to that demo can create a workspace administrator. Normal deployments omit that frontend setting and use a different private backend code. This flow does not provide invitations, password recovery, or general self-registration.

## 7. Keep workflow rules on the server

**Decision.** A shared transition map defines valid work-item status changes and the `allowed_transitions` returned by the API. The server also requires `work_item:close` for closing an item. PostgreSQL check constraints restrict stored status, priority, and type values; a partial unique index permits at most one owner assignment per item.

**Why.** The UI needs to show the available next steps, while the server must enforce the same rules for every client. Database constraints cover integrity when application checks race or are bypassed.

**Consequence.** Adding a status or assignment rule can require coordinated API, schema, and UI updates. An approval decision does not automatically execute a payment or change the work-item status.

## 8. Derive attention and list views from current database state

**Decision.** The attention queue queries overdue, blocked, unassigned, and pending-approval conditions against work items and related rows. Work-item and approval lists use server-side filters, pagination, and permission scope; work-item lists also accept a sort choice. The frontend caches responses with TanStack Query and invalidates affected views after mutations.

**Why.** A derived queue reflects the current source of truth without a second stored status to synchronize. Server pagination avoids loading an entire workspace into the browser.

**Consequence.** Counts and lists come from separate requests and are not one atomic snapshot. The query shapes and indexes will need measurement before larger-scale use.

## 9. Keep authentication and external AI calls server controlled

**Decision.** Login issues a short-lived bearer JWT. The browser stores it in `sessionStorage` and sends it to the API; the API verifies the token and checks that the user remains active. Groq calls are made only by the API using a server-side key. The summary endpoint sends bounded issue fields and up to 30 recent comments, then checks the response format and word count.

**Why.** Browser code should not contain provider or signing secrets. Bounding the summary input limits request size and makes clear which facts the model received.

**Consequence.** Browser JavaScript can access the bearer token, so an XSS compromise could expose it. There are no refresh tokens or server-side token revocation. Summaries are generated on demand, are not stored, and can omit older discussion; provider failures surface as API errors.

## 10. Store collaboration data with its own access rules

**Decision.** Bookmarks belong to a user and use a unique user/item key. Comments belong to an issue and author; posting a comment creates a timeline event in the same transaction. Bookmark and comment endpoints first check that the caller can read the issue.

**Why.** Bookmarks are private preferences, while comments are shared issue discussion. Both must follow issue visibility even when called by item ID.

**Consequence.** Comment reads are paginated, and duplicate bookmark requests are harmless. The current API has no comment editing, deletion, mentions, or notifications.
