const fields = (text) => Object.fromEntries([...text.matchAll(/([a-z-]+)=([^ ]+)/g)].map(([, key, value]) => [key, value]));

export function describeLog(line, t) {
  const match = line.match(/^(\S+)\s+(.+)$/);
  const timestamp = match?.[1] || "";
  const raw = match?.[2] || line;
  const f = fields(raw);
  const adapter = f.adapter?.startsWith("connected") ? f.adapter.match(/\(([^)]+)\)/)?.[1] : null;
  const reason = (value) => t({
    "all-conditions-ready": "Connection ready", "adapter-removed": "Adapter removed", "ethernet-link-down": "Ethernet cable disconnected",
    "wifi-unavailable": "Wi-Fi unavailable", "manual-pause": "Manually paused", "session-drift": "Connection state changed",
    "adapter-present": "Adapter attached", "lid-closed-after-sharing-stop": "Sharing stopped with lid closed",
    "adapter-removed-or-paused": "Adapter removed or sharing paused",
  }[value] || value || "Unknown reason");
  let title = raw, detail = "", level = "info";
  if (raw.startsWith("STATE ")) {
    title = adapter ? t("Connection status: adapter {adapter}", { adapter }) : t("Connection status: no adapter");
    detail = [
      t("Ethernet: {state}", { state: t(f.ethernet === "up" ? "connected" : "disconnected") }),
      t("Wi-Fi: {state}", { state: t(f.wifi === "ready" ? "ready" : "unavailable") }),
      t("Power: {state}", { state: t(f.power === "AC" ? "charger" : "battery") }),
      t("Lid: {state}", { state: t(f.lid === "closed" ? "closed" : "open") }),
      t("Automation: {state}", { state: t(f.automation === "paused" ? "paused" : "enabled") }),
    ].join(" · ");
  } else if (raw.startsWith("DAEMON ready")) {
    title = t("Sharing service started");
    detail = t("The background service is monitoring the connection."); level = "good";
  } else if (raw.startsWith("POWER hold")) {
    title = t("Mac sleep prevention enabled");
    detail = t("The adapter is connected. The Mac stays awake on battery or charger while automation is active."); level = "good";
  } else if (raw.startsWith("POWER restored")) {
    title = t("Normal sleep settings restored");
    detail = t("The adapter was removed or automation was paused.");
  } else if (raw.startsWith("SHARING start-trigger")) {
    title = t("Starting internet sharing");
    detail = t("Reason: {reason}", { reason: reason(f.reason) });
  } else if (raw.startsWith("SHARING started")) {
    title = t("Internet sharing active");
    detail = t("Ethernet {interface} is sharing internet with {client}.", { interface: f.interface || "—", client: f.client || "—" }); level = "good";
  } else if (raw.startsWith("SHARING stop-trigger")) {
    title = t("Stopping internet sharing");
    detail = t("Reason: {reason}", { reason: reason(f.reason) });
  } else if (raw.startsWith("SHARING stopped")) {
    title = t("Internet sharing stopped");
    detail = f["settings-restored"] === "true" ? t("Network settings were restored.") : "";
  } else if (raw.startsWith("SLEEP requested")) {
    title = t("Mac sleep requested");
    detail = t("Reason: {reason}", { reason: reason(f.reason) });
  } else if (raw.startsWith("CLEANUP retry")) {
    title = t("Retrying network cleanup");
    detail = t("The service is restoring a network setting.");
  } else if (raw.startsWith("ERROR:")) {
    level = "error";
    if (raw.includes("Adapter has a non-link-local IPv4 address")) {
      title = t("Adapter already has an IP address");
      detail = t("The service left the existing network configuration unchanged to avoid replacing another setup.");
    } else if (raw.includes("Cleanup incomplete")) {
      title = t("Network cleanup needs attention");
      detail = t("The service kept its recovery record so it can retry safely.");
    } else {
      title = t("Service error");
      detail = raw.slice(7).trim();
    }
  }
  return { timestamp, raw, title, detail, level, line };
}
