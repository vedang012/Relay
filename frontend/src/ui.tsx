import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "./api";
import type { Priority, Status, Team, User, WorkItem } from "./types";
export const label = (value: string) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
export const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
export const shortId = (id: string) => id.slice(0, 8).toUpperCase();
export function FieldError({
  error,
  field,
}: {
  error: unknown;
  field: string;
}) {
  const message = error instanceof ApiError ? error.fields[field] : undefined;
  return message ? (
    <span className="field-error" role="alert">
      {message}
    </span>
  ) : null;
}
export function Dialog({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = ref.current;
    const first = element?.querySelector<HTMLElement>(
      "input,button,select,textarea",
    );
    (first || element)?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Tab") {
            const elements = Array.from(
              ref.current?.querySelectorAll<HTMLElement>(
                'input:not(:disabled),button:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
              ) || [],
            );
            const first = elements[0],
              last = elements.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
export function Badge({ value }: { value: Status | Priority | string }) {
  return (
    <span className={"badge " + value.toLowerCase().replaceAll("_", "-")}>
      {label(value)}
    </span>
  );
}
export function Feedback({
  error,
  empty,
  children,
}: {
  error: unknown;
  empty?: boolean;
  children?: ReactNode;
}) {
  if (error) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="feedback error" role="alert">
        {status === 403
          ? "You do not have permission to view this."
          : status === 404
            ? "This resource was not found."
            : error instanceof Error
              ? error.message
              : "Could not load data."}
      </div>
    );
  }
  if (empty)
    return <div className="feedback">No results match these filters.</div>;
  return <>{children}</>;
}
export function Pager({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        Showing {total ? (page - 1) * size + 1 : 0}–
        {Math.min(page * size, total)} of {total}
      </span>
      <div>
        <button disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <button
          disabled={page * size >= total}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
export function ItemTable({
  items,
  teams,
  users,
  reasons,
}: {
  items: WorkItem[];
  teams: Team[];
  users?: User[];
  reasons?: Record<string, string[]>;
}) {
  return (
    <div className="table-scroll">
      <table className="work-table">
        <thead>
          <tr>
            <th>Identifier</th>
            <th>Work Item & Details</th>
            <th>Team</th>
            <th>Owner</th>
            <th>Priority</th>
            <th>Status</th>
            {reasons && <th>Attention Trigger</th>}
            <th>Due / SLA</th>
            {!reasons && <th>Updated</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="identifier">
                <Link className="code" to={`/work/${item.id}`} title={item.id}>
                  {shortId(item.id)}
                </Link>
              </td>
              <td className="item-summary">
                <Link className="item-link" to={`/work/${item.id}`}>
                  <strong>{item.title}</strong>
                </Link>
                <div className="muted clamp">
                  {item.description || item.next_action || label(item.type)}
                </div>
              </td>
              <td>
                {teams.find((t) => t.id === item.team_id)?.name ||
                  shortId(item.team_id)}
              </td>
              <td>
                {item.owner_id ? (
                  users?.find((u) => u.id === item.owner_id)?.full_name ||
                  shortId(item.owner_id)
                ) : (
                  <span className="muted">Unassigned</span>
                )}
              </td>
              <td>
                <Badge value={item.priority} />
              </td>
              <td>
                <Badge value={item.status} />
              </td>
              {reasons && (
                <td>
                  {reasons[item.id]?.map((reason) => (
                    <span className="reason" key={reason}>
                      {label(reason)}
                    </span>
                  ))}
                </td>
              )}
              <td
                className={
                  item.due_at &&
                  new Date(item.due_at) < new Date() &&
                  !["RESOLVED", "CLOSED"].includes(item.status)
                    ? "overdue"
                    : ""
                }
              >
                {date(item.due_at)}
              </td>
              {!reasons && <td>{date(item.updated_at)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
