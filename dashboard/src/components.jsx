import React, { useEffect, useState } from "react";
import { Activity, X } from "lucide-react";
export function Badge({ children, good = false }) {
  return (
    <span className={`badge ${good ? "good" : ""}`}>
      <span className="dot" />
      {children}
    </span>
  );
}
export function Panel({ title, extra, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}
export function Rows({ rows }) {
  return (
    <dl className="rows">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "Unavailable"}</dd>
        </div>
      ))}
    </dl>
  );
}
export function ActivityList({ logs, limit = 5 }) {
  return (
    <div className="events">
      {logs.length ? (
        logs.slice(0, limit).map((line, i) => {
          const split = line.indexOf(" ");
          const when = line.slice(0, split),
            message = line.slice(split + 1);
          const date = new Date(when);
          return (
            <div className="event" key={i}>
              <time title={when}>
                {isNaN(date)
                  ? "—"
                  : date.toLocaleTimeString([], { hour12: false })}
              </time>
              <i
                className={
                  /ERROR|fail/i.test(message)
                    ? "error"
                    : /START|ready|resumed/i.test(message)
                      ? "good"
                      : ""
                }
              />
              <span>{message}</span>
            </div>
          );
        })
      ) : (
        <div className="empty">
          <Activity size={22} />
          <p>Service logs are protected by macOS.</p>
          <span>Enable management to see recent activity.</span>
        </div>
      )}
    </div>
  );
}
export function Modal({ title, children, onClose }) {
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
        aria-label={title}
        className="modal"
      >
        <div className="panel-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
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
