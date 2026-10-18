from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator
import re
from typing import Generic, Literal, TypeVar

Status = Literal["OPEN", "IN_PROGRESS", "BLOCKED", "RESOLVED", "CLOSED"]
Priority = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
ItemType = Literal[
    "CUSTOMER_ISSUE",
    "ENGINEERING",
    "INCIDENT",
    "PAYMENT",
    "COMPLIANCE",
    "APPROVAL",
    "OTHER",
]


class Login(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if len(value) > 320 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Invalid email address")
        return value


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    full_name: str
    email: str
    active: bool


class TeamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: str


class TeamList(BaseModel):
    items: list[TeamOut]


class MemberList(BaseModel):
    items: list[UserOut]


class TeamGrant(BaseModel):
    team_id: UUID
    permissions: list[str]


class AccessOut(BaseModel):
    global_permissions: list[str]
    teams: list[TeamGrant]


T = TypeVar("T")


class PageResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class UserGrantOut(BaseModel):
    role_code: str
    team_id: UUID | None
    team_name: str | None


class UserDirectoryOut(UserOut):
    grants: list[UserGrantOut]


class RoleOption(BaseModel):
    code: str
    requires_team: bool


class RoleList(BaseModel):
    items: list[RoleOption]


class UserCreate(BaseModel):
    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return Login.normalize_email(value)

    full_name: str = Field(min_length=1, max_length=200)
    email: str
    password: str = Field(min_length=12)
    role_code: str
    team_id: UUID | None = None


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""


class MembershipCreate(BaseModel):
    user_id: UUID


class ItemCreate(BaseModel):
    team_id: UUID
    parent_id: UUID | None = None
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    type: ItemType
    priority: Priority = "MEDIUM"
    next_action: str | None = None
    due_at: datetime | None = None


class ItemPatch(BaseModel):
    version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    priority: Priority | None = None
    next_action: str | None = None
    due_at: datetime | None = None


class VersionInput(BaseModel):
    version: int = Field(ge=1)


class Transition(VersionInput):
    status: Status


class AssignmentInput(VersionInput):
    user_id: UUID
    role: Literal["OWNER", "CONTRIBUTOR", "REVIEWER"]


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: UUID
    role: str


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    parent_id: UUID | None
    team_id: UUID
    creator_id: UUID
    title: str
    description: str
    type: ItemType
    status: Status
    priority: Priority
    next_action: str | None
    due_at: datetime | None
    resolved_at: datetime | None
    version: int
    created_at: datetime
    updated_at: datetime
    owner_id: UUID | None = None
    assignments: list[AssignmentOut] = Field(default_factory=list)
    allowed_transitions: list[Status] = Field(default_factory=list)


class ApprovalCreate(BaseModel):
    work_item_id: UUID
    version: int = Field(ge=1)
    approver_id: UUID | None = None
    type: str = Field(min_length=1, max_length=60)
    reason: str = Field(min_length=1)


class ApprovalDecision(VersionInput):
    status: Literal["APPROVED", "REJECTED"]


class ApprovalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    work_item_id: UUID
    requester_id: UUID
    approver_id: UUID | None
    type: str
    reason: str
    status: str
    version: int
    requested_at: datetime
    decided_at: datetime | None


class ApprovalSummary(ApprovalOut):
    work_item_title: str
    requester_name: str
    team_id: UUID
    can_decide: bool
