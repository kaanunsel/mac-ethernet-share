import React, { useState } from "react";
import { Download } from "lucide-react";
import { Panel, ActivityList, Help } from "./components";
import { download } from "./format";
import { describeLog } from "./logs";
import { useI18n } from "./i18n";
export function ActivityPage({ s }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(""),
    [level, setLevel] = useState("all");
  const logs = s.logs.filter((line) => {
    const event = describeLog(line, t);
    return `${event.title} ${event.detail} ${line}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (level === "all" || event.level === "error");
  });
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
          {t("Export log")}
        </button>
      }
    >
      <div className="log-toolbar">
        <input
          aria-label={t("Search events")}
          placeholder={t("Search events…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label={t("Event severity")}
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="all">{t("All events")}</option>
          <option value="errors">{t("Errors only")}</option>
        </select>
        <span className="quiet live-count"><i />{s.managed ? t("{count} events · latest 250 · live", { count: logs.length }) : t("Enable management for live logs")} <Help text="These are recent events from the sharing service. New events appear at the top automatically." /></span>
      </div>
      {s.logs.length && !logs.length ? (
        <div className="empty">{t("No events match your filters.")}</div>
      ) : (
        <ActivityList logs={logs} limit={250} />
      )}
    </Panel>
  );
}
