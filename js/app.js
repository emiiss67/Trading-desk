import { applySettings, DEFAULTS, loadSettings, saveSettings } from "./settings.js";
import { forgetLink, linkHash, loadLink, parseLinkHash, parsePrivateLink, saveLink } from "./link.js";
import { fetchCoin, fetchSnapshot } from "./api.js";
import { isMint, num, str } from "./text.js";
import { loadQuote, pnlUsd, portfolioUsd, saveQuote, solEurFrom } from "./fields.js";
import { formatUsd } from "./format.js";
import { paintApp } from "./render.js";
import { burst, countUp, effectsAllowed, toast } from "./effects.js";
import { startParticles } from "./particles.js";

const state = {
  link: null,
  invalidHash: false,
  snapshot: null,
  error: "",
  loading: false,
  syncing: false,
  stale: false,
  tab: "home",
  solEur: null,
  overlay: null,
  filter: "all",
  query: "",
  settings: loadSettings(),
  metrics: null,
  pulseShown: null,
  pendingAnim: null,
  prices: null,
  flashes: new Map(),
  fillIds: null,
  glowIds: new Set(),
  coinCache: new Map(),
  tradePick: null,
  quote: loadQuote(),
  fetchedAt: 0,
  lastView: "",
  timeframe: loadSettings().timeframe,
  range: "1D",
  forgetArmed: false,
  forgetTimer: 0,
  announce: "",
  unlockError: "",
  unlockDraft: "",
};

const particles = startParticles(document.getElementById("particles"));
let generation = 0;
let controller = null;

const actions = {
  setTab,
  openCoin,
  setFilter,
  setQuery,
  refresh,
  setTimeframe,
  setRange,
  updateSettings,
  openLook,
  back,
  copy: copyMint,
  unlock: unlockFromText,
  preview,
  armForget,
  resetLook,
  reloadCoin: (mint) => {
    state.coinCache.delete(mint);
    loadCoin(mint);
    render({ keepScroll: true });
  },
  setTradePick,
  setQuote,
};

function particleState() {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return {
    on: Boolean(state.link) && state.settings.particles && !motion && !document.hidden,
    style: state.settings.particleStyle,
    density: state.settings.particleDensity,
    speed: state.settings.particleSpeed,
  };
}

function render(opts) {
  applySettings(state.settings);
  particles.sync(particleState());
  paintApp(document.getElementById("app"), state, actions, opts || {});
  bindPull();
}

function sameUrl() {
  return `${location.pathname}${location.search}${location.hash}`;
}

function pinPrivateHash() {
  // Keep #d=&k= in the address bar. iOS Add to Home Screen saves that URL, not Safari's localStorage.
  const hash = state.link ? linkHash(state.link) : location.hash;
  history.replaceState(hist(), "", `${location.pathname}${location.search}${hash}`);
}

function hist() {
  return { tab: state.tab, overlay: state.overlay };
}

function setQuote(quote) {
  state.quote = saveQuote(quote);
  render({ keepScroll: true });
}

function setTradePick(mint, side) {
  const main = document.getElementById("main");
  const nearEnd = main ? main.scrollHeight - main.scrollTop - main.clientHeight < 64 : false;
  state.tradePick = mint && side ? { mint, side } : null;
  render({ keepScroll: true });
  if (nearEnd && main) main.scrollTop = main.scrollHeight;
}

function setTab(tab) {
  const leaving = state.overlay != null;
  state.tab = tab;
  state.overlay = null;
  state.tradePick = null;
  history[leaving ? "pushState" : "replaceState"](hist(), "", sameUrl());
  render();
}

function openCoin(mint) {
  if (!isMint(mint)) return;
  state.overlay = { type: "coin", mint };
  state.tradePick = null;
  history.pushState(hist(), "", sameUrl());
  if (!state.coinCache.has(mint)) state.coinCache.set(mint, { status: "loading" });
  render();
  loadCoin(mint);
}

