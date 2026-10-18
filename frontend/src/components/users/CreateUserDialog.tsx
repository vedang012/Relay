import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, X } from "lucide-react";
import { useRef, useState } from "react";
import { api, ApiError } from "../../api";
import type { User, UserCreateInput } from "../../types";
import { Dialog, Feedback, FieldError, label } from "../../ui";
import { Select, teamOptions, useTeams } from "../../pages/shared";

export function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: User) => void;
}) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ["roles"], queryFn: api.roles });
  const teams = useTeams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [teamId, setTeamId] = useState("");
  const [visible, setVisible] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const submitting = useRef(false);
  const submitted = useRef<UserCreateInput | null>(null);
  const role = roles.data?.items.find((option) => option.code === roleCode);
  const create = useMutation({
    mutationFn: () => {
      if (!submitted.current) throw new Error("Please complete the user form.");
      return api.createUser(submitted.current);
    },
    onSuccess: (user) => {
      setPassword("");
      qc.invalidateQueries({ queryKey: ["users"] });
      if (teamId) qc.invalidateQueries({ queryKey: ["members", teamId] });
      onCreated(user);
    },
    onSettled: () => {
      submitting.current = false;
      submitted.current = null;
    },
  });
  const duplicate =
    create.error instanceof ApiError && create.error.status === 409;
  const ready =
    !!role && (!role.requires_team || !!teamId) && !roles.error && !teams.error;
  return (
    <Dialog title="Create User" onClose={onClose} busy={create.isPending}>
      <div className="modal-head">
        <div>
          <h2>Create User</h2>
          <p>Give a new teammate access to Relay</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          disabled={create.isPending}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || !name.trim() || submitting.current) return;
          if (Array.from(password).length < 12) {
            setPasswordError("Use at least 12 characters.");
            return;
          }
          setPasswordError("");
          submitting.current = true;
          submitted.current = {
            full_name: name.trim(),
            email: email.trim().toLowerCase(),
            password,
            role_code: roleCode,
            team_id: teamId || null,
          };
          create.mutate();
        }}
      >
        <fieldset className="form-grid" disabled={create.isPending}>
          <label className="wide">
            Full name
            <input
              autoFocus
              autoComplete="name"
              aria-label="Full name"
              required
              maxLength={200}
              pattern=".*\S.*"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <FieldError error={create.error} field="full_name" />
          </label>
          <label className="wide">
            Email
            <input
              type="email"
              aria-label="Email"
              autoComplete="off"
              required
              maxLength={320}
              value={email}
              aria-invalid={duplicate || undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
            <FieldError error={create.error} field="email" />
            {duplicate && (
              <span className="field-error" role="alert">
                An account with this email already exists.
              </span>
            )}
          </label>
          <label className="wide">
            Initial password
            <div className="password-control">
              <input
                type={visible ? "text" : "password"}
                aria-label="Initial password"
                autoComplete="new-password"
                minLength={12}
                required
                aria-describedby="password-help"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setPasswordError("");
                }}
              />
              <button
                type="button"
                aria-label={visible ? "Hide password" : "Show password"}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <small id="password-help" className="field-help">
              At least 12 characters. The user will sign in with this password.
            </small>
            <FieldError error={create.error} field="password" />
            {passwordError && (
              <span className="field-error" role="alert">
                {passwordError}
              </span>
            )}
          </label>
          <label>
            Role
            <Select
              required
              disabled={roles.isPending || !!roles.error}
              value={roleCode}
              onChange={(value) => {
                setRoleCode(value);
                setTeamId("");
              }}
              options={(roles.data?.items || []).map((option) => ({
                value: option.code,
                label: label(option.code),
              }))}
              placeholder="Select role"
            />
            <FieldError error={create.error} field="role_code" />
          </label>
          <label>
            Team
            <Select
              required={role?.requires_team ?? true}
              disabled={!role || teams.isPending || !!teams.error}
              value={teamId}
              onChange={setTeamId}
              options={teamOptions(teams.data?.items || [])}
              placeholder={
                role && !role.requires_team
                  ? "Workspace access (no team)"
                  : "Select team"
              }
            />
            <FieldError error={create.error} field="team_id" />
          </label>
          {role && (
            <p className="field-help wide">
              {role.requires_team
                ? "The user receives this role and membership in the selected team."
                : teamId
                  ? "This administrator role will be limited to the selected team. It will not grant workspace user management."
                  : "This role grants workspace-wide permissions. Team work still requires team membership."}
            </p>
          )}
          {role?.requires_team && teams.data?.items.length === 0 && (
            <p className="field-error wide">
              No teams are available. Create or join a team before onboarding
              users with this role.
            </p>
          )}
        </fieldset>
        {roles.isPending && (
          <p className="field-help" role="status">
            Loading roles…
          </p>
        )}
        {roles.error && (
          <>
            <Feedback error={roles.error} />
            <button type="button" onClick={() => roles.refetch()}>
              Retry loading roles
            </button>
          </>
        )}
        {teams.error && (
          <>
            <Feedback error={teams.error} />
            <button type="button" onClick={() => teams.refetch()}>
              Retry loading teams
            </button>
          </>
        )}
        {create.error && <Feedback error={create.error} />}
        <p className="field-help">
          Share the initial credentials with the user separately. Relay does not
          send invitation emails.
        </p>
        <div className="modal-actions">
          <button type="button" disabled={create.isPending} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!ready || create.isPending}>
            {create.isPending ? "Creating user…" : "Create User"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
