import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../App";
import { ActivityTimeline } from "../components/work-items/ActivityTimeline";
import { EditItemForm } from "../components/work-items/EditItemForm";
import {
  BookmarkButton,
  IssueDiscussion,
  IssueSummaryPanel,
} from "../components/work-items/IssueCollaboration";
import { WorkflowPipeline } from "../components/work-items/WorkflowPipeline";
import { WorkItemProperties } from "../components/work-items/WorkItemProperties";
import { useWorkItemActions } from "../hooks/useWorkItemActions";
import type { WorkItem } from "../types";
import { Badge, Feedback, FieldError, label, shortId } from "../ui";
import { useTeams } from "./shared";

export function DetailPage() {
  const { id } = useParams();
  return id ? (
    <ItemDetail key={id} id={id} />
  ) : (
    <Feedback error={new Error("Work item not found.")} />
  );
}
function ItemDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const location = useLocation();
  const [notice, setNotice] = useState<string>(location.state?.notice || "");
  const item = useQuery({
    queryKey: ["item", id],
    queryFn: () => api.item(id),
  });
  const teams = useTeams();
  const members = useQuery({
    queryKey: ["members", item.data?.team_id],
    queryFn: () => api.members(item.data!.team_id),
    enabled: !!item.data,
  });
  const { mutation, conflict, fetchError, loadLatest, reconcile } =
    useWorkItemActions(id);
  const [editing, setEditing] = useState<WorkItem | null>(null);
  const [editVersion, setEditVersion] = useState(0);
  const [approvalType, setApprovalType] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  if (item.isPending)
    return (
      <div className="feedback" role="status">
        Loading work item…
      </div>
    );
  if (item.error) return <Feedback error={item.error} />;
  const w = item.data;
  const busy = mutation.isPending || !!conflict;
  const submitApproval = () =>
    mutation.mutate(
      {
        label: "Approval requested",
        attempted: {
          approval_type: approvalType,
          approval_reason: approvalReason,
        },
        run: async () => {
          await api.requestApproval({
            work_item_id: id,
            version: w.version,
            type: approvalType.trim(),
            reason: approvalReason.trim(),
          });
          return api.item(id);
        },
      },
      {
        onSuccess: () => {
          setApprovalType("");
          setApprovalReason("");
          setNotice("Approval requested.");
        },
      },
    );
  return (
    <>
      <Link to="/attention" className="back">
        <ArrowLeft size={15} />
        Back to Attention Queue
      </Link>
      <div className="detail-head">
        <div>
          <div className="eyebrow code">
            {shortId(w.id)} ·{" "}
            {teams.data?.items.find((t) => t.id === w.team_id)?.name ||
              shortId(w.team_id)}
          </div>
          <h1>{w.title}</h1>
          <div className="badge-row">
            <Badge value={w.priority} />
            <Badge value={w.status} />
          </div>
        </div>
        <BookmarkButton id={id} />
      </div>
      <section className="status-control" aria-label="Change issue status">
        <div>
          <span className="eyebrow">Move this issue forward</span>
          <h2>Change status</h2>
          <span>Currently: {label(w.status)}</span>
        </div>
        <div className="actions">
          {can("work_item:transition", w.team_id) &&
            w.allowed_transitions
              .filter(
                (status) =>
                  status !== "CLOSED" || can("work_item:close", w.team_id),
              )
              .map((status) => (
                <button
                  className="primary"
                  key={status}
                  disabled={busy || !!editing}
                  onClick={() =>
                    mutation.mutate(
                      {
                        label: "Status updated",
                        attempted: { status },
                        run: () => api.transition(id, status, w.version),
                      },
                      { onSuccess: () => setNotice("Status updated.") },
                    )
                  }
                >
                  {label(status)}
                </button>
              ))}
        </div>
        {!can("work_item:transition", w.team_id) && (
          <p>Your role can view this status.</p>
        )}
        {w.allowed_transitions.length === 0 && (
          <p>This issue has reached its final stage.</p>
        )}
      </section>
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button aria-label="Dismiss message" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}
      {mutation.error && !conflict && <Feedback error={mutation.error} />}
      {conflict && (
        <div className="conflict" role="alert">
          <strong>Another user changed this item.</strong>
          <p>
            Your changes are preserved. Review the latest values, then
            explicitly submit your changes again.
          </p>
          {conflict.latest ? (
            <>
              <p>
                Latest: {conflict.latest.title} ·{" "}
                {label(conflict.latest.status)} · Version{" "}
                {conflict.latest.version}
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Your submission</th>
                      <th>Latest server value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(conflict.attempted)
                      .filter(([key]) => key !== "version")
                      .map(([key, value]) => (
                        <tr key={key}>
                          <td>{label(key)}</td>
                          <td>{String(value ?? "—")}</td>
                          <td>
                            {String(
                              conflict.latest![key as keyof WorkItem] ?? "—",
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={() => {
                  const version = reconcile();
                  if (version) setEditVersion(version);
                }}
              >
                Review complete — use latest version
              </button>
            </>
          ) : (
            <>
              <p>{fetchError || "Loading the latest version…"}</p>
              {fetchError && (
                <button onClick={loadLatest}>
                  Retry loading latest version
                </button>
              )}
            </>
          )}
        </div>
      )}
      <div className="detail-grid">
        <div className="detail-main">
          <WorkflowPipeline item={w} />
          <IssueSummaryPanel id={id} />
          <section className="panel padded">
            <div className="section-bar">
              <h2>Description</h2>
              {can("work_item:update", w.team_id) && !editing && (
                <button
                  disabled={busy}
                  onClick={() => {
                    mutation.reset();
                    setEditing(w);
                    setEditVersion(w.version);
                  }}
                >
                  Edit
                </button>
              )}
            </div>
            {editing ? (
              <EditItemForm
                item={editing}
                busy={busy}
                error={mutation.error}
                onCancel={() => {
                  setEditing(null);
                  mutation.reset();
                }}
                onSave={(body) =>
                  mutation.mutate(
                    {
                      label: "Changes saved",
                      attempted: { ...body },
                      run: () =>
                        api.updateItem(id, { ...body, version: editVersion }),
                    },
                    {
                      onSuccess: () => {
                        setEditing(null);
                        setNotice("Changes saved.");
                      },
                    },
                  )
                }
              />
            ) : (
              <>
                <p className="body-copy">
                  {w.description || "No description provided."}
                </p>
                <h3>Next action</h3>
                <p className="body-copy">
                  {w.next_action || "No next action set."}
                </p>
              </>
            )}
          </section>
          <section className="panel padded">
            <h2>Related work</h2>
            {w.parent_id ? (
              <Link to={`/work/${w.parent_id}`} className="related">
                Parent work item · {shortId(w.parent_id)}
              </Link>
            ) : (
              <p className="muted">No parent work item linked.</p>
            )}
          </section>
          <IssueDiscussion id={id} />
          <ActivityTimeline id={id} members={members.data?.items || []} />
        </div>
        <aside className="detail-side">
          <WorkItemProperties
            item={w}
            team={teams.data?.items.find((t) => t.id === w.team_id)}
            members={members.data?.items || []}
            canAssign={can("work_item:assign", w.team_id)}
            busy={busy || !!editing}
            onAssign={(userId, role) =>
              mutation.mutate(
                {
                  label: "Assignment added",
                  attempted: { user_id: userId, role },
                  run: () => api.assign(id, userId, role, w.version),
                },
                { onSuccess: () => setNotice("Assignment added.") },
              )
            }
            onRemove={(userId) =>
              mutation.mutate(
                {
                  label: "Assignment removed",
                  attempted: { user_id: userId },
                  run: () => api.unassign(id, userId, w.version),
                },
                { onSuccess: () => setNotice("Assignment removed.") },
              )
            }
          />
          {members.error && <Feedback error={members.error} />}
          {can("approval:request", w.team_id) && (
            <section className="panel padded">
              <h2>Request approval</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (approvalType.trim() && approvalReason.trim())
                    submitApproval();
                }}
              >
                <fieldset disabled={busy || !!editing}>
                  <label>
                    Approval type
                    <input
                      required
                      maxLength={60}
                      value={approvalType}
                      onChange={(e) => setApprovalType(e.target.value)}
                    />
                    <FieldError error={mutation.error} field="type" />
                  </label>
                  <label>
                    Reason
                    <textarea
                      required
                      value={approvalReason}
                      onChange={(e) => setApprovalReason(e.target.value)}
                    />
                    <FieldError error={mutation.error} field="reason" />
                  </label>
                  <button className="primary">Request approval</button>
                </fieldset>
              </form>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