function openLook() {
  if (state.overlay?.type === "look") {
    history.back();
    return;
  }
  state.overlay = { type: "look" };
  history.pushState(hist(), "", sameUrl());
  render();
}

function back() {
  if (history.state) history.back();
  else {
    state.overlay = null;
    render();
  }
}

function setFilter(filter) {
  state.filter = filter;
  render();
}

function setQuery(query) {
  state.query = query.slice(0, 80);
  render({ keepScroll: true, keepFocus: true });
}

function setRange(range) {
  state.range = range;
  render({ keepScroll: true });
}

function setTimeframe(tf) {
  state.timeframe = tf;
  render({ keepScroll: true });
}

function updateSettings(patch) {
  const prev = state.settings.currency;
  state.settings = saveSettings({ ...state.settings, ...patch });
  if (patch.timeframe) state.timeframe = patch.timeframe;
  if (patch.currency && patch.currency !== prev) {
    state.pendingAnim = null;
    state.pulseShown = state.metrics;
  }
  render({ keepScroll: true });
}

function resetLook() {
  state.settings = saveSettings({ ...DEFAULTS });
  state.timeframe = DEFAULTS.timeframe;
  render({ keepScroll: true });
}

function metricsFrom(snapshot) {
  return {
    equityUsd: portfolioUsd(snapshot),
    pnlUsd: pnlUsd(snapshot),
    walletSol: num(snapshot?.wallet?.sol),
  };
}

function changed(a, b) {
  if (!a || !b) return false;
  return a.equityUsd !== b.equityUsd || a.pnlUsd !== b.pnlUsd || a.walletSol !== b.walletSol;
}

function adopt(snapshot) {
  const nextPrices = new Map();
  const rows = [];
  if (Array.isArray(snapshot.scanned)) rows.push(...snapshot.scanned.map((row) => [row?.mint, num(row?.price_usd)]));
  if (Array.isArray(snapshot.positions)) rows.push(...snapshot.positions.map((row) => [row?.mint, num(row?.mark_usd)]));
  for (const [mint, price] of rows) {
    if (!isMint(mint) || price == null) continue;
    if (state.prices?.has(mint)) {
      const prev = state.prices.get(mint);
      if (price > prev) state.flashes.set(mint, "up");
      else if (price < prev) state.flashes.set(mint, "down");
    }
    nextPrices.set(mint, price);
  }
  state.prices = nextPrices;

  const ids = new Set();
  const activity = Array.isArray(snapshot.activity) ? snapshot.activity : [];
  let celebrate = false;
  for (const fill of activity) {
    const id = str(fill?.id, 80);
    if (!id) continue;
    ids.add(id);
    if (state.fillIds && !state.fillIds.has(id)) {
      if (fill.side === "buy") state.glowIds.add(id);
      if (fill.side === "sell" && num(fill.pnl_usd) > 0) celebrate = true;
    }
  }
  const first = state.fillIds == null;
  state.fillIds = ids;
  if (!first && celebrate && effectsAllowed(state.settings)) burst();

  const next = metricsFrom(snapshot);
  state.pendingAnim = state.pulseShown && changed(state.pulseShown, next) ? { from: { ...state.pulseShown }, to: next } : null;
  state.metrics = next;
  state.snapshot = snapshot;
  state.stale = false;
  state.error = "";
  const quoted = solEurFrom(snapshot);
  if (quoted != null && quoted > 0) state.solEur = quoted;
  else ensureSolEur();
}

const EUR_KEY = "desk.sol_eur.v1";

