import { isMint } from "./text.js";

export class DataError extends Error {
  constructor(code) {
    super(code);
    this.name = "DataError";
    this.code = code;
  }
}

function withTimeout(ms, parent) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), ms);
  if (parent) {
    if (parent.aborted) ctrl.abort(parent.reason);
    else parent.addEventListener("abort", () => ctrl.abort(parent.reason), { once: true });
  }
  return {
    signal: ctrl.signal,
    done() {
      clearTimeout(timer);
    },
  };
}

async function readLimited(res, max) {
  const header = Number(res.headers.get("content-length"));
  if (Number.isFinite(header) && header > max) throw new DataError("size");
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    if (text.length > max) throw new DataError("size");
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      try { await reader.cancel(); } catch { /* already closed */ }
      throw new DataError("size");
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

export function under(base, rel) {
  const root = base.endsWith("/") ? base : `${base}/`;
  const url = new URL(rel, root);
  if (url.username || url.password || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new DataError("bad");
  }
  if (!url.href.startsWith(root)) throw new DataError("bad");
  return url.href;
}

async function getJson(url, parentSignal, max) {
  const timed = withTimeout(12000, parentSignal);
  try {
    let res;
    try {
      res = await fetch(url, {
        signal: timed.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        if (parentSignal?.aborted) throw err;
        throw new DataError("network");
      }
      throw new DataError("network");
    }
    if (res.status === 404) throw new DataError("missing");
    if (!res.ok) throw new DataError("http");
    const text = (await readLimited(res, max)).trim();
    if (!text || text.startsWith("<")) throw new DataError("bad");
    try {
      return JSON.parse(text);
    } catch {
      throw new DataError("bad");
    }
  } finally {
    timed.done();
  }
}

function objectData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new DataError("bad");
  return data;
}

export function fetchSnapshot(base, signal) {
  return getJson(under(base, "snapshot.json"), signal, 3_000_000).then(objectData);
}

export function fetchCoin(base, mint, signal) {
  if (!isMint(mint)) throw new DataError("bad");
  return getJson(under(base, `coins/${mint}.json`), signal, 3_000_000).then(objectData);
}

export function safeImageUrl(value, base) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return "";
  // A leading slash is the data base, not the site root. Tunnel icons are /icons/<mint>.png.
  const relative = value.startsWith("/") && !value.startsWith("//") ? value.slice(1) : value;
  try {
    const root = base.endsWith("/") ? base : `${base}/`;
    const url = new URL(relative, root);
    if (url.username || url.password) return "";
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.href;
  } catch {
    return "";
  }
}
