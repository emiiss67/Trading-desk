import { str } from "./text.js";

const STORAGE_KEY = "desk.link.v1";

export function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function decodeBase64Url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]{8,4096}$/.test(text)) throw new Error("b64");
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/") + pad);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function allowed(url) {
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function parseLinkHash(hash) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return { ok: false, reason: "empty" };
  let params;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { ok: false, reason: "hash" };
  }
  const encoded = params.get("d");
  const key = params.get("k");
  if (!encoded || !key) return { ok: false, reason: "missing" };
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) return { ok: false, reason: "key" };
  let decoded;
  try {
    decoded = decodeBase64Url(encoded);
  } catch {
    return { ok: false, reason: "b64" };
  }
  let url;
  try {
    url = new URL(decoded.trim());
  } catch {
    return { ok: false, reason: "url" };
  }
  if (!allowed(url)) return { ok: false, reason: "protocol" };
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  const base = url.origin + path;
  return { ok: true, base, key };
}

function bucket() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function linkHash(link) {
  return `#d=${encodeBase64Url(link.base)}&k=${link.key}`;
}

export function addressWithLink(pathname, search, link) {
  return `${pathname || "/"}${search || ""}${linkHash(link)}`;
}

export function saveLink(link) {
  // The home-screen app has its own storage, separate from Safari.
  // Saving here is what makes the second standalone launch work if iOS opens without the hash.
  bucket()?.setItem(STORAGE_KEY, JSON.stringify({ base: link.base, key: link.key }));
}

export function loadLink() {
  const store = bucket();
  if (!store) return null;
  try {
    const data = JSON.parse(store.getItem(STORAGE_KEY) || "null");
    if (!data || typeof data.base !== "string" || typeof data.key !== "string") return null;
    const parsed = parseLinkHash(`#d=${encodeBase64Url(data.base)}&k=${data.key}`);
    return parsed.ok ? parsed : null;
  } catch {
    return null;
  }
}

export function forgetLink() {
  try {
    bucket()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore quota and private-mode failures */
  }
}

export function hostOf(base) {
  try {
    return new URL(base).host;
  } catch {
    return str(base, 40);
  }
}