async function ensureSolEur() {
  if (state.solEur) return;
  try {
    const cached = JSON.parse(localStorage.getItem(EUR_KEY) || "null");
    if (cached && Number.isFinite(cached.eur) && Date.now() - cached.at < 5 * 60 * 1000) {
      state.solEur = cached.eur;
      return;
    }
  } catch { /* ignore */ }
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=eur", {
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) return;
    const data = await res.json();
    const eur = num(data?.solana?.eur);
    if (eur == null || eur <= 0) return;
    state.solEur = eur;
    try { localStorage.setItem(EUR_KEY, JSON.stringify({ eur, at: Date.now() })); } catch { /* ignore */ }
    if (state.tab === "home" || state.tab === "desk") render({ keepScroll: true });
  } catch { /* price is optional */ }
}

function errorText(err) {
  if (err?.code === "missing") return "The desk file was not found.";
  if (err?.code === "size") return "The desk file is too large to read.";
  if (err?.code === "bad") return "The desk file could not be read.";
  return "The desk could not be reached.";
}

async function refresh() {
  if (!state.link) return;
  const token = ++generation;
  controller?.abort();
  controller = new AbortController();
  const base = state.link.base;
  const had = Boolean(state.snapshot);
  state.syncing = true;
  if (!had) {
    state.loading = true;
    state.error = "";
  }
  render(had ? { keepScroll: true, keepFocus: true } : {});
  try {
    const snapshot = await fetchSnapshot(base, controller.signal);
    if (token !== generation || state.link?.base !== base) return;
    adopt(snapshot);
    state.loading = false;
    state.syncing = false;
    state.fetchedAt = Date.now();
    state.announce = "Desk updated";
    if (state.overlay?.type === "coin") loadCoin(state.overlay.mint);
    render({ keepScroll: true, keepFocus: true });
  } catch (err) {
    if (token !== generation || err?.name === "AbortError") return;
    state.loading = false;
    state.syncing = false;
    state.fetchedAt = Date.now();
    if (!state.snapshot) state.error = errorText(err);
    else {
      state.stale = true;
      toast("Couldn't refresh");
    }
    render({ keepScroll: true, keepFocus: true });
  }
}

async function loadCoin(mint) {
  if (!state.link || !isMint(mint)) return;
  const base = state.link.base;
  try {
    const coin = await fetchCoin(base, mint, controller?.signal);
    if (state.link?.base !== base) return;
    state.coinCache.set(mint, { status: "ready", coin });
  } catch (err) {
    if (err?.name === "AbortError") return;
    const prev = state.coinCache.get(mint);
    if (err?.code === "missing") state.coinCache.set(mint, { status: "missing" });
    else if (prev?.status === "ready") toast("Couldn't refresh this coin");
    else state.coinCache.set(mint, { status: "error" });
  }
  if (state.overlay?.type === "coin" && state.overlay.mint === mint) render({ keepScroll: true });
}

function preview() {
  if (!effectsAllowed(state.settings)) {
    toast(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "Motion is reduced on this phone" : "Effects are off");
    return;
  }
  const node = document.getElementById("preview-figure");
  const flash = document.getElementById("preview-flash");
  if (node) countUp(node, 640, 792, (value) => formatUsd(value, { digits: 0 }));
  if (flash) {
    flash.classList.remove("flash-up");
    void flash.offsetWidth;
    flash.classList.add("flash-up");
  }
  burst();
}

async function copyMint(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Could not copy");
  }
}

function armForget() {
  if (!state.forgetArmed) {
    state.forgetArmed = true;
    render({ keepScroll: true });
    clearTimeout(state.forgetTimer);
    state.forgetTimer = setTimeout(() => {
      state.forgetArmed = false;
      if (state.overlay?.type === "look") render({ keepScroll: true });
    }, 3200);
    return;
  }
  forget();
}

function forget() {
  clearTimeout(state.forgetTimer);
  forgetLink();
  generation += 1;
  controller?.abort();
  state.link = null;
  state.invalidHash = false;
  state.snapshot = null;
  state.overlay = null;
  state.coinCache.clear();
  state.tradePick = null;
  state.prices = null;
  state.fillIds = null;
  state.glowIds = new Set();
  state.flashes = new Map();
  state.metrics = null;
  state.pulseShown = null;
  state.pendingAnim = null;
  state.forgetArmed = false;
  state.unlockError = "";
  state.unlockDraft = "";
  if (window.caches) caches.delete("desk-json-v1").catch(() => {});
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  render();
}

