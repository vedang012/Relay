import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import type { User } from "../../types";
import { date, Feedback, label, Pager, shortId } from "../../ui";
export function ActivityTimeline({
  id,
  members,
}: {
  id: string;
  members: User[];
}) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["activity", id, page],
    queryFn: () => api.activity(id, page),
  });
  return (
    <section className="panel padded">
      <h2>Activity timeline</h2>
      {query.isPending ? (
        <p className="muted">Loading activity…</p>
      ) : (
        <Feedback error={query.error} empty={!query.data?.items.length}>
          <div className="timeline">
            {query.data?.items.map((event) => (
              <div className="event" key={event.id}>
                <span className="event-dot" />
                <div>
                  <strong>{label(event.event_type)}</strong>
                  <small>
                    {date(event.created_at)} ·{" "}
                    {event.actor_id
                      ? members.find((m) => m.id === event.actor_id)
                          ?.full_name || shortId(event.actor_id)
                      : "System"}
                  </small>
                  <p>
                    {Object.entries(event.new_values || {})
                      .map(
                        ([key, value]) =>
                          `${label(key)}: ${value === null ? "Cleared" : typeof value === "string" ? value : JSON.stringify(value)}`,
                      )
                      .join(" · ")}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <Pager
            page={page}
            size={query.data?.page_size || 20}
            total={query.data?.total || 0}
            onChange={setPage}
          />
        </Feedback>
      )}
    </section>
  );
}
