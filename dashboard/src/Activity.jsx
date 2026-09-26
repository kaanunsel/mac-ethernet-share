import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Panel, ActivityList } from "./components";
import { download } from "./format";
export function ActivityPage({ s }) {
  const [query, setQuery] = useState(""),
    [level, setLevel] = useState("all");
  const logs = s.logs.filter(
    (l) =>
      l.toLowerCase().includes(query.toLowerCase()) &&
      (level === "all" || /error|fail/i.test(l)),
  );
  return (
    <Panel
      title="Service event log"
      extra={
        <button
          className="secondary"
          disabled={!s.logs.length}
          onClick={() =>
            download("ethernetshare.log", s.logs.slice().reverse().join("\n"))
          }
        >
          <Download size={16} />
          Export log
        </button>
      }
    >
      <div className="log-toolbar">
        <input
          aria-label="Search events"
          placeholder="Search events…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Event severity"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="all">All events</option>
          <option value="errors">Errors only</option>
        </select>
        <span className="quiet">{logs.length} events · latest 250</span>
      </div>
      {s.logs.length && !logs.length ? (
        <div className="empty">No events match your filters.</div>
      ) : (
        <ActivityList logs={logs} limit={250} />
      )}
    </Panel>
  );
}