function bindPull() {
  const main = document.getElementById("main");
  if (!main || main.dataset.bound) return;
  main.dataset.bound = "1";
  let startY = 0;
  let active = false;
  let dy = 0;
  const pull = () => document.getElementById("pull");
  main.addEventListener("touchstart", (event) => {
    if (main.scrollTop > 2) return;
    startY = event.touches[0].clientY;
    active = true;
    dy = 0;
  }, { passive: true });
  main.addEventListener("touchmove", (event) => {
    if (!active) return;
    dy = event.touches[0].clientY - startY;
    const node = pull();
    if (!node || dy < 10 || main.scrollTop > 2) return;
    node.hidden = false;
    node.style.height = `${Math.min(56, dy * 0.42)}px`;
    node.classList.toggle("is-armed", dy > 78);
    node.textContent = dy > 78 ? "Release" : "Pull";
  }, { passive: true });
  const end = () => {
    const node = pull();
    if (node) {
      node.hidden = true;
      node.style.height = "0px";
      node.textContent = "";
      node.classList.remove("is-armed");
    }
    if (active && dy > 78) refresh();
    active = false;
    dy = 0;
  };
  main.addEventListener("touchend", end);
  main.addEventListener("touchcancel", end);
}

function unlockFromText(raw) {
  const parsed = parsePrivateLink(raw);
  if (!parsed.ok) {
    state.unlockDraft = typeof raw === "string" ? raw : "";
    state.unlockError = "That link isn’t valid. Paste the full private link, or the #d=…&k=… part.";
    render();
    return;
  }
  state.unlockError = "";
  state.unlockDraft = "";
  state.invalidHash = false;
  saveLink(parsed);
  state.link = parsed;
  pinPrivateHash();
  refresh();
}

function applyLocation() {
  const hash = location.hash;
  if (hash && hash.length > 1) {
    const parsed = parseLinkHash(hash);
    if (!parsed.ok) {
      state.link = null;
      state.invalidHash = true;
      state.snapshot = null;
      return false;
    }
    const changed = state.link?.base !== parsed.base;
    state.invalidHash = false;
    // First standalone launch has the hash and empty storage. Persist it there.
    saveLink(parsed);
    state.link = parsed;
    return changed || !state.snapshot;
  }
  state.invalidHash = false;
  const stored = loadLink();
  const changed = state.link?.base !== stored?.base;
  state.link = stored;
  return Boolean(stored) && (changed || !state.snapshot);
}

function onPop(event) {
  const next = event.state;
  state.tab = next?.tab || "scan";
  state.overlay = next?.overlay || null;
  render();
  if (state.overlay?.type === "coin") loadCoin(state.overlay.mint);
}

function boot() {
  state.timeframe = state.settings.timeframe;
  const shouldLoad = applyLocation();
  pinPrivateHash();
  window.addEventListener("popstate", onPop);
  window.addEventListener("hashchange", () => {
    const shouldLoad = applyLocation();
    pinPrivateHash();
    if (shouldLoad) refresh();
    else render();
  });
  document.addEventListener("visibilitychange", () => {
    particles.sync(particleState());
    if (!document.hidden && state.link && Date.now() - state.fetchedAt > 14000) refresh();
  });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => {
    particles.sync(particleState());
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    applySettings(state.settings);
    render({ keepScroll: true });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".haptic")) return;
    if (!state.settings.effects || !navigator.vibrate) return;
    try { navigator.vibrate(8); } catch { /* unsupported */ }
  });
  setInterval(() => {
    if (document.hidden || !state.link) return;
    if (Date.now() - state.fetchedAt < 14000) return;
    refresh();
  }, 15000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  render();
  if (shouldLoad && state.link) refresh();
}

boot();
