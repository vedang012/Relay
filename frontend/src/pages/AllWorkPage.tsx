import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Feedback, ItemTable, Pager } from "../ui";
import {
  enumOptions,
  PageHead,
  pageNumber,
  priorities,
  Select,
  statuses,
  teamOptions,
  types,
  useMembers,
  useTeams,
} from "./shared";
export function AllWorkPage({
  bookmarkedOnly = false,
}: {
  bookmarkedOnly?: boolean;
}) {
  const teams = useTeams();
  const members = useMembers(teams.data?.items || []);
  const [params, setParams] = useSearchParams();
  const get = (key: string) => params.get(key) || "";
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };
  const page = pageNumber(get("page"));
  const [searchInput, setSearchInput] = useState(get("search"));
  const urlSearch = get("search");
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);
  const q = {
    bookmarked: bookmarkedOnly ? "true" : get("bookmarked") || undefined,
    search: get("search"),
    team_id: get("team_id"),
    status: get("status"),
    priority: get("priority"),
    assignee_id: get("assignee_id"),
    type: get("type"),
    sort: get("sort") || "updated_at",
    direction: get("direction") || "desc",
    page,
  };
  const query = useQuery({
    queryKey: ["items", q],
    queryFn: () => api.items(q),
  });
  return (
    <>
      <PageHead
        title={bookmarkedOnly ? "Bookmarks" : "All work"}
        description={
          bookmarkedOnly
            ? "Your saved issues, ready to pick up where you left off."
            : "Complete directory of operational tasks, incidents, and engineering investigations."
        }
      />
      <section className="panel">
        <div className="filters filter-grid">
          <form
            className="list-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              set("search", searchInput);
            }}
          >
            <input
              aria-label="Search work"
              placeholder="Search work items…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit">Search</button>
          </form>
          {!bookmarkedOnly && (
            <Select
              value={get("bookmarked")}
              onChange={(v) => set("bookmarked", v)}
              options={[{ value: "true", label: "Bookmarked" }]}
              placeholder="All work · saved or unsaved"
            />
          )}
          <Select
            value={get("team_id")}
            onChange={(v) => set("team_id", v)}
            options={teamOptions(teams.data?.items || [])}
            placeholder="All Teams"
          />
          <Select
            value={get("status")}
            onChange={(v) => set("status", v)}
            options={enumOptions(statuses)}
            placeholder="All Statuses"
          />
          <Select
            value={get("priority")}
            onChange={(v) => set("priority", v)}
            options={enumOptions(priorities)}
            placeholder="All Priorities"
          />
          <Select
            value={get("assignee_id")}
            onChange={(v) => set("assignee_id", v)}
            options={members.map((m) => ({ value: m.id, label: m.full_name }))}
            placeholder="All Assignees"
          />
          <Select
            value={get("type")}
            onChange={(v) => set("type", v)}
            options={enumOptions(types)}
            placeholder="All Types"
          />
          <Select
            value={get("sort")}
            onChange={(v) => set("sort", v)}
            options={enumOptions([
              "created_at",
              "updated_at",
              "due_at",
              "priority",
              "status",
            ])}
            placeholder="Sort: Updated"
          />
          <Select
            value={get("direction")}
            onChange={(v) => set("direction", v)}
            options={[
              { value: "desc", label: "Descending" },
              { value: "asc", label: "Ascending" },
            ]}
            placeholder="Descending"
          />
        </div>
        {teams.error && <Feedback error={teams.error} />}
        {params.size > 0 && (
          <div className="filter-summary">
            <span>Filters and sort saved in this URL</span>
            <button onClick={() => setParams({})}>Clear filters</button>
          </div>
        )}
        {query.isPending ? (
          <div className="feedback">Loading work items…</div>
        ) : (
          <Feedback error={query.error} empty={!query.data?.items.length}>
            <ItemTable
              items={query.data?.items || []}
              teams={teams.data?.items || []}
              users={members}
            />
            <Pager
              page={page}
              size={query.data?.page_size || 20}
              total={query.data?.total || 0}
              onChange={(p) => set("page", String(p))}
            />
          </Feedback>
        )}
      </section>
    </>
  );
}
