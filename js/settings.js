export const THEMES = [
  { id: "midnight", name: "Midnight", swatch: "#14140f", ink: "#f4f1e8", accent: "#d6f56a" },
  { id: "oled", name: "OLED black", swatch: "#000000", ink: "#f7f7f7", accent: "#f2f2f2" },
  { id: "neon", name: "Neon green", swatch: "#04140c", ink: "#e9ffe8", accent: "#39ff88" },
  { id: "haze", name: "Purple haze", swatch: "#140c18", ink: "#f6eefe", accent: "#e2b6ff" },
  { id: "light", name: "Light", swatch: "#f6f3ec", ink: "#1c1a16", accent: "#3d6b12" },
];

export const ACCENTS = ["#d6f56a", "#7ee0c6", "#39ff88", "#8eb6ff", "#e2b6ff", "#ffb086"];
export const PARTICLE_STYLES = [
  { id: "stars", name: "Stars" },
  { id: "embers", name: "Embers" },
  { id: "bubbles", name: "Bubbles" },
  { id: "grid", name: "Grid glow" },
];
export const TIMEFRAMES = ["1m", "5m", "15m", "1h"];
export const CHART_STYLES = [
  { id: "area", name: "Area" },
  { id: "line", name: "Line" },
  { id: "candles", name: "Candles" },
];
export const FONT_SIZES = [
  { id: "sm", name: "Small" },
  { id: "md", name: "Medium" },
  { id: "lg", name: "Large" },
];

const KEY = "desk.settings.v1";

export const DEFAULTS = {
  theme: "midnight",
  accent: null,
  particles: true,
  particleStyle: "stars",
  particleDensity: 48,
  effects: true,
  density: "comfy",
  timeframe: "5m",
  currency: "USD",
  chartStyle: "area",
  fontSize: "md",
};

export function normalizeHex(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^#([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toLowerCase()}` : null;
}

export function hexRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function inkFor(hex) {
  const [r, g, b] = hexRgb(hex);
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return y > 0.62 ? "#1a1c12" : "#f7f8f2";
}

function storage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function sanitizeSettings(raw) {
  const next = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return next;
  if (THEMES.some((theme) => theme.id === raw.theme)) next.theme = raw.theme;
  next.accent = normalizeHex(raw.accent);
  next.particles = raw.particles !== false;
  if (PARTICLE_STYLES.some((style) => style.id === raw.particleStyle)) next.particleStyle = raw.particleStyle;
  next.particleDensity = densityNumber(raw.particleDensity);
  next.effects = raw.effects !== false;
  next.density = raw.density === "compact" ? "compact" : "comfy";
  if (TIMEFRAMES.includes(raw.timeframe)) next.timeframe = raw.timeframe;
  next.currency = raw.currency === "SOL" ? "SOL" : "USD";
  if (raw.chartStyle === "line" || raw.chartStyle === "candles" || raw.chartStyle === "area") next.chartStyle = raw.chartStyle;
  if (raw.fontSize === "sm" || raw.fontSize === "lg" || raw.fontSize === "md") next.fontSize = raw.fontSize;
  return next;
}

export function densityNumber(value) {
  if (value === "low") return 28;
  if (value === "medium") return 55;
  if (value === "high") return 84;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.particleDensity;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function loadSettings() {
  try {
    return sanitizeSettings(JSON.parse(storage()?.getItem(KEY) || "null"));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  const next = sanitizeSettings(settings);
  try {
    storage()?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* appearance is optional */
  }
  return next;
}

export function applySettings(settings) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.density = settings.density;
  root.dataset.effects = settings.effects ? "on" : "off";
  root.dataset.font = settings.fontSize || "md";
  const accent = normalizeHex(settings.accent);
  if (accent) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-ink", inkFor(accent));
    root.style.setProperty("--particle-rgb", hexRgb(accent).join(", "));
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-ink");
    root.style.removeProperty("--particle-rgb");
  }
  root.style.colorScheme = settings.theme === "light" ? "light" : "dark";
  const themeColor = getComputedStyle(root).getPropertyValue("--theme-color").trim();
  document.getElementById("theme-color")?.setAttribute("content", themeColor || "#14140f");
  document.getElementById("apple-status")?.setAttribute(
    "content",
    settings.theme === "light" ? "default" : "black-translucent",
  );
}
