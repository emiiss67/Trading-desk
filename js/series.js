import { num } from "./text.js";

export function clampWindow(length, start, count, minCount = 12) {
  const max = Math.max(0, length | 0);
  if (max === 0) return { start: 0, count: 0 };
  const floor = Math.min(max, minCount);
  let nextCount = Math.round(Number(count));
  if (!Number.isFinite(nextCount)) nextCount = Math.min(max, 48);
  nextCount = Math.min(max, Math.max(floor, nextCount));
  let nextStart = Math.round(Number(start));
  if (!Number.isFinite(nextStart)) nextStart = Math.max(0, max - nextCount);
  nextStart = Math.min(Math.max(0, nextStart), max - nextCount);
  return { start: nextStart, count: nextCount };
}

export function normalizeCandles(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows.slice(0, 1000)) {
    if (!row || typeof row !== "object") continue;
    const t = num(row.time ?? row.t);
    const o = num(row.open ?? row.o);
    const h = num(row.high ?? row.h);
    const l = num(row.low ?? row.l);
    const c = num(row.close ?? row.c);
    const v = num(row.volume_usd ?? row.volume ?? row.v);
    if ([t, o, h, l, c].some((value) => value == null)) continue;
    out.push({
      t: t > 1e12 ? Math.floor(t / 1000) : t,
      o,
      h: Math.max(h, o, c),
      l: Math.min(l, o, c),
      c,
      v: v == null ? 0 : Math.max(0, v),
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export const CANDLE_FRAMES = ["1m", "5m", "15m", "1h"];

export function candlesFromCoin(coin, timeframe) {
  const block = coin?.candles;
  if (!block || typeof block !== "object") return [];
  return normalizeCandles(block[timeframe]);
}

export function pickTimeframe(coin, saved) {
  const order = [];
  if (CANDLE_FRAMES.includes(saved)) order.push(saved);
  for (const frame of CANDLE_FRAMES) {
    if (!order.includes(frame)) order.push(frame);
  }
  const hit = order.find((frame) => candlesFromCoin(coin, frame).length >= 1);
  return hit || (CANDLE_FRAMES.includes(saved) ? saved : "1m");
}

export function normalizeTrades(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows.slice(0, 200)) {
    if (!row || typeof row !== "object") continue;
    const side = row.side === "sell" ? "sell" : row.side === "buy" ? "buy" : "";
    const at = Date.parse(row.at);
    const price = num(row.price_usd);
    if (!side || !Number.isFinite(at) || price == null) continue;
    out.push({
      side,
      t: Math.floor(at / 1000),
      price,
      tx: typeof row.tx === "string" ? row.tx : "",
    });
  }
  return out;
}
