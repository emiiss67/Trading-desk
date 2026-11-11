export const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;

export function isMint(value) {
  return typeof value === "string" && MINT_RE.test(value);
}

export function isSig(value) {
  return typeof value === "string" && SIG_RE.test(value);
}

export function str(value, max = 180) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

export function num(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function oneOf(value, allowed) {
  const token = str(value, 24).toLowerCase();
  return allowed.includes(token) ? token : "";
}
