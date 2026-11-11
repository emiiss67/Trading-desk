import { el } from "./dom.js";
import { isMint, isSig, num, oneOf, str } from "./text.js";
import {
  formatAge,
  formatCompactUsd,
  formatPair,
  formatPct,
  formatPrice,
  formatQty,
  formatSolAmount,
  formatVilnius,
  formatVilniusClock,
  formatEur,
} from "./format.js";
import { coinIcon, icon } from "./icons.js";
import { ACCENTS, CHART_STYLES, PARTICLE_STYLES, THEMES, TIMEFRAMES } from "./settings.js";
import { mountCandles, mountMarkedLine } from "./charts.js";
import { curvePoints, entryPrice, iconField, iconSources, pnlPoints, pnlUsd, portfolioUsd, tradeLevels } from "./fields.js";
import { safeImageUrl } from "./api.js";
import { candlesFromCoin, normalizeTrades } from "./series.js";
import { countUp, effectsAllowed } from "./effects.js";
import { hostOf } from "./link.js";

const TABS = [
  ["home", "Home", "Portfolio"],
  ["scan", "Coins", "Scanned coins"],
  ["positions", "Book", "Open positions"],
  ["tape", "Tape", "Fills"],
];
const TITLES = { home: "Book", scan: "Coins", positions: "Open", tape: "Tape", desk: "Book" };
const charts = [];

function destroyCharts() {
  for (const chart of charts) chart.destroy();
  charts.length = 0;
}

function track(chart) {
  if (chart) charts.push(chart);
}

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function solUsd(state) {
  return num(state.snapshot?.wallet?.sol_usd);
}

function rowByMint(state, mint) {
  const pools = [state.snapshot?.scanned, state.snapshot?.positions, state.snapshot?.activity];
  for (const list of pools) {
    if (!Array.isArray(list)) continue;
    const found = list.find((row) => row && row.mint === mint);
    if (found) return found;
  }
  return null;
}

function flashClass(state, mint) {
  const dir = state.flashes?.get(mint);
  return dir === "up" ? "flash-up" : dir === "down" ? "flash-down" : "";
}

function decisionLabel(decision) {
  if (decision === "bought") return "Bought";
  if (decision === "rejected") return "Rejected";
  if (decision === "watching") return "Watching";
  return "Noted";
}

function runLabel(run) {
  if (run === "halted") return "Halted";
  if (run === "paused") return "Paused";
  return "Running";
}

function sortedScanned(snapshot) {
  const rows = Array.isArray(snapshot?.scanned) ? snapshot.scanned : [];
  return rows.filter((row) => row && typeof row === "object").slice().sort((a, b) => {
    return (Date.parse(b.scanned_at) || 0) - (Date.parse(a.scanned_at) || 0);
  });
}

function viewKey(state) {
  if (state.overlay?.type === "coin") return `coin:${state.overlay.mint}`;
  if (state.overlay?.type === "look") return "look";
  return state.tab;
}

function headerTitle(state) {
  if (state.overlay?.type === "look") return "Customize";
  if (state.overlay?.type === "coin") {
    const row = rowByMint(state, state.overlay.mint);
    const cached = state.coinCache.get(state.overlay.mint);
    return str(cached?.coin?.symbol, 12) || str(row?.symbol, 12) || "Coin";
  }
  return TITLES[state.tab] || "Scanned";
}

function shell(actions) {
  return el("div", { id: "shell", class: "shell" }, [
    el("header", { id: "top", class: "top" }),
    el("main", { id: "main" }, [
      el("div", { id: "pull", class: "pull", hidden: true }),
      el("div", { id: "view" }),
    ]),
    el("nav", { id: "dock", class: "dock", "aria-label": "Sections" }),
    el("div", { id: "toast", class: "toast", role: "status" }),
    el("p", { id: "live", class: "sr", "aria-live": "polite" }),
  ]);
}

function paintHeader(state, actions) {
  const top = document.getElementById("top");
  const snap = state.snapshot;
  const run = oneOf(snap?.desk?.run_state, ["live", "paused", "halted"]) || (snap ? "live" : "");
  const mode = oneOf(snap?.desk?.mode, ["live", "paper"]);
  const title = headerTitle(state);
  top.classList.toggle("is-overlay", Boolean(state.overlay));
  const parts = [];
  if (state.overlay) {
    parts.push(el("button", { type: "button", class: "back haptic", onclick: actions.back, "aria-label": "Back" }, [
      icon("back"),
      "Back",
    ]));
  }
  parts.push(
    el("div", { class: "top-id" }, [
      el("p", { class: "kicker", text: "Desk" }),
      el("h1", { class: "title", text: title }),
      snap ? el("p", { class: "desk-name", text: str(snap.desk?.title, 80) || "Private desk" }) : el("p", { class: "desk-name", text: state.loading ? "Loading the file" : "Waiting" }),
    ]),
    el("div", { class: "top-side" }, [
      snap
        ? el("p", { class: `run run-${run || "live"}` }, [
          el("i", { class: state.syncing ? "dot sync" : "dot", "aria-hidden": "true" }),
          el("span", { text: runLabel(run) }),
          el("span", { class: "mode", text: mode === "live" ? "Live account" : "Paper" }),
        ])
        : el("p", { class: "run", text: state.syncing ? "Syncing" : "" }),
      el("button", {
        type: "button",
        class: "icon-btn haptic",
        "aria-label": "Refresh",
        onclick: () => actions.refresh(),
      }, [icon("refresh")]),
      el("button", {
        type: "button",
        class: "icon-btn haptic",
        "aria-label": "Appearance",
        "aria-pressed": state.overlay?.type === "look" ? "true" : "false",
        onclick: () => actions.openLook(),
      }, [icon("look")]),
    ]),
  );
  top.replaceChildren(...parts);
}

