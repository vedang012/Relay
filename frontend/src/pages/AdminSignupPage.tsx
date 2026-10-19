import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Feedback } from "../ui";

const demoSignupCode = import.meta.env.VITE_DEMO_ADMIN_SIGNUP_KEY?.trim();

export function AdminSignupPage() {
  const navigate = useNavigate();
  const options = useQuery({
    queryKey: ["signup-options"],
    queryFn: api.signupOptions,
    staleTime: 0,
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [team, setTeam] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<Error | null>(null);
  return (
    <div className="login-wrap">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending.current || !options.data?.enabled) return;
          if (
            !name.trim() ||
            !team.trim() ||
            Array.from(password).length < 12 ||
            password !== confirm
          ) {
            setError(
              new Error(
                "Enter your name and team, and matching passwords of at least 12 characters.",
              ),
            );
            return;
          }
          pending.current = true;
          setBusy(true);
          setError(null);
          try {
            await api.signupAdmin({
              full_name: name.trim(),
              email: email.trim(),
              password,
              team_name: team.trim(),
              signup_key: code.trim(),
            });
            setPassword("");
            setConfirm("");
            setCode("");
            navigate("/login", {
              replace: true,
              state: { signupComplete: true },
            });
          } catch (err) {
            setError(
              err instanceof Error
                ? err
                : new Error("Could not create your account."),
            );
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <div className="brand-mark">R</div>
        <h1>Create admin account</h1>
        <p>
          Create an administrator and your initial team. A deployment signup
          code is required because admins can manage this shared workspace.
        </p>
        {options.isPending && (
          <p role="status">Checking signup availability…</p>
        )}
        {options.error && <Feedback error={options.error} />}
        {options.data && !options.data.enabled && (
          <p role="alert">
            Admin signup is disabled. Ask the deployment operator to enable it
            with ADMIN_SIGNUP_KEY.
          </p>
        )}
        {options.data?.enabled && demoSignupCode && (
          <div className="demo-signup-code">
            <p>
              <strong>Demo admin signup code</strong>
            </p>
            <code>{demoSignupCode}</code>
            <p>
              For this demo, anyone can use this key to sign up as an admin. In
              production, the key must stay private and be available only to
              authorized administrators.
            </p>
            <button type="button" onClick={() => setCode(demoSignupCode)}>
              Use demo admin signup key
            </button>
          </div>
        )}
        <fieldset disabled={busy || !options.data?.enabled}>
          <label>
            Full name
            <input
              required
              maxLength={200}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              maxLength={320}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              minLength={12}
              maxLength={1024}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Confirm password
            <input
              required
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <label>
            Initial team name
            <input
              required
              maxLength={120}
              value={team}
              onChange={(e) => setTeam(e.target.value)}
            />
          </label>
          <label>
            Admin signup code
            <input
              required
              type="password"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error.message}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? "Creating account…" : "Create admin account"}
          </button>
        </fieldset>
        <p>
          <Link to="/login">Already have an account? Sign in</Link>
        </p>
      </form>
    </div>
  );
}
