import React, { useEffect, useState } from "react";
import { EthernetPort, ShieldCheck, Download, RotateCw } from "lucide-react";
import { Badge, Panel, Rows, Modal } from "./components";
export function Configuration({ s, busy, act }) {
  const [mac, setMac] = useState(s.configuration.ethernetMAC),
    [upstream, setUpstream] = useState(s.configuration.upstreamInterface),
    [confirm, setConfirm] = useState(false),
    [maintenance, setMaintenance] = useState(null);
  const changed =
    mac !== s.configuration.ethernetMAC ||
    upstream !== s.configuration.upstreamInterface;
  return (
    <div className="settings-grid">
      <Panel
        title="Network configuration"
        extra={
          <Badge good={s.managed}>
            {s.managed
              ? "Installed configuration"
              : "Local build configuration"}
          </Badge>
        }
      >
        <p className="section-description">
          Select the Mac’s Ethernet adapter and the Wi-Fi interface that
          supplies its connection.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setConfirm(true);
          }}
        >
          <label>
            Ethernet adapter
            <select
              value={
                s.ports.some((p) => p.mac.toLowerCase() === mac) ? mac : ""
              }
              onChange={(e) => e.target.value && setMac(e.target.value)}
            >
              <option value="">Choose a detected adapter</option>
              {s.ports
                .filter((p) => /^en\d+$/.test(p.interface))
                .map((p) => (
                  <option key={p.interface} value={p.mac.toLowerCase()}>
                    {p.name} · {p.interface} · {p.mac}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Adapter MAC address
            <input
              value={mac}
              onChange={(e) => setMac(e.target.value.toLowerCase())}
              pattern="([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}"
              required
              spellCheck="false"
            />
            <small>Use the adapter’s hardware address on this Mac.</small>
          </label>
          <label>
            Upstream interface
            <select
              value={upstream}
              onChange={(e) => setUpstream(e.target.value)}
            >
              {[
                ...new Set([
                  upstream,
                  ...s.ports
                    .filter((p) => /^en\d+$/.test(p.interface))
                    .map((p) => p.interface),
                ]),
              ].map((value) => (
                <option key={value} value={value}>
                  {value} ·{" "}
                  {s.ports.find((p) => p.interface === value)?.name ||
                    "Configured interface"}
                </option>
              ))}
            </select>
            <small>The upstream must be the primary IPv4 interface.</small>
          </label>
          <div className="form-actions">
            <button
              className="primary"
              disabled={!changed || busy || !s.managed}
            >
              Apply configuration
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!changed || busy}
              onClick={() => {
                setMac(s.configuration.ethernetMAC);
                setUpstream(s.configuration.upstreamInterface);
              }}
            >
              Reset changes
            </button>
          </div>
          {!s.managed && (
            <p className="muted">
              Enable management on Overview before applying changes.
            </p>
          )}
        </form>
      </Panel>
      <div>
        <Panel
          title="Service maintenance"
          extra={<Badge good={s.installation?.installed && !s.installation?.updateAvailable}>
            {!s.installation?.installed ? "Not installed" : s.installation?.updateAvailable ? "Update available" : "Up to date"}
          </Badge>}
        >
          <p className="section-description">
            {!s.installation?.installed
              ? "The service is not installed yet. Install it with your Mac administrator password."
              : s.installation?.updateAvailable
              ? "A newer service build is ready in this project. Install it with your Mac administrator password."
              : "The installed service matches the local build."}
          </p>
          <div className="form-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => setMaintenance("install-update")}
            >
              <Download size={17} /> Install service update
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setMaintenance("reboot")}
            >
              <RotateCw size={17} /> Restart Mac
            </button>
          </div>
          <p className="footnote">
            Installation can briefly pause sharing. Restarting clears network
            state left by a previous service session.
          </p>
        </Panel>
        <Panel title="Client setup" extra={<EthernetPort size={19} />}>
          <p className="section-description">
            Enter these static IPv4 settings on your Ethernet device.
          </p>
          <Rows
            rows={[
              ["IPv4 address", s.configuration.clientIP],
              ["Subnet mask", s.configuration.subnetMask],
              ["Gateway", s.configuration.gateway],
              ["DNS servers", s.configuration.dns.join(", ")],
            ]}
          />
          <p className="footnote">
            The service supports one client. The subnet is fixed; DHCP and IPv6
            routing are not provided. DNS is configured on your device.
          </p>
        </Panel>
        <Panel title="Management access" className="access-panel">
          <p className="section-description">
            {s.managed
              ? "This local dashboard can read protected state and control the sharing service."
              : "Monitoring works without administrator access. Protected state and controls require authorization."}
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => act(s.managed ? "revoke" : "authorize")}
          >
            <ShieldCheck size={17} />
            {s.managed ? "Disable management access" : "Enable management"}
          </button>
        </Panel>
      </div>
      {confirm && (
        <Modal
          title="Apply network configuration?"
          onClose={() => setConfirm(false)}
        >
          <p>
            Sharing will pause while the old configuration restores its network
            and power settings. The new configuration will be built and
            installed with a macOS administrator prompt.
          </p>
          <Rows
            rows={[
              ["Ethernet MAC", mac],
              ["Upstream", upstream],
            ]}
          />
          <p>You can resume sharing after installation.</p>
          <div className="form-actions">
            <button className="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => {
                setConfirm(false);
                act("configure", {
                  ethernetMAC: mac,
                  upstreamInterface: upstream,
                });
              }}
            >
              Apply and pause sharing
            </button>
          </div>
        </Modal>
      )}
      {maintenance && (
        <Modal
          title={maintenance === "reboot" ? "Restart this Mac?" : "Install service update?"}
          onClose={() => setMaintenance(null)}
        >
          <p>
            {maintenance === "reboot"
              ? "macOS will schedule a restart in about one minute. Save your other work before continuing. Sharing will resume according to its saved state after startup."
              : "The latest service build will be installed and the sharing service restarted. macOS will ask for administrator approval. Keep the Ethernet adapter unplugged until installation finishes."}
          </p>
          <div className="form-actions">
            <button className="secondary" onClick={() => setMaintenance(null)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                const action = maintenance;
                setMaintenance(null);
                act(action);
              }}
            >
              {maintenance === "reboot" ? "Schedule restart" : "Install update"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