function paintDock(state, actions) {
  const dock = document.getElementById("dock");
  dock.replaceChildren(
    ...TABS.map(([id, label, name]) => el("button", {
      type: "button",
      class: "haptic",
      "aria-label": name,
      "aria-current": !state.overlay && state.tab === id ? "page" : "false",
      onclick: () => actions.setTab(id),
    }, [label])),
  );
}

function empty(title, copy) {
  return el("div", { class: "empty" }, [
    el("h2", { text: title }),
    el("p", { text: copy }),
  ]);
}

function skeleton(count = 5) {
  return el("div", { class: "skeletons", "aria-hidden": "true" }, Array.from({ length: count }, () => (
    el("div", { class: "sk-row" }, [
      el("div", { class: "sk sk-icon" }),
      el("div", {}, [
        el("div", { class: "sk sk-line" }),
        el("div", { class: "sk sk-line short" }),
      ]),
    ])
  )));
}

function notice(message, retry) {
  return el("div", { class: "notice" }, [
    el("p", { text: message }),
    retry ? el("button", { type: "button", class: "text-btn haptic", onclick: retry, text: "Try again" }) : null,
  ]);
}

function sampleRibbon(snapshot) {
  if (snapshot?.sample !== true) return null;
  return el("p", { class: "ribbon", text: "Sample data. Not a live desk." });
}

function coinButton(state, row, actions, extra = "") {
  const mint = row.mint;
  const tappable = isMint(mint);
  const decision = oneOf(row.decision, ["bought", "rejected", "watching"]);
  const glow = state.glowIds?.has(str(row.id, 80)) ? "is-new-buy" : "";
  const cls = ["coin-row", "haptic", decision, flashClass(state, mint), glow, extra].filter(Boolean).join(" ");
  const body = [
    coinIcon(iconField(row), row.symbol, row.name, state.link.base),
    el("span", { class: "coin-copy" }, [
      el("span", { class: "coin-name", text: str(row.name, 48) || "Unnamed" }),
      el("span", { class: "coin-meta", text: metaLine(row) }),
      str(row.reason, 160) ? el("span", { class: "coin-reason", text: str(row.reason, 160) }) : null,
    ]),
    el("span", { class: "coin-side" }, [
      decision ? el("span", { class: `stamp ${decision}`, text: decisionLabel(decision) }) : null,
      ageLabel(row.created_at || row.scanned_at || row.at),
    ]),
  ];
  if (!tappable) return el("div", { class: cls }, body);
  return el("button", { type: "button", class: cls, onclick: () => actions.openCoin(mint) }, body);
}

function ageLabel(iso) {
  const age = formatAge(iso);
  if (!age || age === "—") return null;
  return el("span", { class: "age", text: age });
}

function metaLine(row) {
  const symbol = str(row.symbol, 12);
  const cap = num(row.market_cap_usd);
  const bits = [symbol, cap == null ? "" : formatCompactUsd(cap)].filter(Boolean);
  return bits.join(" · ");
}

function scanView(state, actions, rise) {
  const rows = sortedScanned(state.snapshot);
  const q = state.query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const decision = oneOf(row.decision, ["bought", "rejected", "watching"]);
    if (state.filter !== "all" && decision !== state.filter) return false;
    if (!q) return true;
    const hay = [row.name, row.symbol, row.mint, row.reason].map((bit) => str(bit, 80).toLowerCase()).join(" ");
    return hay.includes(q);
  });
  const counts = { all: rows.length, bought: 0, rejected: 0, watching: 0 };
  for (const row of rows) {
    const decision = oneOf(row.decision, ["bought", "rejected", "watching"]);
    if (decision) counts[decision] += 1;
  }
  return el("section", { class: rise ? "rise" : "", "data-view": "scan" }, [
    sampleRibbon(state.snapshot),
    el("div", { class: "filters" }, ["all", "bought", "watching", "rejected"].map((id) => {
      const label = id === "all" ? "All" : decisionLabel(id);
      return el("button", {
        type: "button",
        class: "chip haptic",
        "aria-pressed": state.filter === id ? "true" : "false",
        onclick: () => actions.setFilter(id),
      }, [label, el("span", { class: "count", text: String(counts[id] || 0) })]);
    })),
    el("label", { class: "search-label", for: "q", text: "Filter the scan" }),
    el("input", {
      id: "q",
      class: "search",
      type: "search",
      enterkeyhint: "search",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      placeholder: "Name, symbol, or mint",
      value: state.query,
      oninput: (event) => actions.setQuery(event.target.value),
    }),
    filtered.length
      ? el("div", { class: "list" }, filtered.map((row) => coinButton(state, row, actions)))
      : empty(rows.length ? "Nothing in this filter" : "Nothing scanned yet", rows.length ? "Try another word or decision." : "The desk file has no coins."),
  ]);
}

