# Engineering decisions

1. **Modular monolith.** A single service and database keep transactions, deployment and review simple for this challenge. Separate services would add network failure and consistency concerns. Modules leave room to extract bounded contexts later if there is evidence for it.
2. **RBAC with team scope.** Role-permission rows grant capabilities; active memberships constrain resource access. A global admin grant still requires team membership for work items. This adds join cost but prevents cross-team UUID access. Administration does not imply approval authority.
3. **Conditional version updates.** Every work item mutation uses `UPDATE ... WHERE version = expected`, and approval decisions also require pending status. The loser receives 409 without a success event. This avoids holding locks while a user edits; clients must reconcile stale changes.
4. **Transactional activity.** State changes and application events share one database transaction. This offers reliable application history but database administrators can alter history. A separate immutable audit store is future work.
5. **Creation idempotency.** A unique database key per actor and operation stores a payload hash and resource ID. Concurrent repeats serialize at the constraint. This is limited to work-item creation; keys currently require manual retention management.
