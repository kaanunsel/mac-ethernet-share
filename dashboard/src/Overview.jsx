import React, { useState } from "react";
import {
  Wifi,
  Laptop,
  EthernetPort,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  Plug,
  Battery,
  Pause,
  Play,
  LockKeyhole,
  ChevronRight,
  Download,
  AlertCircle,
} from "lucide-react";
import { Panel, Rows, ActivityList, Help } from "./components";
import { known, fmt, bytes, untracked } from "./format";
import { useI18n } from "./i18n";
function ConnectionMap({ s }) {
  const { t } = useI18n();
  return (
    <Panel
      title="Connection path"
      extra={
        <span className="quiet map-caption">
          {t("Internet path from Wi-Fi to Ethernet client")} <Help text="The network connection travels from Mac Wi-Fi through this Mac to the Ethernet device." />
        </span>
      }
      className="connection-panel"
    >
      <div className="connection-map">
        <div className={`network-node ${s.upstream ? "connected" : ""}`}>
          <div className="node-icon">
            <Wifi />
          </div>
          <h3>
            {t("Wi-Fi")} <span>({t("upstream")})</span>
          </h3>
          <span>{s.configuration.upstreamInterface}</span>
          <code>{s.upstreamAddresses.join(", ") || t("No IPv4 address")}</code>
        </div>
        <div className={`connection-line ${s.upstream ? "connected" : ""}`}>
          <span>{t(s.upstream ? "Connected" : "Unavailable")}</span>
        </div>
        <div className={`network-node ${s.sharing ? "connected" : ""}`}>
          <div className="node-icon">
            <Laptop />
          </div>
          <h3>{t("This Mac")}</h3>
          <span>
            {s.paused
              ? t("Automation paused")
              : s.managed
                ? t("Automation enabled")
                : t("Monitoring")}
          </span>
          <code>{s.configuration.gateway}</code>
        </div>
        <div className={`connection-line ${s.link ? "connected" : ""}`}>
          <span>{t(s.link ? "Link up" : "Link down")}</span>
        </div>
        <div className={`network-node ${s.link ? "connected" : ""}`}>
          <div className="node-icon">
            <EthernetPort />
          </div>
          <h3>{t("Ethernet client")}</h3>
          <span>
            {s.adapter
              ? `${s.adapter} · ${t(s.link ? "Link connected" : "Cable disconnected")}`
              : t("Adapter not detected")}
          </span>
          <code>
            {s.configuration.clientIP}{" "}
            <span className="quiet">({t("configured")})</span>
          </code>
        </div>
      </div>
    </Panel>
  );
}
function Metrics({ s }) {
  const { t } = useI18n();
  const battery = s.power?.match(/(\d+%);\s*([^;]+)/);
  const metrics = [
    [
      "Sharing status",
      <span className={`status-orb ${s.sharing ? "on" : ""}`} />,
      untracked(s)
        ? "Untracked"
        : s.sharing
          ? "Active"
          : s.paused
            ? "Paused"
            : s.link
              ? "Inactive"
              : "Waiting",
      untracked(s)
        ? "NAT exists without a session journal"
        : !s.adapter
          ? "Connect your Ethernet adapter"
          : !s.link
            ? "Connect the client Ethernet cable"
            : !s.upstream
              ? "Waiting for the Wi-Fi upstream"
              : s.managed
                ? "Wi-Fi via Ethernet"
                : "Enable management for full status",
    ],
    [
      "Download (to client)",
      <ArrowDown />,
      `${fmt(s.traffic.rate?.download)} Mbps`,
      t("{bytes} since interface reset", { bytes: bytes(s.traffic.totals?.tx) === "Unavailable" ? t("Unavailable") : bytes(s.traffic.totals?.tx) }),
    ],
    [
      "Upload (from client)",
      <ArrowUp />,
      `${fmt(s.traffic.rate?.upload)} Mbps`,
      t("{bytes} since interface reset", { bytes: bytes(s.traffic.totals?.rx) === "Unavailable" ? t("Unavailable") : bytes(s.traffic.totals?.rx) }),
    ],
    [
      "Power source",
      s.ac ? <Plug /> : <Battery />,
      s.ac ? "AC power" : "Battery",
      battery
        ? t("Battery {percent}% · {state}", { percent: battery[1].replace("%", ""), state: t(battery[2]) })
        : "Power details unavailable",
    ],
  ];
  return (
    <section className="metrics" aria-label={t("Live connection metrics")}>
      {metrics.map(([label, icon, value, sub], index) => (
        <div className="metric" key={label}>
          <p>{t(label)} <Help text={[
            "This shows whether your Mac is currently providing internet to the Ethernet device. All connection checks must pass before sharing starts.",
            "Download is data sent from the internet to the Ethernet device, such as a PS5 game download. This is measured on the Ethernet adapter.",
            "Upload is data sent from the Ethernet device to the internet. This is measured on the Ethernet adapter.",
            "Shows whether the Mac is using its battery or charger. Sharing continues on battery while the adapter remains connected, but uses battery power.",
          ][index]} /></p>
          <div className="metric-value">
            {icon}
            <strong>{t(value)}</strong>
          </div>
          <small>{t(sub)}</small>
        </div>
      ))}
    </section>
  );
}
function Traffic({ s }) {
  const { t, locale } = useI18n();
  const [minutes, setMinutes] = useState(5);
  const now = Date.now(),
    points = s.traffic.history.filter((p) => now - p.time <= minutes * 60000),
    valid = points.filter((p) => p.download !== null);
  const max =
    Math.max(1, ...valid.flatMap((p) => [p.download, p.upload])) * 1.15;
  const x = (p) =>
    60 + ((p.time - (now - minutes * 60000)) / (minutes * 60000)) * 690;
  const y = (v) => 188 - (v / max) * 160;
  const line = (key) =>
    points
      .map((p, i) =>
        p[key] === null
          ? ""
          : `${i === 0 || points[i - 1][key] === null ? "M" : "L"}${x(p).toFixed(1)},${y(p[key]).toFixed(1)}`,
      )
      .join(" ");
  return (
    <Panel
      title="Traffic"
      className="traffic-panel"
      extra={
        <div className="chart-tools">
          <span className="legend">
            <i />
            {t("Download")}
          </span>
          <span className="legend blue">
            <i />
            {t("Upload")}
          </span>
          <select
            aria-label={t("Traffic time range")}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          >
            <option value={1}>{t("Last minute")}</option>
            <option value={5}>{t("Last 5 minutes")}</option>
            <option value={15}>{t("Last 15 minutes")}</option>
          </select>
        </div>
      }
    >
      <div className="chart">
        <svg
          viewBox="0 0 775 226"
          role="img"
          aria-label={t("Ethernet traffic over the last {minutes} minutes in megabits per second", { minutes })}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line
                x1="60"
                x2="750"
                y1={28 + i * 40}
                y2={28 + i * 40}
                className="gridline"
              />
              <text x="47" y={32 + i * 40} textAnchor="end">
                {fmt((max * (4 - i)) / 4)}
              </text>
            </g>
          ))}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <g key={i}>
              <line
                x1={60 + i * 138}
                x2={60 + i * 138}
                y1="28"
                y2="188"
                className="gridline"
              />
              <text x={60 + i * 138} y="215" textAnchor="middle">
                {new Date(now - (5 - i) * minutes * 12000).toLocaleTimeString(
                  locale === "tr" ? "tr-TR" : "en-US",
                  { hour: "2-digit", minute: "2-digit" },
                )}
              </text>
            </g>
          ))}
          <text x="10" y="12">
            Mbps
          </text>
          <path d={line("download")} className="download-line" />
          <path d={line("upload")} className="upload-line" />
        </svg>
        {valid.length < 2 && (
          <div className="chart-empty">
            {s.adapter
              ? t("Collecting live interface samples…")
              : t("Connect the adapter to see traffic.")}
          </div>
        )}
      </div>
      <p className="chart-note">
        {t("Ethernet interface traffic · sampled every 2 seconds · history retained while the dashboard runs")} <Help text="This chart shows current download and upload speeds between the Mac and Ethernet device. It does not directly test internet reachability." />
      </p>
    </Panel>
  );
}
function Controls({ s, busy, act }) {
  const { t } = useI18n();
  return (
    <Panel title="Service controls" className="control-panel">
      <div className="automation">
        <div>
          <h3>{t("Automation")} <Help text="Automation starts sharing when the adapter, cable, and Wi-Fi are ready. Pausing it stops automatic sharing until resumed or the Mac restarts." /></h3>
          <p>
            {s.managed
              ? s.paused
                ? t("Paused until resume or reboot")
                : t("Starts when the connection is ready")
              : t("Administrator access required")}
          </p>
        </div>
        <span
          className={`switch ${s.managed && !s.paused ? "on" : ""}`}
          aria-label={`${t("Automation")} ${s.managed ? t(known(!s.paused)) : t("unknown")}`}
        >
          <i />
        </span>
      </div>
      {s.managed ? (
        <>
          <button
            className="primary full"
            disabled={busy}
            onClick={() => act(s.paused ? "start" : "stop")}
          >
            {s.paused ? <Play size={18} /> : <Pause size={18} />}{" "}
            {t(untracked(s)
              ? s.paused
                ? "Resume automation"
                : "Pause automation"
              : s.paused
                ? "Resume sharing"
                : "Pause sharing")}
          </button>
          <button
            className="secondary full"
            disabled={busy || Boolean(s.adapter)}
            title={
              s.adapter ? t("Unplug the adapter before restarting") : undefined
            }
            onClick={() => act("restart")}
          >
            <RefreshCw size={17} />
            {t("Restart service")}
          </button>
        </>
      ) : (
        <button
          className="primary full"
          disabled={busy}
          onClick={() => act("authorize")}
        >
          <LockKeyhole size={17} />
          {t("Enable management")}
        </button>
      )}
      <p className="control-note">
        {t(s.managed
          ? "To recover connectivity, unplug the Ethernet adapter before restarting the service."
          : "Approve the macOS administrator prompt to control sharing and read protected service state. This upgrades the service and may briefly interrupt sharing.")}
      </p>
    </Panel>
  );
}
export function Overview({ s, busy, act, navigate }) {
  const { t } = useI18n();
  const adapter = s.ports.find((p) => p.interface === s.adapter);
  return (
    <>
      {untracked(s) && (
        <div className="notice" role="status">
          <AlertCircle size={19} />
          <div>
            <strong>
              {t("Forwarding is present, but its recovery record is missing.")}
            </strong>
            <p>
              {t("Your client may still have internet access. Existing NAT rules and IPv4 forwarding are active, but the daemon cannot safely claim this session. Pausing automation will not clear these untracked rules. Keep the connection running; investigate recovery when the client is idle.")}
            </p>
          </div>
        </div>
      )}
      <ConnectionMap s={s} />
      <Metrics s={s} />
      <div className="main-grid">
        <Traffic s={s} />
        <Controls s={s} busy={busy} act={act} />
      </div>
      <div className="bottom-grid">
        <Panel title="Connection details">
          <Rows
            rows={[
              ["Adapter (Ethernet)", adapter?.name || "Not detected", "The adapter's MAC address uniquely identifies the Ethernet hardware so the service can find it even when macOS changes its en-number."],
              ["Upstream interface", s.configuration.upstreamInterface, "The upstream is the Mac network interface that supplies internet, normally Wi-Fi (en0)."],
              ["Gateway", s.configuration.gateway, "The gateway is this Mac's Ethernet address. Set it as the router or default gateway on your PS5."],
              ["Client address", s.configuration.clientIP, "The client address is the static IP you enter on the Ethernet device, such as your PS5."],
            ]}
          />
        </Panel>
        <Panel
          title="Recent activity"
          extra={
            <button
              className="text-button"
              onClick={() => navigate("activity")}
            >
              {t("View all")} <ChevronRight size={14} />
            </button>
          }
        >
          <ActivityList logs={s.logs} />
        </Panel>
      </div>
    </>
  );
}
