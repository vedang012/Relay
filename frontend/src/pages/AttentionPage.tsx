import { useQueries, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Feedback, ItemTable, label, Pager } from "../ui";
import {
  enumOptions,
  PageHead,
  pageNumber,
  priorities,
  Select,
  teamOptions,
  useFilter,
  useMembers,
  useTeams,
} from "./shared";
export function AttentionPage() {
  const teams = useTeams();
  const members = useMembers(teams.data?.items || []);
  const [reason, setReason] = useFilter("reason");
  const [team, setTeam] = useFilter("team_id");
  const [priority, setPriority] = useFilter("priority");
  const [params, setParams] = useSearchParams();
  const page = pageNumber(params.get("page"));
  const query = useQuery({
    queryKey: ["attention", { reason, team, priority, page }],
    queryFn: () => api.attention({ reason, team_id: team, priority, page }),
    refetchInterval: 30000,
  });
  const counts = useQueries({
    queries: ["OVERDUE", "BLOCKED", "UNASSIGNED", "PENDING_APPROVAL"].map(
      (reason) => ({
        queryKey: ["attention-count", reason, team, priority],
        queryFn: () =>
          api.attention({ reason, team_id: team, priority, page_size: 1 }),
        refetchInterval: 30000,
      }),
    ),
  });
  const rows = query.data?.items || [];
  const reasons = Object.fromEntries(
    rows.map((r) => [r.work_item.id, r.reasons]),
  );
  return (
    <>
      <PageHead
        eyebrow="QUEUE DISPATCHER · LIVE ROUTING"
        title="Your attention"
        description="Work that needs a decision or a next step across operational units."
      />
      <div className="metric-grid">
        {["OVERDUE", "BLOCKED", "UNASSIGNED", "PENDING_APPROVAL"].map(
          (name, i) => (
            <button
              className={"metric " + (reason === name ? "selected" : "")}
              key={name}
              onClick={() => setReason(reason === name ? "" : name)}
            >
              <span>{label(name)}</span>
              <strong>{counts[i].data?.total ?? "—"}</strong>
              <small>
                {name === "PENDING_APPROVAL"
                  ? "Pending sign-off"
                  : "Needs attention"}
              </small>
            </button>
          ),
        )}
      </div>
      {counts.some((count) => count.isError) && (
        <div className="feedback error">
          Some summary counts could not be loaded.{" "}
          <button onClick={() => counts.forEach((count) => count.refetch())}>
            Retry
          </button>
        </div>
      )}
      {teams.error && <Feedback error={teams.error} />}
      <section className="panel">
        <div className="section-bar">
          <div>
            <h2>Needs attention</h2>
            <span className="muted">
              {query.data?.total ?? "—"} active items
            </span>
          </div>
          <div className="filters">
            <Select
              value={team}
              onChange={setTeam}
              options={teamOptions(teams.data?.items || [])}
              placeholder="All Teams"
            />
            <Select
              value={priority}
              onChange={setPriority}
              options={enumOptions(priorities)}
              placeholder="All Priorities"
            />
            <Select
              value={reason}
              onChange={setReason}
              options={enumOptions([
                "OVERDUE",
                "BLOCKED",
                "UNASSIGNED",
                "PENDING_APPROVAL",
              ])}
              placeholder="All Reasons"
            />
          </div>
        </div>
        {query.isPending ? (
          <div className="feedback">Loading attention queue…</div>
        ) : (
          <Feedback error={query.error} empty={!rows.length}>
            <ItemTable
              items={rows.map((r) => r.work_item)}
              teams={teams.data?.items || []}
              users={members}
              reasons={reasons}
            />
            <Pager
              page={page}
              size={query.data?.page_size || 20}
              total={query.data?.total || 0}
              onChange={(p) => {
                const next = new URLSearchParams(params);
                next.set("page", String(p));
                setParams(next);
              }}
            />
          </Feedback>
        )}
      </section>
      <p className="refresh-note">
        Refreshes every 30 seconds. Counts reflect the selected team and
        priority.
      </p>
    </>
  );
}
