import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
const base = process.env.DASHBOARD_URL;
test(
  "local API blocks cross-origin, unauthenticated and malformed mutations",
  { skip: !base },
  async () => {
    assert.equal((await fetch(base + "/api/session")).status, 401);
    const access = (
      await readFile(
        new URL("../../.build/dashboard-access.key", import.meta.url),
        "utf8",
      )
    ).trim();
    const session = await fetch(base + "/api/session", {
      headers: { "X-Dashboard-Access": access },
    });
    assert.equal(session.status, 200);
    const { token } = await session.json();
    const headers = {
      "X-Dashboard-Token": token,
      "Content-Type": "application/json",
      Cookie: session.headers.get("set-cookie").split(";")[0],
    };
    assert.equal((await fetch(base + "/api/status")).status, 403);
    assert.equal(
      (
        await fetch(base + "/api/status", {
          headers: { "X-Dashboard-Token": token },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/session", {
          headers: { "X-Dashboard-Access": "wrong" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + "/api/session", {
          headers: { Origin: "https://attacker.invalid" },
        })
      ).status,
      403,
    );
    assert.equal(
      await new Promise((resolve, reject) => {
        http
          .get(
            base + "/api/session",
            { headers: { Host: "attacker.invalid" } },
            (r) => {
              r.resume();
              resolve(r.statusCode);
            },
          )
          .on("error", reject);
      }),
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/session", {
          headers: { "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
      403,
    );
    let status;
    for (let attempt = 0; attempt < 20; attempt++) {
      status = await fetch(base + "/api/status", { headers });
      if (status.status !== 503) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(status.status, 200);
    const data = await status.json();
    assert.equal(typeof data.status.link, "boolean");
    assert.ok(data.status.timestamp);
    assert.equal(
      (
        await fetch(base + "/api/action", {
          method: "POST",
          headers,
          body: "broken",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/action", {
          method: "POST",
          headers,
          body: JSON.stringify({ action: "execute", command: "whoami" }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/action", {
          method: "POST",
          headers,
          body: JSON.stringify({
            action: "configure",
            ethernetMAC: "$(touch /tmp/test)",
            upstreamInterface: "en0",
          }),
        })
      ).status,
      400,
    );
  },
);
