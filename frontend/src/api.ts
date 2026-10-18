import type {
  Access,
  ApprovalCreateInput,
  AssignmentRole,
  ItemCreateInput,
  ItemPatchInput,
  Status,
  Activity,
  Approval,
  AttentionRow,
  Page,
  Team,
  User,
  UserCreateInput,
  DirectoryUser,
  RoleOption,
  WorkItem,
} from "./types";
const base = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1"
).replace(/\/$/, "");
const tokenKey = "relay_access_token";
export const authToken = {
  get: () => sessionStorage.getItem(tokenKey),
  set: (value: string) => sessionStorage.setItem(tokenKey, value),
  clear: () => sessionStorage.removeItem(tokenKey),
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 15000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(options.headers);
    if (options.body) headers.set("Content-Type", "application/json");
    const token = authToken.get();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail:
        | {
            code?: string;
            message?: string;
            errors?: { location: (string | number)[]; type: string }[];
          }
        | undefined;
      try {
        detail = (await response.json()).detail;
      } catch {
        /* non-JSON error */
      }
      if (response.status === 401) {
        authToken.clear();
        window.dispatchEvent(new Event("relay:unauthorized"));
      }
      throw new ApiError(
        response.status,
        detail?.code || "http_error",
        detail?.message || `Request failed (${response.status})`,
        Object.fromEntries(
          (detail?.errors || []).map((error) => [
            String(error.location.at(-1)),
            `Invalid value (${error.type.replaceAll("_", " ")}).`,
          ]),
        ),
      );
    }
    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (!text.trim()) return undefined as T;
    if (!contentType.includes("json")) return text as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(
        response.status,
        "invalid_response",
        "Relay returned an unreadable response. Please try again.",
      );
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new ApiError(0, "timeout", "Request timed out. Please try again.");
    if (error instanceof TypeError)
      throw new ApiError(
        0,
        "network_error",
        "Cannot reach Relay. Check your connection and try again.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
export const params = (
  values: Record<string, string | number | undefined | null>,
) => {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      query.set(key, String(value));
  });
  return query.toString();
};
export type IssueComment = {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
};
export type IssueSummary = {
  summary: string;
  model: string;
  min_words: number;
  max_words: number;
  context_note: string;
};
export const api = {
  bookmark: (id: string) =>
    request<{ bookmarked: boolean }>(`/work-items/${id}/bookmark`),
  setBookmark: (id: string, saved: boolean) =>
    request<{ bookmarked: boolean } | undefined>(`/work-items/${id}/bookmark`, {
      method: saved ? "PUT" : "DELETE",
    }),
  comments: (id: string, page: number) =>
    request<Page<IssueComment>>(
      `/work-items/${id}/comments?${params({ page })}`,
    ),
  comment: (id: string, body: string) =>
    request<IssueComment>(`/work-items/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  summarize: (id: string) =>
    request<IssueSummary>(
      `/work-items/${id}/summary`,
      { method: "POST" },
      75000,
    ),
  login: (email: string, password: string) =>
    request<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<User>("/auth/me"),
  access: () => request<Access>("/auth/access"),
  users: (q: { search?: string; page?: number }) =>
    request<Page<DirectoryUser>>(`/users?${params(q)}`),
  roles: () => request<{ items: RoleOption[] }>("/roles"),
  createUser: (body: UserCreateInput) =>
    request<User>("/users", { method: "POST", body: JSON.stringify(body) }),
  teams: () => request<{ items: Team[] }>("/teams"),
  createTeam: (name: string, description: string) =>
    request<Team>("/teams", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  members: (id: string) => request<{ items: User[] }>(`/teams/${id}/members`),
  items: (q: Record<string, string | number | undefined | null>) =>
    request<Page<WorkItem>>(`/work-items?${params(q)}`),
  item: (id: string) => request<WorkItem>(`/work-items/${id}`),
  createItem: (body: ItemCreateInput, key: string) =>
    request<WorkItem>("/work-items", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
  updateItem: (id: string, body: ItemPatchInput) =>
    request<WorkItem>(`/work-items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  transition: (id: string, status: Status, version: number) =>
    request<WorkItem>(`/work-items/${id}/transitions`, {
      method: "POST",
      body: JSON.stringify({ status, version }),
    }),
  assign: (
    id: string,
    user_id: string,
    role: AssignmentRole,
    version: number,
  ) =>
    request<WorkItem>(`/work-items/${id}/assignments`, {
      method: "POST",
      body: JSON.stringify({ user_id, role, version }),
    }),
  unassign: (id: string, userId: string, version: number) =>
    request<WorkItem>(`/work-items/${id}/assignments/${userId}`, {
      method: "DELETE",
      body: JSON.stringify({ version }),
    }),
  activity: (id: string, page: number) =>
    request<Page<Activity>>(`/work-items/${id}/activity?${params({ page })}`),
  attention: (q: Record<string, string | number | undefined | null>) =>
    request<Page<AttentionRow>>(`/dashboard/attention?${params(q)}`),
  approvals: (q: Record<string, string | number | undefined | null>) =>
    request<Page<Approval>>(`/approvals?${params(q)}`),
  approval: (id: string) => request<Approval>(`/approvals/${id}`),
  decide: (id: string, status: "APPROVED" | "REJECTED", version: number) =>
    request<Approval>(`/approvals/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ status, version }),
    }),
  requestApproval: (body: ApprovalCreateInput) =>
    request<Approval>("/approvals", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
