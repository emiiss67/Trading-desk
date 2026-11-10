import { isMint } from "./text.js";
import { normalizeCandles } from "./series.js";

const ROOT = "https://api.geckoterminal.com/api/v2";
const ACCEPT = "application/json;version=20230203";

const FRAMES = {
  "1m": { frame: "minute", aggregate: 1, sec: 60 },
  "5m": { frame: "minute", aggregate: 5, sec: 300 },
  "15m": { frame: "minute", aggregate: 15, sec: 900 },
  "1h": { frame: "hour", aggregate: 1, sec: 3600 },
};

export function timeframeSeconds(tf) {
  return FRAMES[tf]?.sec ?? 300;
}

export class ChartError extends Error {
  constructor(code) {
    super(code);
    this.name = "ChartError";
    this.code = code;
  }
}

export function pickPool(payload) {
  const list = payload?.data;
  if (!Array.isArray(list)) return "";
  let best = "";
  let reserve = -1;
  for (const item of list) {
    const address = item?.attributes?.address;
    if (!isMint(address)) continue;
    const score = Number(item.attributes.reserve_in_usd);
    const value = Number.isFinite(score) ? score : 0;
    if (value > reserve) {
      reserve = value;
      best = address;
    }
  }
  return best;
}

export function parseOhlcv(payload) {
  const list = payload?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) throw new ChartError("bad");
  const rows = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, o, h, l, c, v] = row;
    rows.push({ t, o, h, l, c, v });
  }
  return normalizeCandles(rows);
}

async function geckoGet(url, signal) {
  let res;
  try {
    res = await fetch(url, {
      signal,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { Accept: ACCEPT },
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ChartError("network");
  }
  if (res.status === 429) throw new ChartError("rate");
  if (!res.ok) throw new ChartError("network");
  try {
    return await res.json();
  } catch {
    throw new ChartError("bad");
  }
}

export async function fetchOhlcv({ mint, timeframe, pool, signal }) {
  const spec = FRAMES[timeframe];
  if (!spec || !isMint(mint)) throw new ChartError("bad");
  let address = isMint(pool) ? pool : "";
  if (!address) {
    const pools = await geckoGet(`${ROOT}/networks/solana/tokens/${mint}/pools?page=1`, signal);
    address = pickPool(pools);
    if (!address) throw new ChartError("missing");
  }
  const query = new URLSearchParams({
    aggregate: String(spec.aggregate),
    limit: "180",
    currency: "usd",
    token: mint,
  });
  const payload = await geckoGet(
    `${ROOT}/networks/solana/pools/${address}/ohlcv/${spec.frame}?${query}`,
    signal,
  );
  const candles = parseOhlcv(payload);
  if (!candles.length) throw new ChartError("missing");
  return candles;
}
