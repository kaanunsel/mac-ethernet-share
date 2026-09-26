import React, { useEffect, useState } from "react";
import { Battery, Download, AlertCircle } from "lucide-react";
import { Panel, Rows } from "./components";
import { known, download } from "./format";
export function Diagnostics({ s }) {
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
              ],
            ]}
          />
        </Panel>
        <Panel title="Power & recovery">
          <Rows
            rows={[
              ["Power source", s.ac ? "AC power" : "Battery"],
              ["Lid", s.lidClosed ? "Closed" : "Open"],
              ["Adapter power hold", known(s.powerHold)],
              [
                "System sleep disabled",
                known(s.sleepDisabled === null ? null : s.sleepDisabled === 1),
              ],
              [
                "Recovery journal",
                s.managed
                  ? s.session
                    ? "Present"
                    : "No network session"
                  : "Unavailable",
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
          Export diagnostics
        </button>
        <span className="quiet">
          Exports include local IP addresses, adapter MACs, and service logs.
        </span>
      </div>
      {s.errors.length > 0 && (
        <div className="notice error">
          <AlertCircle size={18} />
          <div>
            <strong>Some system checks could not be read</strong>
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
          <pre>{text ?? "Enable management to read this protected state."}</pre>
        </Panel>
      ))}
    </>
  );
}
