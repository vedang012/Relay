import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../App";
import type { Approval } from "../types";
import { Badge, date, Feedback, label, Pager, shortId } from "../ui";
import { PageHead, Select, teamOptions, useTeams } from "./shared";
export function ApprovalsPage() {
  const { user, can } = useAuth();
  const teams = useTeams();
  const [tab, setTab] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [team, setTeam] = useState("");
  const q = useQuery({
    queryKey: ["approvals", tab, team, page],
    queryFn: () => api.approvals({ status: tab, team_id: team, page }),
  });
  const [selected, setSelected] = useState<Approval | null>(null);
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const item = useQuery({
    queryKey: ["item", selected?.work_item_id],
    queryFn: () => api.item(selected!.work_item_id),
    enabled: !!selected,
  });
  const decision = useMutation({
    mutationFn: (status: "APPROVED" | "REJECTED") =>
      api.decide(selected!.id, status, selected!.version),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["attention"] });
      qc.invalidateQueries({ queryKey: ["attention-count"] });
      if (selected)
        qc.invalidateQueries({ queryKey: ["activity", selected.work_item_id] });
      setPage(1);
      setSelected(null);
      setError("");
    },
    onError: async (e) => {
      setError(e instanceof Error ? e.message : "Decision failed");
      if (e instanceof ApiError && e.status === 409 && selected) {
        try {
          const latest = await api.approval(selected.id);
          setSelected({ ...selected, ...latest });
        } catch {
          setError(
            "The request changed, but its latest state could not be loaded. Select it again to retry.",
          );
        }
        qc.invalidateQueries({ queryKey: ["approvals"] });
      }
    },
  });
  const eligible =
    selected &&
    item.data &&
    can("approval:decide", item.data.team_id) &&
    selected.requester_id !== user.id &&
    (!selected.approver_id || selected.approver_id === user.id) &&
    selected.status === "PENDING";
  return (
    <>
      <PageHead
        eyebrow="QUEUE ID // APR-INBOX"
        title="Approvals"
        description="Operational requests awaiting an authorized decision."
      />
      <div className="tabs">
        {["PENDING", "APPROVED", "REJECTED"].map((t) => (
          <button
            className={tab === t ? "active" : ""}
            disabled={decision.isPending}
            key={t}
            onClick={() => {
              setTab(t);
              setPage(1);
              setSelected(null);
            }}
          >
            {label(t)}
          </button>
        ))}
      </div>
      <div className="section-bar">
        <h2>
          {label(tab)} requests{" "}
          <span className="muted">{q.data?.total ?? "—"}</span>
        </h2>
        <Select
          value={team}
          onChange={(v) => {
            setTeam(v);
            setPage(1);
            setSelected(null);
          }}
          options={teamOptions(teams.data?.items || [])}
          placeholder="All Teams"
        />
      </div>
      {error && (
        <div className="feedback error" role="alert">
          {error}
        </div>
      )}
      <div className="approval-layout">
        <section className="panel approval-list">
          {q.isPending ? (
            <div className="feedback">Loading approvals…</div>
          ) : (
            <Feedback error={q.error} empty={!q.data?.items.length}>
              {q.data?.items.map((a) => (
                <button
                  disabled={decision.isPending}
                  className={
                    "approval-card " + (selected?.id === a.id ? "selected" : "")
                  }
                  key={a.id}
                  onClick={() => setSelected(a)}
                >
                  <span className="code">
                    {shortId(a.id)} · {label(a.type)}
                  </span>
                  <strong>{a.reason}</strong>
                  <span className="muted">
                    {a.work_item_title || shortId(a.work_item_id)} ·{" "}
                    {a.requester_name || shortId(a.requester_id)} · Requested{" "}
                    {date(a.requested_at)}
                  </span>
                  <Badge value={a.status} />
                </button>
              ))}
              <Pager
                page={page}
                size={q.data?.page_size || 20}
                total={q.data?.total || 0}
                onChange={setPage}
              />
            </Feedback>
          )}
        </section>
        <section className="panel padded approval-detail">
          {selected ? (
            <>
              <div className="eyebrow">REQUEST {shortId(selected.id)}</div>
              <h2>{label(selected.type)}</h2>
              <p className="body-copy">{selected.reason}</p>
              <dl className="properties">
                <dt>Status</dt>
                <dd>
                  <Badge value={selected.status} />
                </dd>
                <dt>Requester</dt>
                <dd>
                  {selected.requester_name || shortId(selected.requester_id)}
                </dd>
                <dt>Requested</dt>
                <dd>{date(selected.requested_at)}</dd>
                <dt>Work item</dt>
                <dd>
                  <Link to={`/work/${selected.work_item_id}`}>
                    {item.data?.title || shortId(selected.work_item_id)}
                  </Link>
                </dd>
              </dl>
              {item.error && <Feedback error={item.error} />}
              {eligible ? (
                <div className="decision-actions">
                  <button
                    className="primary"
                    disabled={decision.isPending}
                    onClick={() => {
                      if (window.confirm("Approve this request?"))
                        decision.mutate("APPROVED");
                    }}
                  >
                    <Check size={15} />
                    Approve Request
                  </button>
                  <button
                    disabled={decision.isPending}
                    onClick={() => {
                      if (window.confirm("Reject this request?"))
                        decision.mutate("REJECTED");
                    }}
                  >
                    <X size={15} />
                    Reject Request
                  </button>
                </div>
              ) : (
                <p className="muted">
                  Decision actions are available only to eligible approvers.
                </p>
              )}
            </>
          ) : (
            <div className="feedback">Select a request to see its details.</div>
          )}
        </section>
      </div>
    </>
  );
}