function positionsView(state, actions, rise) {
  const rows = Array.isArray(state.snapshot?.positions) ? state.snapshot.positions : [];
  return el("section", { class: rise ? "rise" : "" }, [
    sampleRibbon(state.snapshot),
    el("p", { class: "lede", text: "Open coins. Entry, mark, stop, and target come from the desk file." }),
    rows.length ? el("div", { class: "stack" }, rows.map((row) => positionCard(state, row, actions))) : empty("No open positions", "Buys will show up here when the file lists them."),
  ]);
}

function positionCard(state, row, actions) {
  const pnl = num(row.pnl_usd);
  const pair = formatPair(pnl, solUsd(state), state.settings.currency, { sign: true });
  const mint = row.mint;
  return el("article", { class: `book ${flashClass(state, mint)}` }, [
    el("button", { type: "button", class: "book-head haptic", onclick: () => isMint(mint) && actions.openCoin(mint) }, [
      coinIcon(iconField(row), row.symbol, row.name, state.link.base),
      el("span", {}, [
        el("span", { class: "coin-name", text: str(row.name, 48) || "Unnamed" }),
        el("span", { class: "coin-meta", text: [str(row.symbol, 12), num(row.qty_tokens) == null ? "" : `${formatQty(num(row.qty_tokens))} tokens`].filter(Boolean).join(" · ") }),
      ]),
      pnl == null ? null : el("span", { class: pnl < 0 ? "pnl down" : "pnl up" }, [
        el("b", { text: pair.primary }),
        pair.secondary && pair.secondary !== "—" ? el("small", { text: pair.secondary }) : null,
        num(row.pnl_pct) == null ? null : el("small", { text: formatPct(num(row.pnl_pct)) }),
      ]),
    ]),
    el("dl", { class: "levels" }, [
      level("Entry", priceText(state, num(row.entry_usd))),
      level("Now", priceText(state, num(row.mark_usd))),
      level("Stop", priceText(state, num(row.stop_usd))),
      level("Target", priceText(state, num(row.take_profit_usd))),
    ]),
  ]);
}

function level(label, value) {
  if (!value || value === "—") return null;
  return el("div", {}, [
    el("dt", { text: label }),
    el("dd", { text: value }),
  ]);
}

function priceText(state, usd) {
  if (usd == null) return "—";
  if (state.settings.currency === "SOL") {
    const sol = solUsd(state);
    if (!sol) return "—";
    return `${formatSolAmount(usd / sol)} SOL`;
  }
  return formatPrice(usd);
}

function tapeView(state, actions, rise) {
  const rows = (Array.isArray(state.snapshot?.activity) ? state.snapshot.activity : [])
    .filter((row) => row && typeof row === "object")
    .slice()
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  return el("section", { class: rise ? "rise" : "" }, [
    sampleRibbon(state.snapshot),
    el("p", { class: "lede", text: "Fills · Europe/Vilnius" }),
    rows.length ? el("div", { class: "list" }, rows.map((row) => fillRow(state, row, actions))) : empty("No fills yet", "Buys and sells from the desk file will land here."),
  ]);
}

function fillRow(state, row, actions) {
  const side = oneOf(row.side, ["buy", "sell"]);
  const pnl = num(row.pnl_usd);
  const pair = formatPair(pnl, solUsd(state), state.settings.currency, { sign: true });
  const tx = isSig(row.tx) ? `https://solscan.io/tx/${row.tx}` : "";
  const id = str(row.id, 80);
  return el("article", { class: `fill ${side} ${state.glowIds?.has(id) ? "is-new-buy" : ""}` }, [
    el("button", { type: "button", class: "fill-main haptic", onclick: () => isMint(row.mint) && actions.openCoin(row.mint) }, [
      coinIcon(iconField(row), row.symbol, row.name, state.link.base),
      el("span", {}, [
        el("span", { class: "coin-name", text: `${side === "sell" ? "Sold" : "Bought"} ${str(row.name, 40) || str(row.symbol, 12) || "coin"}` }),
        el("span", { class: "coin-meta", text: formatVilnius(row.at) }),
      ]),
      el("span", { class: "coin-side" }, [
        side === "sell" && pnl != null
          ? el("b", { class: pnl < 0 ? "down" : "up", text: pair.primary })
          : el("b", { text: row.sol != null && num(row.sol) != null ? `${formatSolAmount(num(row.sol))} SOL` : priceText(state, num(row.usd)) }),
        side === "sell" ? el("small", { text: formatPct(num(row.pnl_pct)) }) : el("small", { text: priceText(state, num(row.price_usd)) }),
      ]),
    ]),
    tx ? el("a", { class: "tx", href: tx, target: "_blank", rel: "noopener noreferrer", text: "Solscan transaction" }) : null,
  ]);
}

