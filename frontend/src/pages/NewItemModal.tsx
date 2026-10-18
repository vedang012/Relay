import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../App";
import type { ItemType, Priority } from "../types";
import { Dialog, Feedback, FieldError, label } from "../ui";
import {
  enumOptions,
  priorities,
  Select,
  teamOptions,
  types,
  useTeams,
} from "./shared";

export function NewItemModal({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const teams = useTeams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [teamId, setTeamId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ItemType>("OTHER");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [due, setDue] = useState("");
  const [parent, setParent] = useState("");
  const [assignee, setAssignee] = useState("");
  const [validation, setValidation] = useState("");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const members = useQuery({
    queryKey: ["members", teamId],
    queryFn: () => api.members(teamId),
    enabled: !!teamId,
  });
  const create = useMutation({
    mutationFn: async () => {
      const body = {
        team_id: teamId,
        title: title.trim(),
        description,
        type,
        priority,
        due_at: due ? new Date(due).toISOString() : null,
        parent_id: parent || null,
      };
      const payload = JSON.stringify(body);
      if (attempt.current?.payload !== payload)
        attempt.current = { payload, key: crypto.randomUUID() };
      let item = await api.createItem(body, attempt.current!.key);
      let notice = "";
      if (assignee && can("work_item:assign", teamId)) {
        try {
          item = await api.assign(item.id, assignee, "OWNER", item.version);
        } catch (error) {
          notice = `Work item created. Assignment failed: ${error instanceof Error ? error.message : "Try assigning from Properties."}`;
        }
      }
      return { item, notice };
    },
    onSuccess: ({ item, notice }) => {
      qc.setQueryData(["item", item.id], item);
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["attention"] });
      qc.invalidateQueries({ queryKey: ["attention-count"] });
      onClose();
      navigate(`/work/${item.id}`, { state: { notice } });
    },
  });
  return (
    <Dialog
      title="Create New Work Item"
      onClose={onClose}
      busy={create.isPending}
    >
      <div className="modal-head">
        <div>
          <h2>Create New Work Item</h2>
          <p>Register a task, incident, or operational blocker</p>
        </div>
        <button
          aria-label="Close dialog"
          className="icon-button"
          disabled={create.isPending}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (create.isPending) return;
          if (!teamId || !title.trim()) {
            setValidation("Title and team are required.");
            return;
          }
          setValidation("");
          create.mutate();
        }}
      >
        <fieldset disabled={create.isPending} className="form-grid">
          <label className="wide">
            Title
            <input
              autoFocus
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Clear, concise problem statement"
            />
            <FieldError error={create.error} field="title" />
          </label>
          <label>
            Type
            <Select
              required
              value={type}
              onChange={(v) => setType(v as ItemType)}
              options={enumOptions(types)}
              placeholder="Type"
            />
            <FieldError error={create.error} field="type" />
          </label>
          <label>
            Team Assignment
            <Select
              required
              value={teamId}
              onChange={(v) => {
                setTeamId(v);
                setAssignee("");
              }}
              options={teamOptions(
                (teams.data?.items || []).filter((t) =>
                  can("work_item:create", t.id),
                ),
              )}
              placeholder="Select team"
            />
            <FieldError error={create.error} field="team_id" />
          </label>
          {can("work_item:assign", teamId) && (
            <label>
              Assignee
              <Select
                value={assignee}
                onChange={setAssignee}
                options={(members.data?.items || []).map((m) => ({
                  value: m.id,
                  label: m.full_name,
                }))}
                placeholder="Unassigned"
              />
            </label>
          )}
          <label>
            Target Resolution Due
            <input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
            <FieldError error={create.error} field="due_at" />
          </label>
          <fieldset className="wide priority-choice">
            <legend>Priority Severity</legend>
            <div>
              {[...priorities].reverse().map((value) => (
                <label
                  className={priority === value ? "chosen" : ""}
                  key={value}
                >
                  <input
                    type="radio"
                    name="priority"
                    value={value}
                    checked={priority === value}
                    onChange={() => setPriority(value)}
                  />
                  <span>{label(value)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="wide">
            Parent Work Item ID
            <input
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              placeholder="Optional UUID"
              pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            />
            <FieldError error={create.error} field="parent_id" />
          </label>
          <label className="wide">
            Description & Context
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </fieldset>
        {teams.error && <Feedback error={teams.error} />}
        {members.error && <Feedback error={members.error} />}
        {validation && (
          <p className="field-error" role="alert">
            {validation}
          </p>
        )}
        {create.error && <Feedback error={create.error} />}
        <div className="modal-actions">
          <button type="button" disabled={create.isPending} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={create.isPending || teams.isPending || !!teams.error}
          >
            <Plus size={16} />
            {create.isPending ? "Creating…" : "Create Work Item"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
