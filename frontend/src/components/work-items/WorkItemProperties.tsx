import { useState } from "react";
import type { AssignmentRole, Team, User, WorkItem } from "../../types";
import { Badge, date, shortId } from "../../ui";
import { Select, enumOptions } from "../../pages/shared";
export function WorkItemProperties({
  item,
  team,
  members,
  canAssign,
  busy,
  onAssign,
  onRemove,
}: {
  item: WorkItem;
  team?: Team;
  members: User[];
  canAssign: boolean;
  busy: boolean;
  onAssign: (userId: string, role: AssignmentRole) => void;
  onRemove: (userId: string) => void;
}) {
  const [assignee, setAssignee] = useState("");
  const [role, setRole] = useState<AssignmentRole>("CONTRIBUTOR");
  const effectiveRole =
    role === "OWNER" && item.owner_id ? "CONTRIBUTOR" : role;
  const owner = members.find((member) => member.id === item.owner_id);
  return (
    <section className="panel padded">
      <h2>Properties</h2>
      <dl className="properties">
        <dt>Status</dt>
        <dd>
          <Badge value={item.status} />
        </dd>
        <dt>Priority</dt>
        <dd>
          <Badge value={item.priority} />
        </dd>
        <dt>Type</dt>
        <dd>{item.type.replaceAll("_", " ")}</dd>
        <dt>Team</dt>
        <dd>{team?.name || shortId(item.team_id)}</dd>
        <dt>Owner</dt>
        <dd>
          {owner?.full_name ||
            (item.owner_id ? shortId(item.owner_id) : "Unassigned")}
        </dd>
        <dt>Due date</dt>
        <dd>{date(item.due_at)}</dd>
        <dt>Updated</dt>
        <dd>{date(item.updated_at)}</dd>
      </dl>
      <h3>Assignments</h3>
      <ul className="assignment-list">
        {item.assignments.map((assignment) => (
          <li key={assignment.user_id}>
            <div>
              {members.find((m) => m.id === assignment.user_id)?.full_name ||
                shortId(assignment.user_id)}
              <small>{assignment.role}</small>
            </div>
            {canAssign && (
              <button
                disabled={busy}
                aria-label={`Remove ${members.find((m) => m.id === assignment.user_id)?.full_name || "assignment"}`}
                onClick={() => {
                  if (window.confirm("Remove this assignment?"))
                    onRemove(assignment.user_id);
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {!item.assignments.length && <p className="muted">No assignments yet.</p>}
      {canAssign && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (assignee) onAssign(assignee, effectiveRole);
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Assign member
              <Select
                required
                value={assignee}
                onChange={setAssignee}
                options={members
                  .filter(
                    (m) => !item.assignments.some((a) => a.user_id === m.id),
                  )
                  .map((m) => ({ value: m.id, label: m.full_name }))}
                placeholder="Select member"
              />
            </label>
            <label>
              Assignment role
              <Select
                required
                value={effectiveRole}
                onChange={(value) => setRole(value as AssignmentRole)}
                options={enumOptions(
                  item.owner_id
                    ? ["CONTRIBUTOR", "REVIEWER"]
                    : ["OWNER", "CONTRIBUTOR", "REVIEWER"],
                )}
                placeholder="Assignment role"
              />
            </label>
            <button className="primary" disabled={!assignee}>
              Add assignment
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
