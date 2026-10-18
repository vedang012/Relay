import { useQueries, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { ItemType, Priority, Status, Team } from "../types";
import { label } from "../ui";
export const statuses: Status[] = [
  "OPEN",
  "IN_PROGRESS",
  "BLOCKED",
  "RESOLVED",
  "CLOSED",
];
export const priorities: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const types: ItemType[] = [
  "CUSTOMER_ISSUE",
  "ENGINEERING",
  "INCIDENT",
  "PAYMENT",
  "COMPLIANCE",
  "APPROVAL",
  "OTHER",
];
export function useTeams() {
  return useQuery({ queryKey: ["teams"], queryFn: api.teams });
}
export function useMembers(teams: Team[]) {
  return useQueries({
    queries: teams.map((t) => ({
      queryKey: ["members", t.id],
      queryFn: () => api.members(t.id),
      staleTime: 60000,
    })),
  })
    .flatMap((q) => q.data?.items || [])
    .filter((u, i, all) => all.findIndex((x) => x.id === u.id) === i);
}
export function PageHead({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
export function useFilter(name: string) {
  const [params, setParams] = useSearchParams();
  return [
    params.get(name) || "",
    (value: string) => {
      const next = new URLSearchParams(params);
      if (value) next.set(name, value);
      else next.delete(name);
      next.delete("page");
      setParams(next);
    },
  ] as const;
}
export function Select({
  value,
  onChange,
  options,
  placeholder,
  required = false,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={placeholder}
      required={required}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
export const teamOptions = (teams: Team[]) =>
  teams.map((t) => ({ value: t.id, label: t.name }));
export const enumOptions = (values: string[]) =>
  values.map((v) => ({ value: v, label: label(v) }));
export const pageNumber = (value: string | null) => {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
};
