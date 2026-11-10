import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, it } from "node:test";
import { encodeBase64Url, parseLinkHash } from "../js/link.js";
import { formatPair, formatUsd, formatVilnius } from "../js/format.js";
import { clampWindow, candlesFromCoin, normalizeCandles } from "../js/series.js";
import { parseOhlcv, pickPool } from "../js/gecko.js";
import { safeImageUrl } from "../js/api.js";
import { isMint } from "../js/text.js";

describe("private link", () => {
  it("round-trips a data base and keeps it out of the query", () => {
    const base = "https://emiiss67.github.io/Trading-desk/sample";
    const hash = `#d=${encodeBase64Url(base)}&k=sample-desk-key-1`;
    const parsed = parseLinkHash(hash);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.base, base);
    assert.equal(parsed.key, "sample-desk-key-1");
    assert.equal(hash.includes(base), false);
  });

  it("rejects missing, short, and non-https links", () => {
    assert.equal(parseLinkHash("").ok, false);
    assert.equal(parseLinkHash(`#d=${encodeBase64Url("https://example.com/sample")}&k=short`).ok, false);
    assert.equal(parseLinkHash(`#d=${encodeBase64Url("javascript:alert(1)")}&k=sample-desk-key-1`).ok, false);
    assert.equal(parseLinkHash(`#d=${encodeBase64Url("http://example.com/sample")}&k=sample-desk-key-1`).ok, false);
    assert.equal(parseLinkHash(`#d=${encodeBase64Url("http://127.0.0.1:4173/sample")}&k=sample-desk-key-1`).ok, true);
  });
});

describe("format", () => {
  it("labels Europe/Vilnius in winter time", () => {
    const label = formatVilnius("2026-11-10T17:39:45Z");
    assert.match(label, /2026-11-10 19:39:45 Europe\/Vilnius/);
  });

  it("switches the primary unit", () => {
    assert.equal(formatPair(186.4, 186.4, "USD").primary, formatUsd(186.4));
    assert.equal(formatPair(186.4, 186.4, "SOL").primary, "1");
  });
});

describe("charts and gecko shapes", () => {
  it("clamps the candle window", () => {
    assert.deepEqual(clampWindow(10, -5, 100), { start: 0, count: 10 });
    assert.deepEqual(clampWindow(100, 90, 20), { start: 80, count: 20 });
  });

  it("parses gecko rows oldest-first", () => {
    const rows = parseOhlcv({
      data: { attributes: { ohlcv_list: [[200, 2, 4, 1, 3, 10], [100, 1, 2, 0.5, 1.5, 8]] } },
    });
    assert.equal(rows[0].t, 100);
    assert.equal(rows[1].c, 3);
    assert.equal(pickPool({ data: [{ attributes: { address: "a".repeat(32), reserve_in_usd: "1" } }, { attributes: { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", reserve_in_usd: "9" } }] }), "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
  });

  it("reads desk candles and ignores bad image urls", () => {
    const rows = candlesFromCoin({ candles: { "5m": [{ t: 1, o: 2, h: 1, l: 3, c: 2.5, v: -4 }] } }, "5m");
    assert.equal(rows[0].h, 2.5);
    assert.equal(rows[0].l, 2);
    assert.equal(rows[0].v, 0);
    assert.equal(safeImageUrl("javascript:alert(1)", "https://example.com/sample/"), "");
    assert.equal(safeImageUrl("icons/ngls.svg", "https://example.com/sample"), "https://example.com/sample/icons/ngls.svg");
  });
});

describe("sample fixture", () => {
  const root = new URL("../sample/", import.meta.url);
  const snapshot = JSON.parse(readFileSync(new URL("snapshot.json", root), "utf8"));

  it("is labeled sample data with the desk fields", () => {
    assert.equal(snapshot.schema_version, 1);
    assert.equal(snapshot.sample, true);
    assert.equal(snapshot.desk.mode, "paper");
    assert.ok(snapshot.wallet.sol > 0);
    assert.ok(snapshot.equity.usd > snapshot.equity.free_cash_usd);
    assert.ok(["ok", "warning", "hit"].includes(snapshot.today.cap_status));
    assert.match(snapshot.generated_at, /Z$/);
    assert.ok(snapshot.equity_curve.length > 2);
    assert.ok(snapshot.health.bots.length >= 1);
  });

  it("sorts scans and keeps coin files honest", () => {
    const times = snapshot.scanned.map((row) => Date.parse(row.scanned_at));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    let files = 0;
    for (const row of snapshot.scanned) {
      assert.equal(isMint(row.mint), true);
      assert.ok(["bought", "rejected", "watching"].includes(row.decision));
      const file = new URL(`coins/${row.mint}.json`, root);
      if (!existsSync(file)) continue;
      files += 1;
      const coin = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(coin.mint, row.mint);
      if (row.symbol === "BONK") assert.equal(candlesFromCoin(coin, "5m").length, 0);
      else {
        for (const tf of ["1m", "5m", "15m", "1h"]) {
          const candles = normalizeCandles(coin.candles[tf]);
          assert.ok(candles.length > 10);
          for (const candle of candles) assert.ok(candle.h >= candle.l);
        }
      }
    }
    assert.ok(files >= 6);
    assert.equal(existsSync(new URL("icons/missing-violet.svg", root)), false);
    assert.equal(existsSync(new URL("icons/ngls.svg", root)), true);
  });
});

describe("shell has no runtime cdn", () => {
  it("keeps html, css, and js local", () => {
    const files = ["../index.html", "../css/app.css", "../sw.js"];
    for (const file of files) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.doesNotMatch(text, /unpkg|jsdelivr|cdnjs|googleapis|sketch/i);
    }
    for (const file of readdirSync(new URL("../js/", import.meta.url))) {
      if (!file.endsWith(".js")) continue;
      const text = readFileSync(new URL(`../js/${file}`, import.meta.url), "utf8");
      assert.equal(text.includes("innerHTML"), false);
      assert.doesNotMatch(text, /unpkg|jsdelivr|cdnjs/);
    }
  });
});