function homeView(state, actions, rise) {
  const snap = state.snapshot;
  const anim = takePulseAnim(state);
  const currency = state.settings.currency;
  const usdRate = solUsd(state);
  const book = portfolioUsd(snap);
  const pnl = pnlUsd(snap);
  const sol = num(snap?.wallet?.sol);
  const eurRate = num(state.solEur);
  const equity = book == null ? null : formatPair(book, usdRate, currency);
  const pnlPair = pnl == null ? null : formatPair(pnl, usdRate, currency, { sign: true });
  const points = curvePoints(snap).map((point) => ({
    t: point.t,
    v: currency === "SOL" && usdRate ? point.v / usdRate : point.v,
  }));
  const profit = pnlPoints(snap, curvePoints(snap)).map((point) => ({
    t: point.t,
    v: currency === "SOL" && usdRate ? point.v / usdRate : point.v,
  }));
  const markers = tradeMarkers(state);
  const bookCanvas = points.length ? el("canvas", { class: "equity book-line", "aria-label": "Portfolio value" }) : null;
  const pnlCanvas = profit.length ? el("canvas", { class: "equity pnl-line", "aria-label": "Profit and loss" }) : null;
  const walletBits = [];
  if (sol != null) walletBits.push(el("span", {}, [`${formatSolAmount(sol)} SOL`]));
  if (sol != null && eurRate) walletBits.push(el("span", {}, [formatEur(sol * eurRate)]));
  const node = el("section", { class: `home ${rise ? "rise" : ""}` }, [
    sampleRibbon(snap),
    pnlPair ? el("p", { class: `hero-pnl ${pnl < 0 ? "down" : "up"}${anim ? " pnl-glow" : ""}`, "data-hero": "pnl", text: pnlPair.primary }) : null,
    equity ? el("p", { class: "hero-book", "data-hero": "book" }, [
      el("span", { text: equity.primary }),
      el("small", { text: "Portfolio" }),
    ]) : null,
    walletBits.length ? el("p", { class: "wallet-line" }, walletBits) : null,
    pnlCanvas ? el("div", { class: "chart-block" }, [
      el("div", { class: "chart-head" }, [el("h2", { text: "P&L" })]),
      pnlCanvas,
    ]) : null,
    bookCanvas ? el("div", { class: "chart-block" }, [
      el("div", { class: "chart-head" }, [el("h2", { text: "Portfolio" })]),
      bookCanvas,
    ]) : null,
    capBlock(state),
    statusBits(snap) ? el("p", { class: "quiet", text: statusBits(snap) }) : null,
    snap?.generated_at ? el("p", { class: "marked", text: `Marked ${formatVilnius(snap.generated_at)}` }) : null,
    state.stale ? el("p", { class: "quiet", text: "Showing the last file. The refresh did not land." }) : null,
    healthBlock(snap),
  ]);
  queueMicrotask(() => {
    const formatY = (value) => (currency === "SOL" ? formatSolAmount(value) : formatCompactUsd(value));
    const chartStyle = state.settings.chartStyle === "line" || state.settings.chartStyle === "candles" ? state.settings.chartStyle : "area";
    if (bookCanvas?.isConnected) track(mountMarkedLine(bookCanvas, points, markers, { formatY, style: chartStyle }));
    if (pnlCanvas?.isConnected) track(mountMarkedLine(pnlCanvas, profit, [], { formatY, style: chartStyle }));
    if (anim && effectsAllowed(state.settings)) {
      const pn = node.querySelector('[data-hero="pnl"]');
      const bk = node.querySelector('[data-hero="book"] span');
      if (pn && anim.from.pnlUsd != null && anim.to.pnlUsd != null) {
        countUp(pn, anim.from.pnlUsd, anim.to.pnlUsd, (value) => formatPair(value, usdRate, currency, { sign: true }).primary);
      }
      if (bk && anim.from.equityUsd != null && anim.to.equityUsd != null) {
        countUp(bk, anim.from.equityUsd, anim.to.equityUsd, (value) => formatPair(value, usdRate, currency).primary);
      }
    }
  });
  return node;
}

function tradeMarkers(state) {
  const rows = Array.isArray(state.snapshot?.activity) ? state.snapshot.activity : [];
  return rows.map((row) => {
    const side = oneOf(row?.side, ["buy", "sell"]);
    if (!side || !row?.at) return null;
    const sources = iconSources(iconField(row), state.link?.base || "", safeImageUrl);
    return { t: row.at, side, src: sources[0] || "" };
  }).filter(Boolean);
}

function deskView(state, actions, rise) {
  return homeView(state, actions, rise);
}

function takePulseAnim(state) {
  if (!state.metrics) return null;
  if (!state.pulseShown) {
    state.pulseShown = state.metrics;
    state.pendingAnim = null;
    return null;
  }
  const anim = effectsAllowed(state.settings) ? state.pendingAnim : null;
  state.pendingAnim = null;
  state.pulseShown = state.metrics;
  return anim;
}

function unitSecondary(text, currency) {
  if (!text || text === "—") return "";
  if (text.includes("$") || text.includes("SOL")) return text;
  return currency === "SOL" ? text : `${text} SOL`;
}

function figure(text, tone = "") {
  if (!text || text === "—") {
    return el("b", { class: `is-missing ${tone}`.trim() }, [el("span", { class: "na", text: "n/a" })]);
  }
  return el("b", { class: tone, text });
}

