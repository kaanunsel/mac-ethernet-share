export function validateConfiguration(value) {
  const mac = String(value.ethernetMAC ?? "").toLowerCase();
  const upstream = String(value.upstreamInterface ?? "");
  if (
    !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) ||
    mac === "00:00:00:00:00:00" ||
    parseInt(mac.slice(0, 2), 16) & 1 ||
    !/^en\d+$/.test(upstream)
  )
    throw new Error(
      "Choose a unicast adapter MAC address and an en-number upstream interface.",
    );
  return { ethernetMAC: mac, upstreamInterface: upstream };
}
export function counters(text, adapter) {
  if (!adapter || !text) return null;
  const row = text
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find(
      (f) => f[0].replace(/\*$/, "") === adapter && f[2]?.startsWith("<Link#"),
    );
  if (!row || row.length < 10) return null;
  // Link rows with no hardware address have one fewer column.
  const offset = row[3]?.includes(":") ? 1 : 0;
  const rx = Number(row[5 + offset]),
    tx = Number(row[8 + offset]);
  return Number.isFinite(rx) && Number.isFinite(tx) ? { rx, tx } : null;
}
export function hardware(text = "") {
  return text
    .split(/\n\s*\n/)
    .map((block) => ({
      name: block.match(/Hardware Port: (.+)/)?.[1],
      interface: block.match(/Device: (.+)/)?.[1],
      mac: block.match(/Ethernet Address: (.+)/)?.[1],
    }))
    .filter((p) => p.interface && p.mac);
}
export function rates(previous, current, elapsed) {
  if (
    !previous ||
    !current ||
    elapsed <= 0 ||
    current.rx < previous.rx ||
    current.tx < previous.tx
  )
    return null;
  return {
    download: ((current.tx - previous.tx) * 8) / elapsed / 1e6,
    upload: ((current.rx - previous.rx) * 8) / elapsed / 1e6,
  };
}

export function chartHistory(history, now) {
  const recentSince = now - 15 * 60000;
  const older = new Map();
  const recent = [];
  for (const point of history) {
    if (point.time >= recentSince) {
      recent.push(point);
      continue;
    }
    const bucket = Math.floor(point.time / 30000) * 30000;
    if (!older.has(bucket)) older.set(bucket, { time: point.time, download: 0, upload: 0, downloads: 0, uploads: 0 });
    const summary = older.get(bucket);
    summary.time = point.time;
    for (const key of ["download", "upload"]) {
      if (point[key] !== null) {
        summary[key] += point[key];
        summary[key === "download" ? "downloads" : "uploads"]++;
      }
    }
  }
  return [
    ...[...older.values()].map(({ time, download, upload, downloads, uploads }) => ({
      time,
      download: downloads ? download / downloads : null,
      upload: uploads ? upload / uploads : null,
    })),
    ...recent,
  ];
}
