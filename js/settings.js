export const THEMES = [
  { id: "matrix", name: "Matrix", swatch: "#07140c", ink: "#d7ffe4", accent: "#3dff8a" },
  { id: "neon", name: "Neon", swatch: "#140818", ink: "#f3e9ff", accent: "#c084fc" },
  { id: "ocean", name: "Ocean", swatch: "#071018", ink: "#e7f6ff", accent: "#38bdf8" },
  { id: "sunset", name: "Sunset", swatch: "#1a0d08", ink: "#ffe8d6", accent: "#fb923c" },
  { id: "gold", name: "Gold", swatch: "#161208", ink: "#fff4d2", accent: "#f5c451" },
  { id: "blood", name: "Blood", swatch: "#160808", ink: "#ffe4e4", accent: "#f43f5e" },
  { id: "ice", name: "Ice", swatch: "#0c1218", ink: "#eef6ff", accent: "#7dd3fc" },
  { id: "mono", name: "Mono", swatch: "#101010", ink: "#f4f4f5", accent: "#e4e4e7" },
  { id: "candy", name: "Candy", swatch: "#180814", ink: "#ffe4f3", accent: "#f472b6" },
];

export const ACCENTS = ["#3dff8a", "#c084fc", "#38bdf8", "#fb923c", "#f5c451", "#f43f5e", "#7dd3fc", "#f472b6"];
export const BACKGROUNDS = [
  { id: "solid", name: "Solid" },
  { id: "gradient", name: "Gradient" },
  { id: "aurora", name: "Aurora" },
  { id: "grid", name: "Grid" },
  { id: "noise", name: "Noise" },
];
export const FONT_FACES = [
  { id: "system", name: "System" },
  { id: "mono", name: "Mono" },
];
export const PARTICLE_STYLES = [
  { id: "stars", name: "Stars" },
  { id: "embers", name: "Embers" },
  { id: "bubbles", name: "Bubbles" },
  { id: "snow", name: "Snow" },
  { id: "matrix", name: "Matrix rain" },
  { id: "grid", name: "Glow grid" },
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
  theme: "matrix",
  accent: null,
  background: "solid",
  particles: false,
  particleStyle: "stars",
  particleDensity: 22,
  particleSpeed: 50,
  effects: true,
  glow: 36,
  chartGlow: true,
  countUp: true,
  haptic: true,
  shine: false,
  blur: true,
  density: "comfy",
  timeframe: "5m",
  currency: "USD",
  chartStyle: "area",
  chartWidth: 2,
  fontSize: "md",
  fontFace: "system",
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
  if (BACKGROUNDS.some((item) => item.id === raw.background)) next.background = raw.background;
  next.particles = raw.particles === true;
  if (PARTICLE_STYLES.some((style) => style.id === raw.particleStyle)) next.particleStyle = raw.particleStyle;
  next.particleDensity = densityNumber(raw.particleDensity);
  next.particleSpeed = clampNumber(raw.particleSpeed, 0, 100, DEFAULTS.particleSpeed);
  next.effects = raw.effects !== false;
  next.glow = clampNumber(raw.glow, 0, 100, DEFAULTS.glow);
  next.chartGlow = raw.chartGlow !== false;
  next.countUp = raw.countUp !== false;
  next.haptic = raw.haptic !== false;
  next.shine = raw.shine === true;
  next.blur = raw.blur !== false;
  next.density = raw.density === "compact" ? "compact" : "comfy";
  if (TIMEFRAMES.includes(raw.timeframe)) next.timeframe = raw.timeframe;
  next.currency = raw.currency === "SOL" ? "SOL" : "USD";
  if (raw.chartStyle === "line" || raw.chartStyle === "candles" || raw.chartStyle === "area") next.chartStyle = raw.chartStyle;
  next.chartWidth = clampNumber(raw.chartWidth, 1, 4, DEFAULTS.chartWidth);
  if (raw.fontSize === "sm" || raw.fontSize === "lg" || raw.fontSize === "md") next.fontSize = raw.fontSize;
  if (FONT_FACES.some((item) => item.id === raw.fontFace)) next.fontFace = raw.fontFace;
  return next;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
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
  root.dataset.bg = settings.background || "solid";
  root.dataset.density = settings.density;
  root.dataset.effects = settings.effects ? "on" : "off";
  root.dataset.font = settings.fontSize || "md";
  root.dataset.face = settings.fontFace || "system";
  root.dataset.blur = settings.blur === false ? "off" : "on";
  root.dataset.shine = settings.shine ? "on" : "off";
  root.dataset.haptic = settings.haptic === false ? "off" : "on";
  root.style.setProperty("--glow", `${Math.round(((settings.glow ?? 36) / 100) * 28)}px`);
  root.style.setProperty("--chart-width", String(settings.chartWidth || 2));
  root.style.setProperty("--chart-glow", settings.chartGlow === false ? "0" : String(6 + Math.round((settings.glow ?? 36) / 8)));
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
  const light = isLightTheme(settings);
  root.style.colorScheme = light ? "light" : "dark";
  const themeColor = getComputedStyle(root).getPropertyValue("--theme-color").trim();
  document.getElementById("theme-color")?.setAttribute("content", themeColor || (light ? "#f2f2f7" : "#000000"));
  document.getElementById("apple-status")?.setAttribute(
    "content",
    light ? "default" : "black-translucent",
  );
}

export function isLightTheme() {
  return false;
}