function meter(primary, label, secondary, id, pnl) {
  const tone = pnl == null ? "" : pnl < 0 ? "down" : "up";
  return el("div", { class: "meter", "data-meter": id }, [
    figure(primary, tone),
    el("span", { text: label }),
    secondary && secondary !== "—" ? el("small", { text: secondary }) : null,
  ]);
}

function statusBits(snap) {
  const bits = [];
  const mode = oneOf(snap?.desk?.mode, ["live", "paper"]);
  if (mode) bits.push(mode === "live" ? "Live account" : "Paper");
  const run = oneOf(snap?.desk?.run_state, ["live", "paused", "halted"]);
  if (run) bits.push(runLabel(run));
  const health = oneOf(snap?.health?.status, ["ok", "degraded", "down"]);
  if (health === "ok") bits.push("Bots healthy");
  if (health === "degraded") bits.push("Bots degraded");
  if (health === "down") bits.push("Bots down");
  const compound = num(snap?.desk?.compounder_pct);
  if (compound != null) bits.push(`Compounder ${compound}%`);
  return bits.join(" · ");
}

function capBlock(state) {
  const today = state.snapshot?.today || {};
  const cap = num(today.cap_usd);
  const used = num(today.cap_used_usd);
  if (cap == null && used == null) return null;
  let status = oneOf(today.cap_status, ["ok", "warning", "hit"]);
  if (!status && cap && used != null) status = used >= cap ? "hit" : used / cap >= 0.8 ? "warning" : "ok";
  const label = status === "hit" ? "Daily cap hit" : status === "warning" ? "Close to the daily cap" : "Within the daily cap";
  const ratio = cap && used != null ? Math.max(0, Math.min(1, used / cap)) : 0;
  const usedText = formatPair(used, solUsd(state), state.settings.currency).primary;
  const capText = formatPair(cap, solUsd(state), state.settings.currency).primary;
  const fill = el("i");
  fill.style.width = `${Math.round(ratio * 100)}%`;
  return el("div", { class: `cap cap-${status || "ok"}` }, [
    el("p", {}, [el("span", { text: label }), el("span", { text: `${usedText} / ${capText}` })]),
    el("div", { class: "cap-track", "aria-hidden": "true" }, [fill]),
  ]);
}

function equityPoints(snap, currency, usdRate) {
  const rows = Array.isArray(snap?.equity_curve) ? snap.equity_curve : [];
  return rows.map((row) => {
    const usd = num(row?.equity_usd);
    if (usd == null) return null;
    const v = currency === "SOL" && usdRate ? usd / usdRate : usd;
    return { t: row.t, v };
  }).filter(Boolean);
}

function healthBlock(snap) {
  const bots = Array.isArray(snap?.health?.bots) ? snap.health.bots : [];
  if (!bots.length && !str(snap?.health?.summary, 180)) return null;
  return el("section", { class: "health" }, [
    el("h2", { class: "section-label", text: "Health" }),
    str(snap?.health?.summary, 180) ? el("p", { text: str(snap.health.summary, 180) }) : null,
    bots.length
      ? el("ul", {}, bots.map((bot) => {
        const status = oneOf(bot?.status, ["ok", "degraded", "down"]);
        return el("li", {}, [
          el("div", { class: "bot-top" }, [
            el("strong", { text: str(bot?.name, 40) || "Bot" }),
            el("em", { class: `flag ${status || "unknown"}`, text: status === "ok" ? "Responding" : status === "degraded" ? "Degraded" : status === "down" ? "Down" : "Unknown" }),
          ]),
          str(bot?.detail, 180) ? el("p", { text: str(bot.detail, 180) }) : null,
          el("time", { text: formatVilnius(bot?.last_seen) }),
        ]);
      }))
      : el("p", { class: "quiet", text: "No bot roster in this file." }),
  ]);
}

function coinView(state, actions, rise) {
  const mint = state.overlay.mint;
  const entry = state.coinCache.get(mint);
  const row = rowByMint(state, mint) || {};
  const coin = entry?.status === "ready" ? entry.coin : null;
  const name = str(coin?.name, 60) || str(row.name, 60) || "Coin";
  const symbol = str(coin?.symbol, 12) || str(row.symbol, 12);
  const price = num(coin?.price_usd) ?? num(row.mark_usd) ?? num(row.price_usd);
  const decision = oneOf(row.decision, ["bought", "rejected", "watching"]);
  const tf = state.timeframe || state.settings.timeframe;
  return el("article", { class: `detail ${rise ? "rise" : ""} ${flashClass(state, mint)}` }, [
    el("header", { class: "hero" }, [
      coinIcon(iconField(coin) || iconField(row), symbol, name, state.link.base, true),
      el("div", {}, [
        el("h2", { text: name }),
        el("p", { class: "coin-meta", text: [symbol, formatAge(coin?.created_at || row.created_at)].filter((bit) => bit && bit !== "—").join(" · ") }),
        decision ? el("p", { class: `stamp ${decision}`, text: decisionLabel(decision) }) : null,
      ]),
    ]),
    price == null
      ? el("p", { class: "price is-missing" }, [el("span", { class: "na", text: "n/a" })])
      : el("p", { class: "price", text: priceText(state, price) }),
    str(row.reason, 180) ? el("p", { class: "lede", text: str(row.reason, 180) }) : null,
    !entry || entry.status === "loading"
      ? skeleton(2)
      : entry.status === "missing"
        ? notice("This coin has no detail file yet.")
        : entry.status === "error"
          ? notice("The coin file could not be read.", () => actions.reloadCoin(mint))
          : detailBody(state, actions, coin, tf),
  ]);
}

