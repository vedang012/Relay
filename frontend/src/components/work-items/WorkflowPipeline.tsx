import type { WorkItem } from "../../types";
import { label } from "../../ui";
const stages = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
export function WorkflowPipeline({ item }: { item: WorkItem }) {
  return (
    <section className="panel padded">
      <h2>Lifecycle Pipeline</h2>
      <div
        className="pipeline"
        aria-label={`Current status: ${label(item.status)}`}
      >
        {stages.map((status, index) => (
          <div
            className={
              "stage " +
              (status === item.status ||
              (status === "IN_PROGRESS" && item.status === "BLOCKED")
                ? item.status === "BLOCKED"
                  ? "current stalled"
                  : "current"
                : "")
            }
            key={status}
          >
            <span>{index + 1}</span>
            <b>{label(status)}</b>
            {status === item.status && <small>Current</small>}
          </div>
        ))}
      </div>
      {item.status === "BLOCKED" && (
        <div className="warning">
          Blocked · {item.next_action || "Awaiting a next action."}
        </div>
      )}
      <p className="muted pipeline-note">
        The highlighted stage reflects the current status.
      </p>
    </section>
  );
}
