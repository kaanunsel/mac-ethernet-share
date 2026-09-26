import test from "node:test";
import assert from "node:assert/strict";
import { describeLog } from "../src/logs.js";

const t = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), key);

test("known service events become readable without losing raw diagnostics", () => {
  const line = "2026-09-26T19:50:55Z SHARING started interface=en9 client=192.168.2.2 forwarding-original=0";
  const event = describeLog(line, t);
  assert.equal(event.title, "Internet sharing active");
  assert.match(event.detail, /en9.*192\.168\.2\.2/);
  assert.equal(event.level, "good");
  assert.equal(event.raw, line.split(" ").slice(1).join(" "));
  assert.equal(event.timestamp, "2026-09-26T19:50:55Z");
});

test("the adapter-address refusal explains why configuration was left alone", () => {
  const event = describeLog("2026-09-26T19:29:26Z ERROR: Adapter has a non-link-local IPv4 address; refusing to replace another network configuration.", t);
  assert.equal(event.level, "error");
  assert.equal(event.title, "Adapter already has an IP address");
  assert.match(event.detail, /left the existing network configuration unchanged/);
});