function detailBody(state, actions, coin, tf) {
  const stats = [];
  const mcap = num(coin.market_cap_usd);
  const liq = num(coin.liquidity_usd);
  const holders = num(coin.holders);
  const top = num(coin.top_holder_pct);
  if (mcap != null) stats.push(["Market cap", formatCompactUsd(mcap)]);
  if (liq != null) stats.push(["Liquidity", formatCompactUsd(liq)]);
  if (holders != null) stats.push(["Holders", formatQty(holders)]);
  if (top != null) stats.push(["Top holder", `${top.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`]);
  const region = el("div", { class: "chart-region", "data-chart-region": "1" });
  const links = externalLinks(coin.mint);
  queueMicrotask(() => hydrateChart(region, state, actions, coin, tf));
  return el("div", {}, [
    el("div", { class: "tf" }, TIMEFRAMES.map((id) => el("button", {
      type: "button",
      class: "haptic",
      "aria-pressed": tf === id ? "true" : "false",
      onclick: () => actions.setTimeframe(id),
    }, [id]))),
    region,
    stats.length
      ? el("div", { class: "stats" }, stats.map(([label, value]) => el("div", { class: "stat" }, [
        el("span", { text: label }),
        el("b", { text: value }),
      ])))
      : null,
    el("h2", { class: "section-label", text: "Gates" }),
    gateList(coin.gates),
    tradeList(coin.trades),
    el("h2", { class: "section-label", text: "Links" }),
    el("div", { class: "links" }, links.map((link) => el("a", {
      href: link.href,
      target: "_blank",
      rel: "noopener noreferrer",
      text: link.label,
    }))),
    el("h2", { class: "section-label", text: "Contract" }),
    el("div", { class: "ca" }, [
      el("code", { class: "mint", text: isMint(coin.mint) ? coin.mint : "—" }),
      isMint(coin.mint)
        ? el("button", { type: "button", class: "copy haptic", onclick: () => actions.copy(coin.mint), text: "Copy" })
        : null,
    ]),
  ]);
}

function externalLinks(mint) {
  if (!isMint(mint)) return [];
  return [
    { label: "pump.fun", href: `https://pump.fun/coin/${mint}` },
    { label: "Solscan", href: `https://solscan.io/token/${mint}` },
    { label: "DexScreener", href: `https://dexscreener.com/solana/${mint}` },
  ];
}

function gateList(gates) {
  const rows = Array.isArray(gates) ? gates : [];
  if (!rows.length) return el("p", { class: "quiet", text: "No gate results in this file." });
  return el("ul", { class: "gates" }, rows.slice(0, 24).map((gate) => {
    const pass = gate?.pass === true;
    const fail = gate?.pass === false;
    return el("li", { class: "gate" }, [
      el("strong", { text: str(gate?.label, 40) || str(gate?.id, 40) || "Gate" }),
      el("em", { class: `flag ${pass ? "pass" : fail ? "fail" : "unknown"}`, text: pass ? "Pass" : fail ? "Fail" : "—" }),
      str(gate?.detail, 200) ? el("p", { text: str(gate.detail, 200) }) : null,
    ]);
  }));
}

function tradeList(trades) {
  const rows = normalizeTrades(trades);
  if (!rows.length) return null;
  return el("div", {}, [
    el("h2", { class: "section-label", text: "Our trades" }),
    el("ul", { class: "trades" }, rows.map((trade) => el("li", {}, [
      el("span", { class: trade.side, text: trade.side === "sell" ? "Sell" : "Buy" }),
      el("span", { text: formatVilnius(new Date(trade.t * 1000).toISOString()) }),
      el("span", { text: formatPrice(trade.price) }),
    ]))),
  ]);
}

function hydrateChart(region, state, actions, coin, tf) {
  if (!region.isConnected) return;
  const local = candlesFromCoin(coin, tf);
  const formatPriceFn = (value) => priceText(state, value);
  const formatTime = (unix) => formatVilniusClock(unix);
  formatTime.full = (unix) => formatVilnius(new Date(unix * 1000).toISOString());
    const levels = levelsFor(state, coin);
    if (local.length) {
      paintChart(region, local, normalizeTrades(coin.trades), {
        formatPrice: formatPriceFn,
        formatTime,
        timeframe: tf,
        source: "Candles from the desk file",
        levels,
      });
      return;
    }
  region.replaceChildren(el("p", { class: "chart-status", text: "Loading the public chart…" }));
  actions.getCandles(coin.mint, tf, coin).then((result) => {
    if (!region.isConnected) return;
    if (result.candles?.length) {
      paintChart(region, result.candles, normalizeTrades(coin.trades), {
        formatPrice: formatPriceFn,
        formatTime,
        timeframe: tf,
        source: "Public chart via GeckoTerminal",
        levels: levelsFor(state, coin),
      });
      const last = result.candles[result.candles.length - 1];
      region.append(el("p", { class: "quiet", text: `Last public print ${formatPriceFn(last.c)}` }));
      return;
    }
    const copy = result.error === "rate"
      ? "GeckoTerminal is busy. The rest of this coin is fine."
      : result.error === "missing"
        ? "No public pool was found for this mint."
        : "The public chart did not load.";
    region.replaceChildren(notice(copy, () => {
      actions.clearCandles(coin.mint, tf);
      hydrateChart(region, state, actions, coin, tf);
    }));
  }).catch(() => {
    if (!region.isConnected) return;
    region.replaceChildren(notice("The public chart did not load.", () => {
      actions.clearCandles(coin.mint, tf);
      hydrateChart(region, state, actions, coin, tf);
    }));
  });
}

