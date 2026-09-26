import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Network,
  LayoutDashboard,
  Settings2,
  Activity,
  HeartPulse,
  RefreshCw,
  ShieldCheck,
  LockKeyhole,
  ChevronRight,
  X,
  LoaderCircle,
  Check,
  AlertCircle,
} from "lucide-react";
import "./styles.css";

import { request } from "./api";
import { stateLabel } from "./format";
import { Badge } from "./components";
import { Overview } from "./Overview";
import { Configuration } from "./Configuration";
import { ActivityPage } from "./Activity";
import { Diagnostics } from "./Diagnostics";
const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "configuration", label: "Configuration", icon: Settings2 },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "diagnostics", label: "Diagnostics", icon: HeartPulse },
];
const titles = {
  overview: ["Network overview", "Your connection, from Wi-Fi to Ethernet."],
  configuration: [
    "Configuration",
    "Connect the right adapter. Keep your setup in sync.",
  ],
  activity: ["Activity", "A live record of your sharing service."],
  diagnostics: ["Diagnostics", "The details behind your connection."],
};
function App() {
  const [page, setPage] = useState(() =>
      nav.some((n) => n.id === location.hash.slice(1))
        ? location.hash.slice(1)
        : "overview",
    ),
    [s, setStatus] = useState(null),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(null),
    [loading, setLoading] = useState(true);
  async function refresh() {
    try {
      const r = await request("status");
      setStatus(r.status);
      setError(r.error);
      return r;
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let alive = true;
    let timer;
    async function poll() {
      if (!alive) return;
      await refresh();
      if (alive) timer = setTimeout(poll, 5000);
    }
    poll();
    const handler = () =>
      setPage(
        nav.some((n) => n.id === location.hash.slice(1))
          ? location.hash.slice(1)
          : "overview",
      );
    window.addEventListener("hashchange", handler);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("hashchange", handler);
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 7000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  function navigate(id) {
    location.hash = id;
    setPage(id);
  }
  async function act(action, body = {}) {
    setBusy(true);
    setError(null);
    try {
      const result = await request("action", { action, ...body });
      setToast(result.message);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const stale = s && Date.now() - new Date(s.timestamp).getTime() > 20000;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#overview"
          onClick={() => navigate("overview")}
        >
          <Network />
          <div>
            <strong>Ethernet Share</strong>
            <span>Wi-Fi to Ethernet for Mac</span>
          </div>
        </a>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              aria-current={page === n.id ? "page" : undefined}
              className={page === n.id ? "selected" : ""}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={20} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div>
            <span className={`dot ${error ? "warning" : ""}`} />
            <span>Local workspace</span>
            <ChevronRight size={15} />
          </div>
          <a href="http://127.0.0.1:3847">127.0.0.1:3847</a>
          <small>
            {s?.managed ? (
              <>
                <ShieldCheck size={13} /> Management enabled
              </>
            ) : (
              <>
                <LockKeyhole size={13} /> Monitor mode
              </>
            )}
          </small>
        </div>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <h1>{titles[page][0]}</h1>
            <p>{titles[page][1]}</p>
          </div>
          <div className="header-status">
            <div>
              <Badge good={Boolean(s && !error && !stale && s.sharing)}>
                {busy
                  ? "Applying changes…"
                  : error || stale
                    ? "Status unavailable"
                    : s
                      ? stateLabel(s)
                      : "Connecting…"}
              </Badge>
              <small>
                {s
                  ? `Updated ${new Date(s.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                  : "Connecting to local service"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Refresh status"
              disabled={busy}
              onClick={() => act("refresh")}
            >
              <RefreshCw size={19} className={busy ? "spin" : ""} />
            </button>
          </div>
        </header>
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={19} />
            <div>
              <strong>Unable to complete the request</strong>
              <p>{error}</p>
            </div>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {stale && (
          <div className="notice">
            The last status is stale. Displayed values are from{" "}
            {new Date(s.timestamp).toLocaleTimeString()}; checking for an
            update.
          </div>
        )}
        {!s ? (
          <div className="loading">
            <LoaderCircle className="spin" />
            <h2>
              {loading
                ? "Connecting to your Mac…"
                : "Waiting for the local service"}
            </h2>
            <p>Reading network interfaces and service status.</p>
            <button className="secondary" onClick={refresh}>
              Try again
            </button>
          </div>
        ) : (
          <>
            {page === "overview" && (
              <Overview s={s} busy={busy} act={act} navigate={navigate} />
            )}{" "}
            {page === "configuration" && (
              <Configuration
                key={
                  s.configuration.ethernetMAC +
                  s.configuration.upstreamInterface
                }
                s={s}
                busy={busy}
                act={act}
              />
            )}{" "}
            {page === "activity" && <ActivityPage s={s} />}{" "}
            {page === "diagnostics" && <Diagnostics s={s} />}
          </>
        )}
        <footer className="page-footer">
          <span>
            <ShieldCheck size={13} />
            Local to this Mac · no cloud connection
          </span>
          <span>Mac Ethernet Share</span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button
            className="icon-button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {busy && (
        <div className="operation-status" role="status">
          <LoaderCircle className="spin" size={17} />
          Working… If macOS requests authorization, approve its administrator
          prompt.
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
