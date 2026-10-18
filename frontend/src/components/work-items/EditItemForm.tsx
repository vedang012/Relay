import { useState } from "react";
import type { ItemChanges, Priority, WorkItem } from "../../types";
import { FieldError } from "../../ui";
import { enumOptions, priorities, Select } from "../../pages/shared";
export function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function EditItemForm({
  item,
  busy,
  error,
  onCancel,
  onSave,
}: {
  item: WorkItem;
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onSave: (body: ItemChanges) => void;
}) {
  const [draft, setDraft] = useState({
    title: item.title,
    description: item.description,
    priority: item.priority,
    next_action: item.next_action || "",
    due_at: localDateTime(item.due_at),
  });
  const changes: ItemChanges = {};
  if (draft.title.trim() !== item.title) changes.title = draft.title.trim();
  if (draft.description !== item.description)
    changes.description = draft.description;
  if (draft.priority !== item.priority) changes.priority = draft.priority;
  if (draft.next_action !== (item.next_action || ""))
    changes.next_action = draft.next_action || null;
  if (draft.due_at !== localDateTime(item.due_at))
    changes.due_at = draft.due_at ? new Date(draft.due_at).toISOString() : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.title.trim() || !Object.keys(changes).length) return;
        onSave(changes);
      }}
    >
      <fieldset className="form-grid" disabled={busy}>
        <label>
          Title
          <input
            required
            maxLength={200}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <FieldError error={error} field="title" />
        </label>
        <label>
          Priority
          <Select
            required
            value={draft.priority}
            onChange={(value) =>
              setDraft({ ...draft, priority: value as Priority })
            }
            options={enumOptions(priorities)}
            placeholder="Priority"
          />
        </label>
        <label className="wide">
          Description
          <textarea
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </label>
        <label className="wide">
          Next action
          <input
            value={draft.next_action}
            onChange={(e) =>
              setDraft({ ...draft, next_action: e.target.value })
            }
          />
        </label>
        <label>
          Due
          <input
            type="datetime-local"
            value={draft.due_at}
            onChange={(e) => setDraft({ ...draft, due_at: e.target.value })}
          />
          <FieldError error={error} field="due_at" />
        </label>
        <div className="form-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            disabled={!Object.keys(changes).length}
          >
            Save changes
          </button>
        </div>
      </fieldset>
    </form>
  );
}
