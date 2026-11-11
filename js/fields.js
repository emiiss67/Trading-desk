import { num, str } from "./text.js";
import { formatAge, formatCompactUsd, formatQty } from "./format.js";
import { candlesFromCoin } from "./series.js";

const ICON_KEYS = ["icon_url", "icon", "image", "image_url", "logo", "logo_uri"];
const TECHNICAL = /(?:source|authorities|extensions|market_cap_source)\s*=/i;

export function looksTechnical(value) {
  return TECHNICAL.test(str(value, 240));
}

export function plainReason(row) {
  const plain = str(row?.reason_plain, 220);
  if (plain && !looksTechnical(plain)) return plain;
  const raw = str(row?.reason, 220);
  if (!raw || looksTechnical(raw)) return "";
  return raw;
}

export function marketCapLabel(row) {
  const cap = num(row?.market_cap_usd);
  if (cap != null) return formatCompactUsd(cap);
  return "Updating…";
}

export function telegramTradeUrl(side, mint, amount) {
  const text = side === "sell" ? `/sell ${mint} ${amount}` : `/buy ${mint} ${amount}`;
  return `https://t.me/Printinggrokbot_bot?text=${encodeURIComponent(text)}`;
}

export function iconField(row) {
  if (!row || typeof row !== "object") return "";
  for (const key of ICON_KEYS) {
    if (typeof row[key] === "string" && row[key].trim()) return row[key].trim();
  }
  return "";
}

export function ipfsCid(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  const scheme = text.match(/^ipfs:\/\/(?:ipfs\/)?([1-9A-HJ-NP-Za-km-z]+)(?:\/.*)?$/);
  if (scheme) return scheme[1];
  const embedded = text.match(/\/ipfs\/([1-9A-HJ-NP-Za-km-z]+)/);
  return embedded ? embedded[1] : "";
}

const GATEWAYS = [
  (cid) => `https://ipfs.io/ipfs/${cid}`,
  (cid) => `https://dweb.link/ipfs/${cid}`,
  (cid) => `https://cloudflare-ipfs.com/ipfs/${cid}`,
  (cid) => `https://cf-ipfs.com/ipfs/${cid}`,
];

export function iconSources(value, base, safeImageUrl) {
  const cid = ipfsCid(value);
  if (cid) return GATEWAYS.map((build) => build(cid));
  const safe = safeImageUrl(value, base);
  return safe ? [safe] : [];
}

export function firstNum(source, keys) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const value = num(source[key]);
    if (value != null) return value;
  }
  return null;
}

export function solEurFrom(snapshot) {
  return firstNum(snapshot?.wallet, ["sol_eur", "eur"]) ?? firstNum(snapshot, ["sol_eur"]);
}

export function portfolioUsd(snapshot) {
  return firstNum(snapshot?.equity, ["usd", "portfolio_usd", "value_usd"])
    ?? firstNum(snapshot?.portfolio, ["usd", "value_usd"]);
}

export function pnlUsd(snapshot) {
  return firstNum(snapshot?.today, ["pnl_usd", "usd"]) ?? firstNum(snapshot?.pnl, ["usd", "today_usd"]);
}

export function curvePoints(snapshot) {
  const rows = snapshot?.equity_curve
    || snapshot?.portfolio_history
    || snapshot?.portfolio?.history
    || [];
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const usd = num(row?.equity_usd ?? row?.value_usd ?? row?.usd ?? row?.portfolio_usd);
    const t = row?.t || row?.at || row?.time;
    if (usd == null || !t) return null;
    return { t, v: usd };
  }).filter(Boolean);
}

export function pnlPoints(snapshot, portfolio) {
  const explicit = snapshot?.pnl_curve || snapshot?.today?.curve;
  if (Array.isArray(explicit) && explicit.length) {
    return explicit.map((row) => {
      const v = num(row?.pnl_usd ?? row?.usd ?? row?.v);
      const t = row?.t || row?.at;
      return v == null || !t ? null : { t, v };
    }).filter(Boolean);
  }
  const start = firstNum(snapshot?.equity, ["start_usd"]) ?? firstNum(snapshot, ["start_usd"]);
  if (start == null) return [];
  return portfolio.map((point) => ({ t: point.t, v: point.v - start }));
}

export function entryPrice(coin, position) {
  const direct = num(position?.entry_usd ?? coin?.entry_usd);
  if (direct != null && direct > 0) return direct;
  const trades = Array.isArray(coin?.trades) ? coin.trades : [];
  const buy = trades.find((trade) => trade?.side === "buy");
  const price = num(buy?.price_usd);
  return price != null && price > 0 ? price : null;
}

const QUOTE_KEY = "desk.quote.v1";
const UPDATING = "Updating…";

export function loadQuote() {
  try {
    return localStorage.getItem(QUOTE_KEY) === "mc" ? "mc" : "price";
  } catch {
    return "price";
  }
}

export function saveQuote(quote) {
  const next = quote === "mc" ? "mc" : "price";
  try {
    localStorage.setItem(QUOTE_KEY, next);
  } catch {
    /* the choice is optional */
  }
  return next;
}

export function mergedCoin(coin, row) {
  const out = { ...(row && typeof row === "object" ? row : {}) };
  if (!coin || typeof coin !== "object") return out;
  for (const [key, value] of Object.entries(coin)) {
    if (value != null && value !== "") out[key] = value;
  }
  return out;
}

