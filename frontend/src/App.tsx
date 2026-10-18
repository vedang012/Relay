import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  CheckSquare,
  Grid2X2,
  Inbox,
  LogOut,
  Plus,
  Search,
  Users,
  UserPlus,
} from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { api, authToken } from "./api";
import {
  AllWorkPage,
  ApprovalsPage,
  AttentionPage,
  DetailPage,
  NewItemModal,
  TeamsPage,
} from "./pages";
import type { Access, User } from "./types";
import { UsersPage } from "./pages/UsersPage";
type AuthValue = {
  user: User;
  access: Access;
  can: (permission: string, teamId?: string) => boolean;
  logout: () => void;
};
const AuthContext = createContext<AuthValue | null>(null);
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw Error("No auth context");
  return context;
};
function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-wrap">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result = await api.login(email, password);
            authToken.set(result.access_token);
            onLogin();
          } catch (error) {
            setError(error instanceof Error ? error.message : "Sign in failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand-mark">R</div>
        <h1>Welcome to Relay</h1>
        <p>Sign in to your operations workspace.</p>
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
function Shell({ onLogout }: { onLogout: () => void }) {
  const [modal, setModal] = useState(false);
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const user = useQuery({ queryKey: ["me"], queryFn: api.me });
  const access = useQuery({ queryKey: ["access"], queryFn: api.access });
  const can = (permission: string, teamId?: string) =>
    !!access.data &&
    (teamId
      ? access.data.teams.some(
          (t) => t.team_id === teamId && t.permissions.includes(permission),
        )
      : access.data.teams.some((t) => t.permissions.includes(permission)));
  if (user.isPending || access.isPending)
    return <div className="center-state">Loading workspace…</div>;
  if (user.isError || access.isError)
    return (
      <div className="center-state">
        <p>Could not load your workspace.</p>
        <button
          onClick={() => {
            user.refetch();
            access.refetch();
          }}
        >
          Retry
        </button>
      </div>
    );
  return (
    <AuthContext.Provider
      value={{
        user: user.data,
        access: access.data,
        can,
        logout: () => {
          authToken.clear();
          qc.clear();
          onLogout();
          navigate("/login");
        },
      }}
    >
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <span className="brand-mark">R</span>
            <span>
              <strong>Relay</strong>
              <small>Ops v2.4</small>
            </span>
          </div>
          <nav>
            <NavLink to="/attention">
              <Inbox size={17} />
              Attention
            </NavLink>
            <NavLink to="/work">
              <CheckSquare size={17} />
              All Work
            </NavLink>
            <NavLink to="/bookmarks">
              <Bookmark size={17} />
              Bookmarks
            </NavLink>
            <NavLink to="/approvals">
              <Grid2X2 size={17} />
              Approvals
            </NavLink>
            <NavLink to="/teams">
              <Users size={17} />
              Teams
            </NavLink>
            {access.data.global_permissions.includes("user:manage") && (
              <NavLink to="/users">
                <UserPlus size={17} />
                Users
              </NavLink>
            )}
          </nav>
          <div className="sidebar-bottom">
            <div className="workspace-label">WORKSPACE</div>
            <div>◉ &nbsp; Operations</div>
            <small>Work management</small>
          </div>
        </aside>
        <div className="app-main">
          <header className="topbar">
            <form
              className="top-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/work?search=${encodeURIComponent(search)}`);
              }}
            >
              <Search size={17} />
              <input
                aria-label="Search work items"
                placeholder="Search work items…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </form>
            <div className="top-actions">
              {can("work_item:create") && (
                <button className="primary" onClick={() => setModal(true)}>
                  <Plus size={16} />
                  New Work Item
                </button>
              )}
              <span className="avatar">{user.data.full_name.slice(0, 1)}</span>
              <span className="user-name">{user.data.full_name}</span>
              <button
                className="icon-button"
                title="Sign out"
                onClick={() => {
                  authToken.clear();
                  qc.clear();
                  onLogout();
                  navigate("/login");
                }}
              >
                <LogOut size={17} />
              </button>
            </div>
          </header>
          <main>
            <Routes>
              <Route path="/" element={<Navigate to="/attention" replace />} />
              <Route path="/attention" element={<AttentionPage />} />
              <Route path="/work" element={<AllWorkPage key="all-work" />} />
              <Route
                path="/bookmarks"
                element={<AllWorkPage key="bookmarks" bookmarkedOnly />}
              />
              <Route path="/work/:id" element={<DetailPage />} />
              <Route path="/approvals" element={<ApprovalsPage />} />
              <Route path="/teams" element={<TeamsPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route
                path="*"
                element={<div className="panel">Page not found.</div>}
              />
            </Routes>
          </main>
        </div>
      </div>
      {modal && <NewItemModal onClose={() => setModal(false)} />}
    </AuthContext.Provider>
  );
}
export default function App() {
  const qc = useQueryClient();
  const [loggedIn, setLoggedIn] = useState(!!authToken.get());
  useEffect(() => {
    const fn = () => {
      setLoggedIn(false);
      qc.clear();
    };
    window.addEventListener("relay:unauthorized", fn);
    return () => window.removeEventListener("relay:unauthorized", fn);
  }, [qc]);
  return (
    <Routes>
      <Route
        path="/login"
        element={
          loggedIn ? (
            <Navigate to="/attention" replace />
          ) : (
            <Login
              onLogin={() => {
                qc.clear();
                setLoggedIn(true);
              }}
            />
          )
        }
      />
      <Route
        path="/*"
        element={
          loggedIn ? (
            <Shell onLogout={() => setLoggedIn(false)} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}
