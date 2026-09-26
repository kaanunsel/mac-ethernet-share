import test from "node:test";
import assert from "node:assert/strict";
import { validateConfiguration, counters, hardware, rates } from "../lib.mjs";
test("configuration rejects shell injection and invalid or multicast addresses", () => {
  for (const mac of [
    "",
    "00:00:00:00:00:00",
    "ff:ff:ff:ff:ff:ff",
    "01:00:00:00:00:01",
    '02:00:00:00:00:01";exit',
  ])
    assert.throws(() =>
      validateConfiguration({ ethernetMAC: mac, upstreamInterface: "en0" }),
    );
  assert.throws(() =>
    validateConfiguration({
      ethernetMAC: "02:00:00:00:00:01",
      upstreamInterface: "en0; reboot",
    }),
  );
  assert.deepEqual(
    validateConfiguration({
      ethernetMAC: "AA:00:00:00:00:01",
      upstreamInterface: "en0",
    }),
    { ethernetMAC: "aa:00:00:00:00:01", upstreamInterface: "en0" },
  );
});
test("traffic uses link totals once, not duplicate IPv4 rows", () => {
  const text =
    "en9 1500 <Link#8> aa:00:00:00:00:01 20 0 12345 30 0 54321 0\nen9 1500 192.168.2 192.168.2.1 20 - 12345 30 - 54321 -";
  assert.deepEqual(counters(text, "en9"), { rx: 12345, tx: 54321 });
  assert.equal(counters(text, "en8"), null);
  assert.deepEqual(counters("en9* 1500 <Link#8> 20 0 100 30 0 200 0", "en9"), {
    rx: 100,
    tx: 200,
  });
});
test("rates are client-relative and discard counter resets and initial samples", () => {
  assert.deepEqual(rates({ rx: 0, tx: 0 }, { rx: 125000, tx: 250000 }, 1), {
    download: 2,
    upload: 1,
  });
  assert.equal(rates({ rx: 10, tx: 10 }, { rx: 0, tx: 0 }, 5), null);
  assert.equal(rates(null, { rx: 0, tx: 0 }, 5), null);
  assert.equal(rates({ rx: 0, tx: 0 }, { rx: 0, tx: 0 }, 0), null);
});
test("hardware inventory keeps display names and exact identifiers", () => {
  assert.deepEqual(
    hardware(
      "Hardware Port: USB LAN\nDevice: en9\nEthernet Address: aa:00:00:00:00:01\n\nVLAN Configurations\n",
    ),
    [{ name: "USB LAN", interface: "en9", mac: "aa:00:00:00:00:01" }],
  );
});
