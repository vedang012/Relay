"""Initial schema, frozen at challenge delivery.

Revision ID: 0001
Revises:
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute('CREATE TABLE permissions (\n\tcode VARCHAR(80) NOT NULL, \n\tPRIMARY KEY (code)\n)')
    op.execute('CREATE TABLE roles (\n\tid UUID NOT NULL, \n\tcode VARCHAR(50) NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (code)\n)')
    op.execute('CREATE TABLE teams (\n\tid UUID NOT NULL, \n\tname VARCHAR(120) NOT NULL, \n\tdescription TEXT NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (name)\n)')
    op.execute('CREATE TABLE users (\n\tid UUID NOT NULL, \n\tfull_name VARCHAR(200) NOT NULL, \n\temail VARCHAR(320) NOT NULL, \n\tpassword_hash TEXT NOT NULL, \n\tactive BOOLEAN NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT normalized_email CHECK (email = lower(btrim(email)))\n)')
    op.execute('CREATE UNIQUE INDEX ix_users_email ON users (email)')
    op.execute('CREATE TABLE memberships (\n\tuser_id UUID NOT NULL, \n\tteam_id UUID NOT NULL, \n\tactive BOOLEAN NOT NULL, \n\tjoined_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (user_id, team_id), \n\tFOREIGN KEY(user_id) REFERENCES users (id), \n\tFOREIGN KEY(team_id) REFERENCES teams (id)\n)')
    op.execute('CREATE TABLE role_permissions (\n\trole_id UUID NOT NULL, \n\tpermission_code VARCHAR(80) NOT NULL, \n\tPRIMARY KEY (role_id, permission_code), \n\tFOREIGN KEY(role_id) REFERENCES roles (id), \n\tFOREIGN KEY(permission_code) REFERENCES permissions (code)\n)')
    op.execute('CREATE TABLE user_roles (\n\tid UUID NOT NULL, \n\tuser_id UUID NOT NULL, \n\trole_id UUID NOT NULL, \n\tteam_id UUID, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id), \n\tFOREIGN KEY(role_id) REFERENCES roles (id), \n\tFOREIGN KEY(team_id) REFERENCES teams (id)\n)')
    op.execute('CREATE UNIQUE INDEX uq_user_role_team ON user_roles (user_id, role_id, team_id) WHERE team_id IS NOT NULL')
    op.execute('CREATE INDEX ix_user_roles_user_id ON user_roles (user_id)')
    op.execute('CREATE UNIQUE INDEX uq_user_role_global ON user_roles (user_id, role_id) WHERE team_id IS NULL')
    op.execute("CREATE TABLE work_items (\n\tid UUID NOT NULL, \n\tparent_id UUID, \n\tteam_id UUID NOT NULL, \n\tcreator_id UUID NOT NULL, \n\ttitle VARCHAR(200) NOT NULL, \n\tdescription TEXT NOT NULL, \n\ttype VARCHAR(40) NOT NULL, \n\tstatus VARCHAR(20) NOT NULL, \n\tpriority VARCHAR(20) NOT NULL, \n\tnext_action TEXT, \n\tdue_at TIMESTAMP WITH TIME ZONE, \n\tresolved_at TIMESTAMP WITH TIME ZONE, \n\tversion INTEGER NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT not_own_parent CHECK (id <> parent_id), \n\tCONSTRAINT valid_status CHECK (status IN ('OPEN','IN_PROGRESS','BLOCKED','RESOLVED','CLOSED')), \n\tCONSTRAINT valid_priority CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')), \n\tCONSTRAINT valid_type CHECK (type IN ('CUSTOMER_ISSUE','ENGINEERING','INCIDENT','PAYMENT','COMPLIANCE','APPROVAL','OTHER')), \n\tFOREIGN KEY(parent_id) REFERENCES work_items (id), \n\tFOREIGN KEY(team_id) REFERENCES teams (id), \n\tFOREIGN KEY(creator_id) REFERENCES users (id)\n)")
    op.execute('CREATE INDEX ix_work_team_status ON work_items (team_id, status)')
    op.execute('CREATE INDEX ix_work_parent ON work_items (parent_id)')
    op.execute('CREATE TABLE activity_events (\n\tid UUID NOT NULL, \n\twork_item_id UUID NOT NULL, \n\tactor_id UUID, \n\tevent_type VARCHAR(60) NOT NULL, \n\told_values JSONB, \n\tnew_values JSONB, \n\tdetails JSONB, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(work_item_id) REFERENCES work_items (id), \n\tFOREIGN KEY(actor_id) REFERENCES users (id)\n)')
    op.execute('CREATE INDEX ix_activity_work_time ON activity_events (work_item_id, created_at)')
    op.execute("CREATE TABLE approvals (\n\tid UUID NOT NULL, \n\twork_item_id UUID NOT NULL, \n\trequester_id UUID NOT NULL, \n\tapprover_id UUID, \n\ttype VARCHAR(60) NOT NULL, \n\tstatus VARCHAR(20) NOT NULL, \n\treason TEXT NOT NULL, \n\trequested_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tdecided_at TIMESTAMP WITH TIME ZONE, \n\tversion INTEGER NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT valid_approval_status CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')), \n\tFOREIGN KEY(work_item_id) REFERENCES work_items (id), \n\tFOREIGN KEY(requester_id) REFERENCES users (id), \n\tFOREIGN KEY(approver_id) REFERENCES users (id)\n)")
    op.execute('CREATE INDEX ix_approval_status_approver ON approvals (status, approver_id)')
    op.execute('CREATE INDEX ix_approvals_work_item_id ON approvals (work_item_id)')
    op.execute("CREATE TABLE assignments (\n\twork_item_id UUID NOT NULL, \n\tuser_id UUID NOT NULL, \n\trole VARCHAR(20) NOT NULL, \n\tassigned_by UUID NOT NULL, \n\tassigned_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (work_item_id, user_id), \n\tCONSTRAINT valid_assignment_role CHECK (role IN ('OWNER','CONTRIBUTOR','REVIEWER')), \n\tFOREIGN KEY(work_item_id) REFERENCES work_items (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id), \n\tFOREIGN KEY(assigned_by) REFERENCES users (id)\n)")
    op.execute("CREATE UNIQUE INDEX uq_one_owner ON assignments (work_item_id) WHERE role = 'OWNER'")
    op.execute('CREATE INDEX ix_assignment_user ON assignments (user_id)')
    op.execute('CREATE TABLE idempotency_records (\n\tactor_id UUID NOT NULL, \n\toperation VARCHAR(50) NOT NULL, \n\tkey VARCHAR(200) NOT NULL, \n\tpayload_hash VARCHAR(64) NOT NULL, \n\tresource_id UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (actor_id, operation, key), \n\tFOREIGN KEY(actor_id) REFERENCES users (id), \n\tFOREIGN KEY(resource_id) REFERENCES work_items (id)\n)')

def downgrade():
    op.drop_table('idempotency_records')
    op.drop_table('assignments')
    op.drop_table('approvals')
    op.drop_table('activity_events')
    op.drop_table('work_items')
    op.drop_table('user_roles')
    op.drop_table('role_permissions')
    op.drop_table('memberships')
    op.drop_table('users')
    op.drop_table('teams')
    op.drop_table('roles')
    op.drop_table('permissions')
