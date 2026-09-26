export const known = (value) =>
  value === null || value === undefined
    ? "Unavailable"
    : value
      ? "Enabled"
      : "Disabled";
export const fmt = (n) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
export function bytes(n) {
  if (n == null) return "Unavailable";
  const i = n ? Math.min(3, Math.floor(Math.log(n) / Math.log(1024))) : 0;
  return `${fmt(n / 1024 ** i)} ${["B", "KB", "MB", "GB"][i]}`;
}
export function untracked(s) {
  return (
    s.managed &&
    !s.session &&
    s.forwarding === 1 &&
    s.natRules?.includes(s.configuration.clientIP)
  );
}
export function stateLabel(s) {
  return untracked(s)
    ? "Forwarding needs recovery"
    : s.sharing
      ? "Sharing active"
      : s.paused
        ? "Sharing paused"
        : !s.adapter
          ? "Waiting for adapter"
          : !s.link
            ? "Waiting for Ethernet"
            : !s.upstream
              ? "Waiting for Wi-Fi"
              : s.sharing === null
                ? "Limited visibility"
                : "Sharing inactive";
}
export function download(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
