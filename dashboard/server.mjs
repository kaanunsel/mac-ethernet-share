import http from "node:http";
import { constants } from "node:fs";
import net from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, rename, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { counters, hardware, rates, validateConfiguration } from "./lib.mjs";
const execute = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(directory);
const uid = process.getuid();
if (uid === 0)
  throw new Error("Run the dashboard as your normal user, not root.");
const port = Number(process.env.ETHERNET_DASHBOARD_PORT || 3847);
const origin = `http://127.0.0.1:${port}`;
const socket = `/var/run/ethernetshare-dashboard-${uid}.sock`;
const token = randomBytes(32).toString("hex");
const binary = path.join(root, ".build/ethernetshared");
const installedBinary = "/Library/PrivilegedHelperTools/local.ethernetshare/ethernetshared";
const keyPath = path.join(root, ".build/dashboard-access.key");
let keyFile;
try {
  keyFile = await open(
    keyPath,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_RDWR |
      constants.O_NOFOLLOW,
    0o600,
  );
  await keyFile.writeFile(randomBytes(32).toString("hex"));
} catch (e) {
  if (e.code !== "EEXIST") throw e;
  keyFile = await open(keyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
}
const keyInfo = await keyFile.stat();
if (!keyInfo.isFile() || keyInfo.uid !== uid || keyInfo.mode & 0o077)
  throw new Error("Unsafe dashboard access key permissions.");
const keyBuffer = Buffer.alloc(64);
const { bytesRead } = await keyFile.read(keyBuffer, 0, 64, 0);
const accessKey = keyBuffer.subarray(0, bytesRead).toString("utf8").trim();
await keyFile.close();
if (!/^[0-9a-f]{64}$/.test(accessKey))
  throw new Error("Invalid dashboard access key.");
function equalSecret(a, b) {
  const left = Buffer.from(a || ""),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function browserAuthorized(req) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("EthernetDashboard="))
    ?.slice("EthernetDashboard=".length);
  return equalSecret(cookie, accessKey);
}

let cache,
  lastSample,
  history = [],
  collecting = false,
  busy = false,
  lastError = null;
