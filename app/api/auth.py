from secrets import compare_digest
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session
from app.api.deps import current_user
from app.core.errors import error
from app.core.config import get_settings
from app.services.role_catalog import ensure_role_catalog
from app.core.security import issue_token, verify_password, hash_password
from app.db.session import get_db
from app.models import Role, Team, User, UserRole, Membership, RolePermission
from app.schemas.api import (
    AccessOut,
    AdminSignup,
    Login,
    MemberList,
    TeamList,
    UserOut,
    UserCreate,
    TeamCreate,
    MembershipCreate,
    PageResponse,
    RoleList,
    UserDirectoryOut,
)
from app.services.access import global_permission, require_team, team_permission
from sqlalchemy.exc import IntegrityError

router = APIRouter()


def require_user_management(db: Session, user: User):
    if not global_permission(db, user.id, "user:manage"):
        raise error(403, "forbidden", "Permission required")


def role_requires_team(code: str) -> bool:
    return code != "ADMIN"


@router.get("/roles", response_model=RoleList)
def list_roles(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_user_management(db, user)
    roles = db.scalars(select(Role).order_by(Role.code)).all()
    return {
        "items": [
            {"code": role.code, "requires_team": role_requires_team(role.code)}
            for role in roles
        ]
    }


@router.get("/users", response_model=PageResponse[UserDirectoryOut])
def list_users(
    search: str | None = Query(None, max_length=200),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_user_management(db, user)
    stmt = select(User)
    if search and search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(User.full_name.ilike(term), User.email.ilike(term)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(
        stmt.order_by(User.full_name, User.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    grants = {row.id: [] for row in rows}
    if grants:
        assignments = db.execute(
            select(UserRole.user_id, Role.code, UserRole.team_id, Team.name)
            .join(Role, Role.id == UserRole.role_id)
            .outerjoin(Team, Team.id == UserRole.team_id)
            .where(UserRole.user_id.in_(grants))
            .order_by(Role.code, Team.name)
        ).all()
        for user_id, role_code, team_id, team_name in assignments:
            grants[user_id].append(
                {"role_code": role_code, "team_id": team_id, "team_name": team_name}
            )
    return {
        "items": [
            {**UserOut.model_validate(row).model_dump(), "grants": grants[row.id]}
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/auth/signup-options")
def signup_options():
    return {"enabled": len(get_settings().admin_signup_key.strip()) >= 32}


@router.post("/auth/signup", response_model=UserOut, status_code=201)
def signup_admin(body: AdminSignup, db: Session = Depends(get_db)):
    expected = get_settings().admin_signup_key.strip()
    if len(expected) < 32:
        raise error(
            503,
            "signup_disabled",
            "Admin signup is disabled. Ask the deployment operator to configure ADMIN_SIGNUP_KEY.",
        )
    if not compare_digest(
        body.signup_key.get_secret_value().strip().encode(), expected.encode()
    ):
        raise error(403, "invalid_signup_key", "Invalid admin signup code.")
    # Serialize provisioning of the shared catalog and concurrent signup checks.
    db.execute(text("SELECT pg_advisory_xact_lock(7240918301)"))
    if db.scalar(select(User.id).where(User.email == body.email)):
        raise error(
            409,
            "duplicate_email",
            "An account with this email already exists. Sign in instead.",
        )
    if db.scalar(select(Team.id).where(Team.name == body.team_name)):
        raise error(
            409,
            "duplicate_team",
            "A team with this name already exists. Choose another name.",
        )
    try:
        ensure_role_catalog(db)
        admin_role = db.scalar(select(Role).where(Role.code == "ADMIN"))
        account = User(
            full_name=body.full_name,
            email=body.email,
            password_hash=hash_password(body.password),
        )
        team = Team(name=body.team_name, description="")
        db.add_all([account, team])
        db.flush()
        db.add(UserRole(user_id=account.id, role_id=admin_role.id, team_id=None))
        db.add(Membership(user_id=account.id, team_id=team.id))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise error(
            409,
            "signup_conflict",
            "Email or team name already exists. Review your details and try again.",
        ) from None
    return account


@router.post("/auth/login")
def login(body: Login, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower().strip()))
    if (
        not user
        or not user.active
        or not verify_password(body.password, user.password_hash)
    ):
        raise error(401, "unauthorized", "Invalid credentials")
    return {"access_token": issue_token(user.id), "token_type": "bearer"}


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.get("/auth/access", response_model=AccessOut)
def access(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(UserRole.team_id, RolePermission.permission_code)
        .join(RolePermission, RolePermission.role_id == UserRole.role_id)
        .where(UserRole.user_id == user.id)
    ).all()
    member_ids = set(
        db.scalars(
            select(Membership.team_id).where(
                Membership.user_id == user.id, Membership.active.is_(True)
            )
        ).all()
    )
    global_permissions = sorted(
        {permission for team_id, permission in rows if team_id is None}
    )
    return {
        "global_permissions": global_permissions,
        "teams": [
            {
                "team_id": team_id,
                "permissions": sorted(
                    set(global_permissions)
                    | {
                        permission
                        for role_team, permission in rows
                        if role_team == team_id
                    }
                ),
            }
            for team_id in sorted(member_ids, key=str)
        ],
    }


@router.get("/teams", response_model=TeamList)
def list_teams(user: User = Depends(current_user), db: Session = Depends(get_db)):
    ids = select(Membership.team_id).where(
        Membership.user_id == user.id, Membership.active.is_(True)
    )
    rows = db.scalars(select(Team).where(Team.id.in_(ids)).order_by(Team.name)).all()
    return {
        "items": [
            {"id": row.id, "name": row.name, "description": row.description}
            for row in rows
            if team_permission(db, user.id, row.id, "work_item:read")
        ]
    }


@router.get("/teams/{team_id}/members", response_model=MemberList)
def team_members(
    team_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    require_team(db, user.id, team_id, "work_item:read")
    rows = db.scalars(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.team_id == team_id,
            Membership.active.is_(True),
            User.active.is_(True),
        )
        .order_by(User.full_name)
    ).all()
    return {"items": [UserOut.model_validate(row) for row in rows]}


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    body: UserCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    require_user_management(db, user)
    role = db.scalar(select(Role).where(Role.code == body.role_code))
    if (
        not role
        or (body.team_id and not db.get(Team, body.team_id))
        or (role_requires_team(role.code) and body.team_id is None)
    ):
        raise error(422, "invalid_reference", "Role or team does not exist")
    try:
        created = User(
            full_name=body.full_name,
            email=body.email,
            password_hash=hash_password(body.password),
        )
        db.add(created)
        db.flush()
        db.add(UserRole(user_id=created.id, role_id=role.id, team_id=body.team_id))
        if body.team_id:
            db.add(Membership(user_id=created.id, team_id=body.team_id))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise error(409, "duplicate", "Email or assignment already exists") from None
    return created


@router.post("/teams", status_code=201)
def create_team(
    body: TeamCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    if not global_permission(db, user.id, "team:manage"):
        raise error(403, "forbidden", "Permission required")
    try:
        team = Team(**body.model_dump())
        db.add(team)
        db.flush()
        db.add(Membership(user_id=user.id, team_id=team.id))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise error(409, "duplicate", "Team name already exists") from None
    return {"id": team.id, "name": team.name, "description": team.description}


@router.post("/teams/{team_id}/memberships", status_code=201)
def add_member(
    team_id: UUID,
    body: MembershipCreate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    team_uuid = team_id
    require_team(db, user.id, team_uuid, "team:manage")
    if not db.get(User, body.user_id):
        raise error(422, "invalid_reference", "User does not exist")
    member = db.get(Membership, (body.user_id, team_uuid))
    if member:
        member.active = True
    else:
        db.add(Membership(user_id=body.user_id, team_id=team_uuid))
    db.commit()
    return {"team_id": team_uuid, "user_id": body.user_id, "active": True}
