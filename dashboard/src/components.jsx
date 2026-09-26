import React, { useEffect, useId } from "react";
import { Activity, X, CircleHelp } from "lucide-react";
import { useI18n } from "./i18n";
import { describeLog } from "./logs";
export function Help({ text }) {
  const { t } = useI18n();
  const id = useId();
  if (!text) return null;
  return <span className="help-wrap"><button type="button" className="help-button" aria-label={t("What is this?")} aria-describedby={id}><CircleHelp size={15} /></button><span className="help-popover" role="tooltip" id={id}>{t(text)}</span></span>;
}
export function Badge({ children, good = false }) {
  return (
    <span className={`badge ${good ? "good" : ""}`}>
      <span className="dot" />
      {children}
    </span>
  );
}
export function Panel({ title, extra, children, className = "" }) {
  const { t } = useI18n();
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{t(title)}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}
export function Rows({ rows }) {
  const { t } = useI18n();
  return (
    <dl className="rows">
      {rows.map(([label, value, help]) => (
        <div key={label}>
          <dt>{t(label)} <Help text={help} /></dt>
          <dd>{typeof value === "string" ? t(value) : value ?? t("Unavailable")}</dd>
        </div>
      ))}
    </dl>
  );
}
export function ActivityList({ logs, limit = 5 }) {
  const { t, locale } = useI18n();
  return (
    <div className="events">
      {logs.length ? (
        logs.slice(0, limit).map((line, i) => {
          const event = describeLog(line, t);
          const date = new Date(event.timestamp);
          return (
            <div className="event" key={i}>
              <time title={event.timestamp}>
                {isNaN(date)
                  ? "—"
                  : date.toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-GB", { hour12: false })}
              </time>
              <i className={event.level} />
              <div className="event-copy"><strong>{event.title}</strong>{event.detail && <span>{event.detail}</span>}<details><summary>{t("Technical detail")}</summary><code>{event.raw}</code></details></div>
            </div>
          );
        })
      ) : (
        <div className="empty">
          <Activity size={22} />
          <p>{t("Service logs are protected by macOS.")}</p>
          <span>{t("Enable management to see recent activity.")}</span>
        </div>
      )}
    </div>
  );
}
export function Modal({ title, children, onClose }) {
  const { t } = useI18n();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = document.querySelector("[role=dialog]");
    const handler = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = [
          ...dialog.querySelectorAll(
            "button:not(:disabled),input,select,a[href]",
          ),
        ];
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t(title)}
        className="modal"
      >
        <div className="panel-heading">
          <h2>{t(title)}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("Close dialog")}
            autoFocus
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
