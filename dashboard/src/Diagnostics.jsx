import React from "react";
import { Download, AlertCircle } from "lucide-react";
import { Panel, Rows } from "./components";
import { known, download } from "./format";
import { useI18n } from "./i18n";
export function Diagnostics({ s }) {
  const { t } = useI18n();
  return (
    <>
      <div className="bottom-grid">
        <Panel title="Readiness checks">
          <Rows
            rows={[
              ["Launch daemon", known(s.serviceRunning)],
              ["Adapter detected", s.adapter || "Absent"],
              ["Ethernet link", s.link ? "Up" : "Down"],
              ["Primary Wi-Fi upstream", s.upstream ? "Ready" : "Not ready"],
              ["Primary IPv4 interface", s.primaryInterface],
              [
                "Automation",
                s.paused === null ? "Unavailable" : known(!s.paused),
              ],
              [
                "IPv4 forwarding",
                known(s.forwarding === null ? null : s.forwarding === 1),
                "IPv4 forwarding lets this Mac pass traffic between the Ethernet device and Wi-Fi. NAT translates the device's private address for internet access.",
              ],
            ]}
          />
        </Panel>
        <Panel title="Power & recovery">
          <Rows
            rows={[
              ["Power source", s.ac ? "AC power" : "Battery"],
              ["Lid", s.lidClosed ? "Closed" : "Open"],
              ["Adapter power hold", known(s.powerHold), "The power hold prevents the Mac from sleeping while the selected adapter is attached and automation is enabled, including on battery."],
              [
                "System sleep disabled",
                known(s.sleepDisabled === null ? null : s.sleepDisabled === 1),
                "The power hold prevents the Mac from sleeping while the selected adapter is attached and automation is enabled, including on battery.",
              ],
              [
                "Recovery journal",
                s.managed
                  ? s.session
                    ? "Present"
                    : "No network session"
                  : "Unavailable",
                "The recovery journal records which network settings the service changed so it can restore them safely after stopping or rebooting.",
              ],
              [
                "Original forwarding",
                s.session
                  ? String(s.session.originalForwarding)
                  : "No recorded session",
              ],
              [
                "Session interface",
                s.session?.interface || "No recorded session",
              ],
            ]}
          />
        </Panel>
      </div>
      <div className="diagnostic-actions">
        <button
          className="secondary"
          onClick={() =>
            download(
              "ethernetshare-diagnostics.json",
              JSON.stringify(s, null, 2),
            )
          }
        >
          <Download size={16} />
          {t("Export diagnostics")}
        </button>
        <span className="quiet">
          {t("Exports include local IP addresses, adapter MACs, and service logs.")}
        </span>
      </div>
      {s.errors.length > 0 && (
        <div className="notice error">
          <AlertCircle size={18} />
          <div>
            <strong>{t("Some system checks could not be read")}</strong>
            {s.errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        </div>
      )}
      {[
        ["NAT rules", s.natRules],
        ["Packet filter rules", s.filterRules],
        ["Launch daemon state", s.service],
        ["Power details", s.power],
      ].map(([title, text]) => (
        <Panel key={title} title={title} className="raw-panel">
          <pre>{text ?? t("Enable management to read this protected state.")}</pre>
        </Panel>
      ))}
    </>
  );
}
