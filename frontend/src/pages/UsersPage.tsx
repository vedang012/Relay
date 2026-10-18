import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../App";
import { CreateUserDialog } from "../components/users/CreateUserDialog";
import { Badge, Feedback, label, Pager } from "../ui";
import { PageHead, pageNumber } from "./shared";

export function UsersPage() {
  const { access } = useAuth();
  if (!access.global_permissions.includes("user:manage"))
    return (
      <Feedback error={new ApiError(403, "forbidden", "Permission required")} />
    );
  return <UserDirectory />;
}
function UserDirectory() {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") || "";
  const page = pageNumber(params.get("page"));
  const [draftSearch, setDraftSearch] = useState(search);
  useEffect(() => setDraftSearch(search), [search]);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const query = useQuery({
    queryKey: ["users", { search, page }],
    queryFn: () => api.users({ search, page }),
  });
  return (
    <>
      <PageHead
        eyebrow="WORKSPACE ADMINISTRATION"
        title="Users"
        description="Create accounts and review role access across your workspace."
      />
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button aria-label="Dismiss message" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}
      <section className="panel">
        <div className="section-bar">
          <form
            className="list-search users-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              setParams(
                draftSearch.trim() ? { search: draftSearch.trim() } : {},
              );
            }}
          >
            <input
              aria-label="Search users"
              maxLength={200}
              placeholder="Search by name or email…"
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
            />
            <button type="submit">Search</button>
          </form>
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            Create User
          </button>
        </div>
        {query.isPending ? (
          <div className="feedback" role="status">
            Loading users…
          </div>
        ) : (
          <>
            <Feedback error={query.error} empty={!query.data?.items.length}>
              <div className="table-scroll">
                <table className="work-table users-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role / scope</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data?.items.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <strong>{user.full_name}</strong>
                        </td>
                        <td>{user.email}</td>
                        <td>
                          {user.grants.length ? (
                            user.grants.map((grant, index) => (
                              <div
                                className="user-grant"
                                key={`${grant.role_code}-${grant.team_id}-${index}`}
                              >
                                <span>{label(grant.role_code)}</span>
                                <span className="muted">
                                  {grant.team_id
                                    ? grant.team_name || "Team"
                                    : "Workspace"}
                                </span>
                              </div>
                            ))
                          ) : (
                            <span className="muted">No role assigned</span>
                          )}
                        </td>
                        <td>
                          <Badge value={user.active ? "ACTIVE" : "INACTIVE"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Feedback>
            {query.error ? (
              <div className="pager">
                <button onClick={() => query.refetch()}>
                  Retry loading users
                </button>
              </div>
            ) : (
              <Pager
                page={page}
                total={query.data?.total || 0}
                size={query.data?.page_size || 20}
                onChange={(next) => {
                  const values = new URLSearchParams(params);
                  values.set("page", String(next));
                  setParams(values);
                }}
              />
            )}
          </>
        )}
      </section>
      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={(user) => {
            setNotice(
              `${user.full_name} was created and can now sign in with the initial password.`,
            );
            setParams({});
            setCreating(false);
          }}
        />
      )}
    </>
  );
}