function levelsFor(state, coin) {
  const position = (state.snapshot?.positions || []).find((row) => row?.mint === coin?.mint) || {};
  return tradeLevels(entryPrice(coin, position), { ...coin, ...position });
}

function paintChart(region, candles, trades, opts) {
  const canvas = el("canvas", { class: "candles", "aria-label": "Candlestick chart" });
  const tip = el("div", { class: "tip", hidden: true });
  region.replaceChildren(
    el("p", { class: "source", text: opts.source }),
    el("div", { class: "chart-wrap" }, [canvas, tip]),
    el("p", { class: "legend" }, [
      el("span", { class: "buy", text: "Buy" }),
      el("span", { class: "sell", text: "Sell" }),
      ...(opts.levels || []).map((level) => el("span", { text: level.label })),
      el("span", { text: "Drag to pan · pinch to zoom" }),
    ]),
  );
  track(mountCandles(canvas, candles, trades, opts));
}

function lookView(state, actions, rise) {
  const settings = state.settings;
  const host = state.link ? hostOf(state.link.base) : "";
  const tail = state.link?.key ? state.link.key.slice(-4) : "";
  return el("section", { class: `look ${rise ? "rise" : ""}` }, [
    el("p", { class: "lede", text: "Appearance stays on this phone. It never changes the bot, the mode, or the risk limits." }),
    group("Theme", el("div", { class: "plates" }, THEMES.map((theme) => {
      const button = el("button", {
        type: "button",
        class: "plate haptic",
        "aria-pressed": settings.theme === theme.id && !settings.accent ? "true" : settings.theme === theme.id ? "true" : "false",
        onclick: () => actions.updateSettings({ theme: theme.id }),
      }, [
        el("strong", { text: theme.name }),
        el("span", { text: "Aa" }),
      ]);
      button.style.background = theme.swatch;
      button.style.color = theme.ink;
      button.style.boxShadow = settings.theme === theme.id ? `inset 0 0 0 2px ${theme.accent}` : "";
      return button;
    }))),
    group("Accent", el("div", { class: "swatches" }, [
      el("button", {
        type: "button",
        class: "swatch text haptic",
        "aria-pressed": settings.accent ? "false" : "true",
        onclick: () => actions.updateSettings({ accent: null }),
        text: "Theme",
      }),
      ...ACCENTS.map((hex) => {
        const button = el("button", {
          type: "button",
          class: "swatch haptic",
          "aria-label": hex,
          "aria-pressed": settings.accent === hex ? "true" : "false",
          onclick: () => actions.updateSettings({ accent: hex }),
        });
        button.style.background = hex;
        return button;
      }),
      (() => {
        const input = el("input", { class: "color", type: "color", "aria-label": "Custom accent", value: settings.accent || "#d6f56a" });
        input.addEventListener("input", () => actions.updateSettings({ accent: input.value }));
        return input;
      })(),
    ])),
    group("Particles", el("div", { class: "stack-tight" }, [
      reduced() ? el("p", { class: "quiet", text: "This phone asked for reduced motion, so particles stay paused." }) : null,
      toggle("Particles", settings.particles, (on) => actions.updateSettings({ particles: on })),
      seg(PARTICLE_STYLES.map((style) => [style.id, style.name]), settings.particleStyle, (id) => actions.updateSettings({ particleStyle: id })),
      densitySlider(settings, actions),
    ])),
    group("Motion", el("div", { class: "stack-tight" }, [
      toggle("Effects", settings.effects, (on) => actions.updateSettings({ effects: on })),
      el("div", { class: "preview", id: "preview-flash" }, [
        el("b", { id: "preview-figure", text: "$792" }),
        el("button", { type: "button", class: "text-btn haptic", onclick: () => actions.preview(), text: "Preview" }),
      ]),
    ])),
    group("Layout", seg([["comfy", "Comfy"], ["compact", "Compact"]], settings.density, (id) => actions.updateSettings({ density: id }))),
    group("Type size", seg([["sm", "Small"], ["md", "Medium"], ["lg", "Large"]], settings.fontSize || "md", (id) => actions.updateSettings({ fontSize: id }))),
    group("Default chart", seg(TIMEFRAMES.map((id) => [id, id]), settings.timeframe, (id) => actions.updateSettings({ timeframe: id }))),
    group("Chart style", seg(CHART_STYLES.map((item) => [item.id, item.name]), settings.chartStyle, (id) => actions.updateSettings({ chartStyle: id }))),
    group("Numbers", seg([["USD", "USD"], ["SOL", "SOL"]], settings.currency, (id) => actions.updateSettings({ currency: id }))),
    group("This device", el("div", {}, [
      el("p", { class: "quiet", text: host ? `Saved link · ${host}` : "No link saved." }),
      tail ? el("p", { class: "quiet", text: `Access id ends in ${tail}` }) : null,
      el("p", { class: "quiet", text: "In Safari, while this page shows the private link, use Share > Add to Home Screen." }),
      el("button", {
        type: "button",
        class: "danger haptic",
        onclick: () => actions.armForget(),
        text: state.forgetArmed ? "Tap again to forget this device" : "Forget this device",
      }),
      el("button", {
        type: "button",
        class: "text-btn haptic",
        onclick: () => actions.resetLook(),
        text: "Reset appearance",
      }),
    ])),
  ]);
}

