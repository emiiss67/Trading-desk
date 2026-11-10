const TZ = "Europe/Vilnius";

export function formatUsd(value, { sign = false, digits = 2 } = {}) {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const prefix = value < 0 ? "-" : sign && value > 0 ? "+" : "";
  return `${prefix}$${abs}`;
}

export function formatCompactUsd(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}b`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}m`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return formatUsd(value, { digits: abs >= 100 ? 0 : 2 });
}

export function formatPrice(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs === 0) return "$0";
  if (abs >= 1000) return formatUsd(value, { digits: 2 });
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(4)}`;
  const digits = Math.min(8, Math.max(4, Math.ceil(-Math.log10(abs)) + 2));
  const body = abs.toFixed(digits).replace(/\.?0+$/, "");
  return `${sign}$${body}`;
}

export function formatSolAmount(value, { sign = false } = {}) {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  const body = abs.toLocaleString("en-US", { maximumFractionDigits: digits });
  const prefix = value < 0 ? "-" : sign && value > 0 ? "+" : "";
  return prefix + body;
}

export function formatPct(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const body = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const prefix = value < 0 ? "-" : "+";
  return `${prefix}${body}%`;
}

export function formatQty(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}b`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}m`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}k`;
  return `${sign}${Math.round(abs)}`;
}

export function formatAge(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return `${Math.floor(s)}s old`;
  if (s < 3600) return `${Math.floor(s / 60)}m old`;
  if (s < 86400) return `${Math.floor(s / 3600)}h old`;
  return `${Math.floor(s / 86400)}d old`;
}

export function formatPair(usd, solUsd, currency, { sign = false, preferSol = false } = {}) {
  const usdOk = usd != null && Number.isFinite(usd);
  const solOk = usdOk && solUsd != null && Number.isFinite(solUsd) && solUsd > 0;
  const usdText = usdOk ? formatUsd(usd, { sign }) : "—";
  const solText = solOk ? formatSolAmount(usd / solUsd, { sign }) : "—";
  if (preferSol || currency === "SOL") return { primary: solText, secondary: usdOk ? usdText : "" };
  return { primary: usdText, secondary: solOk ? solText : "" };
}

export function formatVilnius(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")} Europe/Vilnius`;
}

export function formatVilniusClock(unixSeconds) {
  const full = formatVilnius(new Date(unixSeconds * 1000));
  const match = full.match(/(\d{2}:\d{2}):\d{2}/);
  return match ? match[1] : full;
}
