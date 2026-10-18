export type Status = "OPEN" | "IN_PROGRESS" | "BLOCKED" | "RESOLVED" | "CLOSED";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AssignmentRole = "OWNER" | "CONTRIBUTOR" | "REVIEWER";
export interface ItemCreateInput {
  team_id: string;
  title: string;
  type: ItemType;
  description?: string;
  parent_id?: string | null;
  priority?: Priority;
  next_action?: string | null;
  due_at?: string | null;
}
export interface ItemChanges {
  title?: string;
  description?: string;
  priority?: Priority;
  next_action?: string | null;
  due_at?: string | null;
}
export interface ItemPatchInput extends ItemChanges {
  version: number;
}
export interface ApprovalCreateInput {
  work_item_id: string;
  version: number;
  type: string;
  reason: string;
  approver_id?: string | null;
}
export type ItemType =
  | "CUSTOMER_ISSUE"
  | "ENGINEERING"
  | "INCIDENT"
  | "PAYMENT"
  | "COMPLIANCE"
  | "APPROVAL"
  | "OTHER";
export interface User {
  id: string;
  full_name: string;
  email: string;
  active: boolean;
}
export interface UserCreateInput {
  full_name: string;
  email: string;
  password: string;
  role_code: string;
  team_id: string | null;
}
export interface RoleOption {
  code: string;
  requires_team: boolean;
}
export interface DirectoryUser extends User {
  grants: {
    role_code: string;
    team_id: string | null;
    team_name: string | null;
  }[];
}
export interface Team {
  id: string;
  name: string;
  description: string;
}
export interface Access {
  global_permissions: string[];
  teams: { team_id: string; permissions: string[] }[];
}
export interface WorkItem {
  id: string;
  parent_id: string | null;
  team_id: string;
  creator_id: string;
  owner_id: string | null;
  assignments: { user_id: string; role: AssignmentRole }[];
  allowed_transitions: Status[];
  title: string;
  description: string;
  type: ItemType;
  status: Status;
  priority: Priority;
  next_action: string | null;
  due_at: string | null;
  resolved_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface Approval {
  id: string;
  work_item_id: string;
  requester_id: string;
  approver_id: string | null;
  type: string;
  reason: string;
  status: string;
  version: number;
  requested_at: string;
  decided_at: string | null;
  work_item_title?: string;
  requester_name?: string;
  team_id?: string;
  can_decide?: boolean;
}
export interface Activity {
  id: string;
  event_type: string;
  actor_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  created_at: string;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
export interface AttentionRow {
  work_item: WorkItem;
  reasons: string[];
}