function densitySlider(settings, actions) {
  const value = Number.isFinite(Number(settings.particleDensity)) ? Number(settings.particleDensity) : 48;
  const input = el("input", {
    class: "density",
    type: "range",
    min: "0",
    max: "100",
    value: String(value),
    "aria-label": "Particle density",
  });
  input.addEventListener("input", () => actions.updateSettings({ particleDensity: Number(input.value) }));
  return el("label", { class: "density-row" }, [
    el("span", { text: "Density" }),
    input,
  ]);
}

function group(title, child) {
  return el("section", { class: "group" }, [
    el("h2", { text: title }),
    child,
  ]);
}

function seg(options, current, onPick) {
  return el("div", { class: "seg", role: "group" }, options.map(([id, label]) => el("button", {
    type: "button",
    class: "haptic",
    "aria-pressed": current === id ? "true" : "false",
    onclick: () => onPick(id),
  }, [label])));
}

function toggle(label, on, set) {
  return el("div", { class: "toggle-row" }, [
    el("span", { text: label }),
    el("button", {
      type: "button",
      class: "switch haptic",
      role: "switch",
      "aria-checked": on ? "true" : "false",
      "aria-label": label,
      onclick: () => set(!on),
    }, [el("i")]),
  ]);
}

function mainView(state, actions) {
  const rise = viewKey(state) !== state.lastView;
  state.lastView = viewKey(state);
  if (!state.snapshot && state.loading) return skeleton(6);
  if (!state.snapshot && state.error) return notice(state.error, () => actions.refresh());
  if (state.overlay?.type === "look") return lookView(state, actions, rise);
  if (state.overlay?.type === "coin") return coinView(state, actions, rise);
  if (state.tab === "positions") return positionsView(state, actions, rise);
  if (state.tab === "tape") {
    const node = tapeView(state, actions, rise);
    state.glowIds = new Set();
    return node;
  }
  if (state.tab === "home" || state.tab === "desk") return homeView(state, actions, rise);
  const node = scanView(state, actions, rise);
  state.flashes = new Map();
  return node;
}

export function paintApp(root, state, actions, opts = {}) {
  destroyCharts();
  if (!state.link) {
    root.replaceChildren(lockScreen(state, actions));
    return;
  }
  if (!document.getElementById("shell")) root.replaceChildren(shell(actions));
  paintHeader(state, actions);
  paintDock(state, actions);
  const main = document.getElementById("main");
  const view = document.getElementById("view");
  const typing = opts.keepFocus && document.activeElement?.id === "q";
  const y = opts.keepScroll ? main.scrollTop : 0;
  view.replaceChildren(mainView(state, actions));
  if (state.announce) {
    const live = document.getElementById("live");
    if (live) live.textContent = state.announce;
    state.announce = "";
  }
  if (typing) {
    const input = document.getElementById("q");
    if (input) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }
  if (opts.keepScroll) main.scrollTop = y;
  else main.scrollTop = 0;
  if (state.tab === "positions" || state.overlay?.type === "coin") state.flashes = new Map();
}

function lockScreen(state, actions) {
  return el("section", { class: "lock" }, [
    el("p", { class: "kicker", text: "Private" }),
    el("h1", { text: "Desk" }),
    el("p", { text: "This phone is locked. Open the private link in Safari first, then Share > Add to Home Screen." }),
    el("form", {
      class: "unlock",
      onsubmit: (event) => {
        event.preventDefault();
        actions.unlock(event.currentTarget.elements.link.value);
      },
    }, [
      el("label", { for: "private-link", text: "Private link" }),
      el("input", {
        id: "private-link",
        name: "link",
        class: "unlock-input",
        type: "text",
        inputmode: "url",
        autocomplete: "off",
        autocapitalize: "off",
        autocorrect: "off",
        spellcheck: "false",
        enterkeyhint: "go",
        placeholder: "https://…/#d=…&k=…",
        value: state.unlockDraft || "",
      }),
      el("button", { type: "submit", class: "unlock-btn haptic", text: "Unlock" }),
    ]),
    state.unlockError ? el("p", { class: "lock-bad", role: "alert", text: state.unlockError }) : null,
    state.invalidHash && !state.unlockError ? el("p", { class: "lock-bad", text: "This link isn’t valid. Ask for a new one in Telegram." }) : null,
  ]);
}
