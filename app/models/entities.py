from datetime import datetime, timezone
from uuid import UUID, uuid4
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.services.workflow import TRANSITIONS


def uid():
    return mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)


def stamp():
    return mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class User(Base):
    __tablename__ = "users"
    id: Mapped[UUID] = uid()
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = stamp()
    updated_at: Mapped[datetime] = stamp()
    __table_args__ = (
        CheckConstraint("email = lower(btrim(email))", name="normalized_email"),
    )


class Team(Base):
    __tablename__ = "teams"
    id: Mapped[UUID] = uid()
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = stamp()


class Membership(Base):
    __tablename__ = "memberships"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    team_id: Mapped[UUID] = mapped_column(ForeignKey("teams.id"), primary_key=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    joined_at: Mapped[datetime] = stamp()


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[UUID] = uid()
    code: Mapped[str] = mapped_column(String(50), unique=True)


class Permission(Base):
    __tablename__ = "permissions"
    code: Mapped[str] = mapped_column(String(80), primary_key=True)


class RolePermission(Base):
    __tablename__ = "role_permissions"
    role_id: Mapped[UUID] = mapped_column(ForeignKey("roles.id"), primary_key=True)
    permission_code: Mapped[str] = mapped_column(
        ForeignKey("permissions.code"), primary_key=True
    )


class UserRole(Base):
    __tablename__ = "user_roles"
    id: Mapped[UUID] = uid()
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    role_id: Mapped[UUID] = mapped_column(ForeignKey("roles.id"))
    team_id: Mapped[UUID | None] = mapped_column(ForeignKey("teams.id"), nullable=True)
    __table_args__ = (
        Index(
            "uq_user_role_global",
            "user_id",
            "role_id",
            unique=True,
            postgresql_where=text("team_id IS NULL"),
        ),
        Index(
            "uq_user_role_team",
            "user_id",
            "role_id",
            "team_id",
            unique=True,
            postgresql_where=text("team_id IS NOT NULL"),
        ),
    )


class WorkItem(Base):
    __tablename__ = "work_items"
    id: Mapped[UUID] = uid()
    parent_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("work_items.id"), nullable=True
    )
    team_id: Mapped[UUID] = mapped_column(ForeignKey("teams.id"))
    creator_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="OPEN")
    priority: Mapped[str] = mapped_column(String(20), default="MEDIUM")
    next_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = stamp()
    updated_at: Mapped[datetime] = stamp()
    assignments: Mapped[list["Assignment"]] = relationship(
        lazy="selectin", viewonly=True
    )

    @property
    def owner_id(self):
        return next(
            (
                assignment.user_id
                for assignment in self.assignments
                if assignment.role == "OWNER"
            ),
            None,
        )

    @property
    def allowed_transitions(self):
        return list(TRANSITIONS.get(self.status, ()))

    __table_args__ = (
        CheckConstraint("id <> parent_id", name="not_own_parent"),
        CheckConstraint(
            "status IN ('OPEN','IN_PROGRESS','BLOCKED','RESOLVED','CLOSED')",
            name="valid_status",
        ),
        CheckConstraint(
            "priority IN ('LOW','MEDIUM','HIGH','CRITICAL')", name="valid_priority"
        ),
        CheckConstraint(
            "type IN ('CUSTOMER_ISSUE','ENGINEERING','INCIDENT','PAYMENT','COMPLIANCE','APPROVAL','OTHER')",
            name="valid_type",
        ),
        Index("ix_work_team_status", "team_id", "status"),
        Index("ix_work_parent", "parent_id"),
    )


class Assignment(Base):
    __tablename__ = "assignments"
    work_item_id: Mapped[UUID] = mapped_column(
        ForeignKey("work_items.id"), primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(20))
    assigned_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = stamp()
    __table_args__ = (
        CheckConstraint(
            "role IN ('OWNER','CONTRIBUTOR','REVIEWER')", name="valid_assignment_role"
        ),
        Index(
            "uq_one_owner",
            "work_item_id",
            unique=True,
            postgresql_where=text("role = 'OWNER'"),
        ),
        Index("ix_assignment_user", "user_id"),
    )


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[UUID] = uid()
    work_item_id: Mapped[UUID] = mapped_column(ForeignKey("work_items.id"), index=True)
    requester_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    approver_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    type: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    reason: Mapped[str] = mapped_column(Text)
    requested_at: Mapped[datetime] = stamp()
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING','APPROVED','REJECTED','CANCELLED')",
            name="valid_approval_status",
        ),
        Index("ix_approval_status_approver", "status", "approver_id"),
    )


class ActivityEvent(Base):
    __tablename__ = "activity_events"
    id: Mapped[UUID] = uid()
    work_item_id: Mapped[UUID] = mapped_column(ForeignKey("work_items.id"))
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(60))
    old_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = stamp()
    __table_args__ = (Index("ix_activity_work_time", "work_item_id", "created_at"),)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    operation: Mapped[str] = mapped_column(String(50), primary_key=True)
    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[UUID] = mapped_column(ForeignKey("work_items.id"))
    created_at: Mapped[datetime] = stamp()


class Bookmark(Base):
    __tablename__ = "bookmarks"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    work_item_id: Mapped[UUID] = mapped_column(
        ForeignKey("work_items.id"), primary_key=True
    )
    created_at: Mapped[datetime] = stamp()


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[UUID] = uid()
    work_item_id: Mapped[UUID] = mapped_column(ForeignKey("work_items.id"), index=True)
    author_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = stamp()
