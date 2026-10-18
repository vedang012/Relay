import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../App";
import { Dialog, Feedback, FieldError, ItemTable, Pager } from "../ui";
import { PageHead, useTeams } from "./shared";
export function TeamsPage() {
  const teams = useTeams();
  const { access } = useAuth();
  const [selected, setSelected] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const rows = teams.data?.items || [];
  const stats = useQueries({
    queries: rows.flatMap((team) => [
      {
        queryKey: ["items", "count", team.id, "OPEN"],
        queryFn: () =>
          api.items({ team_id: team.id, status: "OPEN", page_size: 1 }),
      },
      {
        queryKey: ["items", "count", team.id, "BLOCKED"],
        queryFn: () =>
          api.items({ team_id: team.id, status: "BLOCKED", page_size: 1 }),
      },
      {
        queryKey: ["items", "count", team.id, "OVERDUE"],
        queryFn: () =>
          api.items({ team_id: team.id, overdue: "true", page_size: 1 }),
      },
    ]),
  });
  const membership = useQueries({
    queries: rows.map((team) => ({
      queryKey: ["members", team.id],
      queryFn: () => api.members(team.id),
    })),
  });
  const selectedMembers =
    membership[rows.findIndex((team) => team.id === selected)];
  const work = useQuery({
    queryKey: ["items", "team", selected, page],
    queryFn: () => api.items({ team_id: selected, page_size: 10, page }),
    enabled: !!selected,
  });
  const statErrors =
    stats.some((q) => q.isError) || membership.some((q) => q.isError);
  return (
    <>
      <PageHead
        eyebrow="OPERATIONAL CAPACITY"
        title="Teams"
        description="Operational workload and active bottlenecks across the teams you can access."
      />
      <section className="panel">
        <div className="section-bar">
          <h2>Teams Workload Matrix</h2>
          {access.global_permissions.includes("team:manage") && (
            <button className="primary" onClick={() => setCreating(true)}>
              <Plus size={15} />
              Create Team
            </button>
          )}
        </div>
        {teams.isPending ? (
          <div className="feedback">Loading teams…</div>
        ) : (
          <Feedback error={teams.error} empty={!rows.length}>
            <div className="table-scroll">
              <table className="work-table">
                <thead>
                  <tr>
                    <th>Team / Domain</th>
                    <th>Open Items</th>
                    <th>Blocked</th>
                    <th>Overdue</th>
                    <th>Staffing</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((team, index) => (
                    <tr key={team.id}>
                      <td>
                        <strong>{team.name}</strong>
                        <p className="muted clamp">{team.description}</p>
                      </td>
                      <td>{stats[index * 3]?.data?.total ?? "—"}</td>
                      <td>{stats[index * 3 + 1]?.data?.total ?? "—"}</td>
                      <td>{stats[index * 3 + 2]?.data?.total ?? "—"}</td>
                      <td>{membership[index]?.data?.items.length ?? "—"}</td>
                      <td>
                        <button
                          onClick={() => {
                            setSelected(team.id);
                            setPage(1);
                          }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Feedback>
        )}
        {statErrors && (
          <div className="feedback error">
            Some team data could not be loaded.{" "}
            <button
              onClick={() => {
                stats.forEach((q) => q.refetch());
                membership.forEach((q) => q.refetch());
              }}
            >
              Retry
            </button>
          </div>
        )}
      </section>
      {selected && (
        <section className="panel padded team-detail">
          <div className="section-bar">
            <h2>{rows.find((team) => team.id === selected)?.name}</h2>
            <button onClick={() => setSelected("")}>Close</button>
          </div>
          <p className="muted">
            {selectedMembers?.data?.items.length ?? "—"} active members ·{" "}
            {work.data?.total ?? "—"} work items
          </p>
          {selectedMembers?.error && <Feedback error={selectedMembers.error} />}
          <div className="member-list">
            {selectedMembers?.data?.items.map((member) => (
              <span key={member.id}>
                <span className="avatar">{member.full_name[0]}</span>
                {member.full_name}
              </span>
            ))}
          </div>
          {work.isPending ? (
            <p>Loading work…</p>
          ) : (
            <Feedback error={work.error} empty={!work.data?.items.length}>
              <ItemTable
                items={work.data?.items || []}
                teams={rows}
                users={selectedMembers?.data?.items}
              />
              <Pager
                page={page}
                size={10}
                total={work.data?.total || 0}
                onChange={setPage}
              />
            </Feedback>
          )}
        </section>
      )}
      {creating && <CreateTeam onClose={() => setCreating(false)} />}
    </>
  );
}
function CreateTeam({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.createTeam(name.trim(), description),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["access"] });
      onClose();
    },
  });
  return (
    <Dialog title="Create Team" onClose={onClose} busy={create.isPending}>
      <div className="modal-head">
        <h2>Create Team</h2>
        <button
          aria-label="Close dialog"
          disabled={create.isPending}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !create.isPending) create.mutate();
        }}
      >
        <fieldset disabled={create.isPending}>
          <label>
            Name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <FieldError error={create.error} field="name" />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <Feedback error={create.error} />
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary">Create Team</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