function bridge(command) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socket);
    let text = "";
    client.setTimeout(25000);
    client.on("connect", () => client.write(command + "\n"));
    client.on("data", (chunk) => {
      text += chunk;
      if (text.length > 2e6)
        client.destroy(new Error("Oversized helper response"));
    });
    client.on("timeout", () =>
      client.destroy(new Error("Management helper timed out.")),
    );
    client.on("error", reject);
    client.on("end", () => {
      try {
        const result = JSON.parse(text);
        result.ok ? resolve(result.output) : reject(new Error(result.error));
      } catch (e) {
        reject(e);
      }
    });
  });
}
async function collect() {
  if (collecting) return;
  collecting = true;
  try {
    let raw,
      managed = false,
      managementError = null;
    try {
      raw = await bridge("status");
      managed = true;
    } catch (e) {
      if (!["ENOENT", "ECONNREFUSED"].includes(e.code))
        managementError = e.message;
      raw = (
        await execute(binary, ["dashboard-json"], {
          timeout: 35000,
          maxBuffer: 2e6,
        })
      ).stdout;
    }
    const status = JSON.parse(raw);
    if (managementError) status.errors.push(managementError);
    const sample = counters(status.counters, status.adapter);
    const now = Date.now();
    const rate =
      lastSample?.adapter === status.adapter
        ? rates(lastSample?.value, sample, (now - lastSample.time) / 1000)
        : null;
    history.push({ time: now, ...(rate || { download: null, upload: null }) });
    history = history.filter((p) => now - p.time <= 15 * 60000).slice(-300);
    lastSample = { value: sample, time: now, adapter: status.adapter };
    let logs = [];
    if (managed) {
      try {
        logs = (await bridge("logs"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .reverse();
      } catch (e) {
        status.errors.push(e.message);
      }
    }
    cache = {
      ...status,
      installation: {
        installed: await readFile(installedBinary).then(() => true).catch(() => false),
        updateAvailable: await Promise.all([
          readFile(binary).catch(() => null),
          readFile(installedBinary).catch(() => null),
        ]).then(([local, installed]) => Boolean(local && (!installed || !local.equals(installed)))),
      },
      managed,
      ports: hardware(status.hardware),
      traffic: { rate, totals: sample, history },
      logs,
    };
    lastError = null;
  } catch (e) {
    lastError = e.message;
  } finally {
    collecting = false;
  }
}
function quote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
async function elevated(script) {
  const apple = `do shell script ${JSON.stringify(script)} with administrator privileges`;
  try {
    return (
      await execute("/usr/bin/osascript", ["-e", apple], {
        timeout: 180000,
        maxBuffer: 2e6,
      })
    ).stdout;
  } catch (e) {
    throw new Error((e.stderr || e.message).trim());
  }
}
async function authorize() {
  const helperDir =
    "/Library/PrivilegedHelperTools/local.ethernetshare-dashboard";
  const label = `local.ethernetshare.dashboard-management.${uid}`;
  const plist = `/Library/LaunchDaemons/${label}.plist`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${helperDir}/ethernetshared</string><string>dashboard-agent</string><string>${uid}</string></array><key>RunAtLoad</key><false/><key>StandardErrorPath</key><string>/var/log/ethernetshare-dashboard.log</string><key>StandardOutPath</key><string>/var/log/ethernetshare-dashboard.log</string></dict></plist>`;
  await elevated(
    `set -e\ncd ${quote(root)}\n/bin/bash install.sh\n/usr/bin/install -d -o root -g wheel -m 755 ${helperDir}\n/usr/bin/install -o root -g wheel -m 755 .build/ethernetshared ${helperDir}/ethernetshared\n/usr/bin/printf %s ${quote(xml)} > ${plist}\n/bin/chmod 644 ${plist}\n/usr/sbin/chown root:wheel ${plist}\n/bin/launchctl bootstrap system ${plist} 2>/dev/null || true\n/bin/launchctl kickstart system/${label}`,
  );
  // Never announce success until the protected bridge actually responds.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await bridge("status");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(
    "Management helper did not start. See /var/log/ethernetshare-dashboard.log.",
  );
}
async function installUpdate() {
  await execute("/bin/bash", ["build.sh"], {
    cwd: root,
    timeout: 120000,
    maxBuffer: 2e6,
  });
  await elevated(`set -e\ncd ${quote(root)}\n/bin/bash install.sh`);
  return "Service update installed. Reboot this Mac to clear any old, untracked network state.";
}
async function applyConfiguration(body) {
  const config = validateConfiguration(body);
  if (
    cache?.ports.some(
      (p) =>
        p.mac.toLowerCase() === config.ethernetMAC &&
        p.interface === config.upstreamInterface,
    )
  )
    throw new Error(
      "Upstream and Ethernet adapter must be different interfaces.",
    );
  const target = path.join(root, "Configuration.local.swift");
  const old = await readFile(target, "utf8").catch(() => null);
  const content = `enum Configuration {\n    static let ethernetMAC = "${config.ethernetMAC}"\n    static let upstreamInterface = "${config.upstreamInterface}"\n}\n`;
  await writeFile(target + ".dashboard-tmp", content, { mode: 0o600 });
  await rename(target + ".dashboard-tmp", target);
  try {
    await execute("/bin/bash", ["build.sh"], {
      cwd: root,
      timeout: 120000,
      maxBuffer: 2e6,
    });
    // Old installed configuration must recover its own state before replacement.
    const installed =
      "/Library/PrivilegedHelperTools/local.ethernetshare/ethernetshared";
    await elevated(
      `set -e\ncd ${quote(root)}\n${installed} stop\n/bin/launchctl bootout system/local.ethernetshare\n${installed} recover\n/bin/launchctl bootstrap system /Library/LaunchDaemons/local.ethernetshare.plist\n/bin/bash install.sh`,
    );
    return "Configuration installed. Automatic sharing is paused; resume when ready.";
  } catch (e) {
    if (old !== null) {
      await writeFile(target, old);
      await execute("/bin/bash", ["build.sh"], {
        cwd: root,
        timeout: 120000,
      }).catch(() => {});
    }
    throw new Error("Configuration was not applied successfully. " + e.message);
  }
}
function json(res, code, value) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
function authorized(req) {
  const supplied = Buffer.from(req.headers["x-dashboard-token"] || "");
  const expected = Buffer.from(token);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host))
    return json(res, 403, { error: "Invalid host." });
  if (
    req.headers.origin &&
    ![origin, `http://localhost:${port}`].includes(req.headers.origin)
  )
    return json(res, 403, { error: "Cross-origin requests are not allowed." });
  if (
    req.headers["sec-fetch-site"] &&
    !["same-origin", "none"].includes(req.headers["sec-fetch-site"])
  )
    return json(res, 403, { error: "Cross-site requests are not allowed." });
  const url = new URL(req.url, origin);
  try {
    if (req.method === "GET" && url.pathname === "/api/session") {
      if (
        !browserAuthorized(req) &&
        !equalSecret(req.headers["x-dashboard-access"], accessKey)
      )
        return json(res, 401, {
          error:
            "Connect this browser once by running ./dashboard.sh open from the project folder. Your browser will then remember local access.",
        });
      res.setHeader(
        "Set-Cookie",
        `EthernetDashboard=${accessKey}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
      );
      return json(res, 200, { token });
    }
    if (
      url.pathname.startsWith("/api/") &&
      (!authorized(req) || !browserAuthorized(req))
    )
      return json(res, 403, {
        error: "Refresh this page to authenticate the local session.",
      });
    if (req.method === "GET" && url.pathname === "/api/status")
      return json(res, cache ? 200 : 503, {
        status: cache,
        error: lastError,
        busy,
      });
    if (req.method === "POST" && url.pathname === "/api/action") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return json(res, 415, { error: "JSON required." });
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) {
          json(res, 413, { error: "Request too large." });
          return;
        }
      }
      let value;
      try {
        value = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "Invalid JSON." });
      }
      const allowed = [
        "authorize",
        "start",
        "stop",
        "restart",
        "revoke",
        "configure",
        "install-update",
        "reboot",
        "refresh",
      ];
      if (!allowed.includes(value.action))
        return json(res, 400, { error: "Unknown action." });
      if (busy)
        return json(res, 409, { error: "Another operation is still running." });
      busy = true;
      try {
        let message = "Status refreshed.";
        if (value.action === "authorize") {
          await authorize();
          message = "Management access enabled.";
        } else if (value.action === "configure") {
          if (!cache?.managed)
            throw new Error("Enable management access first.");
          message = await applyConfiguration(value);
        } else if (value.action === "install-update") {
          message = await installUpdate();
        } else if (value.action === "reboot") {
          await elevated("/sbin/shutdown -r +1");
          message = "Mac restart scheduled in about one minute. Save any other work now.";
        } else if (value.action === "revoke")
          message = await bridge("shutdown");
        else if (value.action !== "refresh")
          message = await bridge(value.action);
        while (collecting)
          await new Promise((resolve) => setTimeout(resolve, 100));
        await collect();
        json(res, 200, { message });
      } finally {
        busy = false;
      }
      return;
    }
    if (url.pathname.startsWith("/api/"))
      return json(res, 404, { error: "Not found." });
    if (!["GET", "HEAD"].includes(req.method))
      return json(res, 405, { error: "Method not allowed." });
    const file =
      url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname).slice(1);
    const absolute = path.resolve(directory, "dist", file);
    if (!absolute.startsWith(path.join(directory, "dist") + path.sep))
      return json(res, 403, { error: "Invalid path." });
    const data = await readFile(absolute);
    const mime =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control":
        file === "index.html" ? "no-store" : "public, max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});
server.requestTimeout = 200000;
server.listen(port, "127.0.0.1", () =>
  console.log(`Ethernet Share dashboard: ${origin}`),
);
server.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
await collect();
setInterval(collect, 5000).unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
