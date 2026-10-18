import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../api";
import type { WorkItem } from "../types";

export interface ItemOperation {
  label: string;
  attempted: Record<string, unknown>;
  run: () => Promise<WorkItem>;
}
export function useWorkItemActions(id: string) {
  const qc = useQueryClient();
  const [conflict, setConflict] = useState<{
    latest: WorkItem | null;
    attempted: Record<string, unknown>;
  } | null>(null);
  const [fetchError, setFetchError] = useState("");
  async function loadLatest() {
    setFetchError("");
    try {
      const latest = await api.item(id);
      setConflict((current) => (current ? { ...current, latest } : null));
    } catch {
      setFetchError(
        "Could not load the latest version. Your changes are preserved.",
      );
    }
  }
  const mutation = useMutation({
    mutationFn: (operation: ItemOperation) => operation.run(),
    onSuccess: async (latest) => {
      await qc.cancelQueries({ queryKey: ["item", id] });
      qc.setQueryData(["item", id], latest);
      for (const key of [
        "activity",
        "items",
        "attention",
        "attention-count",
        "approvals",
      ]) {
        qc.invalidateQueries({
          queryKey: key === "activity" ? [key, id] : [key],
        });
      }
      setConflict(null);
    },
    onError: async (error, operation) => {
      if (error instanceof ApiError && error.code === "stale_version") {
        setConflict({ latest: null, attempted: operation.attempted });
        await loadLatest();
      }
    },
  });
  function reconcile() {
    if (!conflict?.latest) return;
    qc.setQueryData(["item", id], conflict.latest);
    const version = conflict.latest.version;
    setConflict(null);
    mutation.reset();
    return version;
  }
  return { mutation, conflict, fetchError, loadLatest, reconcile };
}
