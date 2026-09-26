import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const label = "local.ethernetshare.dashboard";
const domain = `gui/${process.getuid()}`;
const directory = path.join(os.homedir(), "Library/LaunchAgents");
const plist = path.join(directory, label + ".plist");
const run = (args) =>
  execFileSync("/bin/launchctl", args, { stdio: "inherit" });
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const action = process.argv[2];
if (process.getuid() === 0)
  throw new Error("Run dashboard commands as your normal user.");
if (action === "install") {
  mkdirSync(directory, { recursive: true });
  mkdirSync(path.join(root, ".build"), { recursive: true });
  const xml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(root)}/dashboard/server.mjs</string></array><key>WorkingDirectory</key><string>${escape(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${escape(root)}/.build/dashboard.log</string><key>StandardErrorPath</key><string>${escape(root)}/.build/dashboard.log</string></dict></plist>`;
  writeFileSync(plist, xml, { mode: 0o600 });
  try {
    execFileSync("/bin/launchctl", ["print", `${domain}/${label}`], {
      stdio: "ignore",
    });
    run(["kickstart", "-k", `${domain}/${label}`]);
  } catch {
    run(["bootstrap", domain, plist]);
  }
  console.log("Dashboard starts at login: http://127.0.0.1:3847");
} else if (action === "open") {
  const key = readFileSync(
    path.join(root, ".build/dashboard-access.key"),
    "utf8",
  ).trim();
  if (!/^[0-9a-f]{64}$/.test(key))
    throw new Error("Start the dashboard before opening it.");
  execFileSync("/usr/bin/open", [`http://127.0.0.1:3847/#access=${key}`]);
} else if (action === "stop") {
  run(["bootout", `${domain}/${label}`]);
} else if (action === "start") {
  run(["bootstrap", domain, plist]);
} else if (action === "status") {
  run(["print", `${domain}/${label}`]);
} else if (action === "uninstall") {
  try {
    run(["bootout", `${domain}/${label}`]);
  } catch {}
  try {
    unlinkSync(plist);
  } catch {}
  console.log(
    "Dashboard login item removed. The sharing service is unchanged.",
  );
} else throw new Error("Expected install, start, stop, status, or uninstall.");