export function tokenSupply(source) {
  const direct = firstNum(source, [
    "supply",
    "token_supply",
    "total_supply",
    "circulating_supply",
    "supply_tokens",
    "total_supply_tokens",
  ]);
  if (direct != null && direct > 0) return direct;
  const price = num(source?.price_usd ?? source?.mark_usd);
  const cap = num(source?.market_cap_usd);
  if (price != null && price > 0 && cap != null && cap >= 0) return cap / price;
  return null;
}

function seriesCovering(coin, seconds) {
  for (const tf of ["1m", "5m", "15m", "1h"]) {
    const rows = candlesFromCoin(coin, tf);
    if (rows.length < 2) continue;
    const span = rows[rows.length - 1].t - rows[0].t;
    if (span >= seconds * 0.75) return rows;
  }
  return null;
}

function windowSum(coin, seconds, explicit) {
  const given = firstNum(coin, explicit);
  if (given != null) return given;
  const rows = seriesCovering(coin, seconds);
  if (!rows) return null;
  const end = rows[rows.length - 1].t;
  const start = end - seconds;
  let sum = 0;
  for (const candle of rows) {
    if (candle.t > start && candle.t <= end) sum += candle.v;
  }
  return sum;
}

function windowChange(coin, seconds, explicit) {
  const given = firstNum(coin, explicit);
  if (given != null) return given;
  const rows = seriesCovering(coin, seconds);
  if (!rows) return null;
  const end = rows[rows.length - 1];
  const target = end.t - seconds;
  let base = null;
  for (const candle of rows) {
    if (candle.t <= target) base = candle;
    else break;
  }
  if (!base || !base.c) return null;
  return ((end.c - base.c) / base.c) * 100;
}

function pctLabel(value) {
  if (value == null || !Number.isFinite(value)) return UPDATING;
  const body = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${value < 0 ? "-" : "+"}${body}%`;
}

function usdLabel(value) {
  return value == null ? UPDATING : formatCompactUsd(value);
}

function countLabel(value) {
  return value == null ? UPDATING : formatQty(value);
}

function plainSource(source) {
  const text = str(source?.market_cap_source, 48)
    || str(source?.price_source, 48)
    || str(source?.source, 48);
  if (!text || looksTechnical(text)) return "";
  return text;
}

export function coinStatGrid(coin, row) {
  const source = mergedCoin(coin, row);
  const age = formatAge(source.created_at);
  const top10 = firstNum(source, ["top10_holder_pct", "top_10_holder_pct", "top10_pct"]);
  const top1 = num(source.top_holder_pct);
  const dev = firstNum(source, ["dev_holding_pct", "dev_hold_pct", "dev_pct", "creator_holding_pct"]);
  const curve = firstNum(source, ["bonding_curve_pct", "bonding_curve_progress", "curve_progress", "bonding_progress"]);
  const curvePct = curve == null ? null : Math.abs(curve) <= 1 ? curve * 100 : curve;
  return [
    ["Market cap", marketCapLabel(source)],
    ["Liquidity", usdLabel(num(source.liquidity_usd))],
    ["Volume 5m", usdLabel(windowSum(source, 5 * 60, ["volume_5m_usd", "vol_5m_usd", "volume_5m"]))],
    ["Volume 1h", usdLabel(windowSum(source, 60 * 60, ["volume_1h_usd", "vol_1h_usd", "volume_1h"]))],
    ["Volume 24h", usdLabel(windowSum(source, 24 * 60 * 60, ["volume_24h_usd", "vol_24h_usd", "volume_24h"]))],
    ["Holders", countLabel(num(source.holders))],
    ["Buyers", countLabel(firstNum(source, ["buyers", "buyer_count", "unique_buyers"]))],
    ["Sellers", countLabel(firstNum(source, ["sellers", "seller_count", "unique_sellers"]))],
    ["Buys", countLabel(firstNum(source, ["buys", "buy_count", "buys_24h"]))],
    ["Sells", countLabel(firstNum(source, ["sells", "sell_count", "sells_24h"]))],
    ["Top 10", top10 == null ? UPDATING : pctLabel(top10).replace("+", "")],
    ["Top holder", top1 == null ? UPDATING : pctLabel(top1).replace("+", "")],
    ["Dev holding", dev == null ? UPDATING : pctLabel(dev).replace("+", "")],
    ["Bonding curve", curvePct == null ? UPDATING : pctLabel(curvePct).replace("+", "")],
    ["Age", !age || age === "—" ? UPDATING : age],
    ["FDV", usdLabel(firstNum(source, ["fdv_usd", "fdv"]))],
    ["5m change", pctLabel(windowChange(source, 5 * 60, ["change_5m_pct", "price_change_5m", "pct_5m"]))],
    ["1h change", pctLabel(windowChange(source, 60 * 60, ["change_1h_pct", "price_change_1h", "pct_1h"]))],
    ["24h change", pctLabel(windowChange(source, 24 * 60 * 60, ["change_24h_pct", "price_change_24h", "pct_24h"]))],
    ["Source", plainSource(source) || UPDATING],
  ];
}

export function tradeLevels(entry, raw = {}) {
  if (entry == null) return [];
  const stop = num(raw.stop_usd ?? raw.stop ?? raw.hard_stop_usd) ?? entry * 0.6;
  const target = num(raw.take_profit_usd ?? raw.tp_usd ?? raw.take_profit) ?? entry * 2;
  const trail = num(raw.trailing_usd ?? raw.trailing_stop_usd ?? raw.trail_usd);
  const levels = [
    { id: "entry", label: "Entry", price: entry },
    { id: "stop", label: "Stop", price: stop },
    { id: "tp", label: "Target", price: target },
  ];
  if (trail != null) levels.push({ id: "trail", label: "Trail", price: trail });
  return levels;
}
