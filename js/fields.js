import { num, str } from "./text.js";
import { formatCompactUsd } from "./format.js";

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
