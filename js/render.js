import { el } from "./dom.js";
import { isMint, isSig, num, oneOf, str } from "./text.js";
import {
  formatAge,
  formatCompactUsd,
  formatUsd,
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
import { ACCENTS, BACKGROUNDS, CHART_STYLES, FONT_FACES, PARTICLE_STYLES, THEMES, TIMEFRAMES } from "./settings.js";
import { mountCandles, mountMarkedLine, mountSpark } from "./charts.js";
import { coinStatGrid, curvePoints, entryPrice, iconField, iconSources, looksTechnical, marketCapLabel, mergedCoin, plainReason, portfolioUsd, telegramTradeUrl, tokenSupply, tradeLevels } from "./fields.js";
import { safeImageUrl } from "./api.js";
import { candlesFromCoin, normalizeTrades } from "./series.js";
import { countUp, effectsAllowed } from "./effects.js";
import { hostOf } from "./link.js";

const TABS = [
  ["home", "Home", "Portfolio"],
  ["scan", "Coins", "Scanned coins"],
  ["tape", "Activity", "Fills"],
  ["look", "Account", "Customize"],
];
const TITLES = { home: "Home", scan: "Coins", positions: "Open", tape: "Activity", desk: "Home", look: "Customize" };
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

function coinDecision(row) {
  const decision = oneOf(row?.decision, ["bought", "rejected", "watching", "deferred"]);
  const status = oneOf(row?.status, ["bought", "rejected", "watching", "deferred"]);
  if (decision === "deferred" || status === "deferred") return "deferred";
  return decision || (status === "deferred" ? status : decision);
}

function decisionLabel(decision) {
  if (decision === "bought") return "Bought";
  if (decision === "rejected") return "Rejected";
  if (decision === "watching") return "Watching";
  if (decision === "deferred") return "Checking again soon";
  return "Noted";
}

function runLabel(run) {
  if (run === "halted") return "Halted";
  if (run === "paused") return "Paused";
  return "Live";
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
  const run = oneOf(snap?.desk?.run_state, ["live", "paused", "halted"]);
  const mode = oneOf(snap?.desk?.mode, ["live", "paper"]);
  const name = str(snap?.desk?.title, 48) || "Desk";
  top.classList.toggle("is-overlay", Boolean(state.overlay));
  const parts = [];
  if (state.overlay) {
    parts.push(el("button", { type: "button", class: "back haptic", onclick: actions.back, "aria-label": "Back" }, [
      icon("back"),
      "Back",
    ]));
  }
  parts.push(
    el("div", { class: "brand" }, [
      el("span", { class: "brand-mark", text: name.slice(0, 1).toUpperCase() }),
      el("strong", { text: name }),
      mode ? el("span", { class: "pill", text: mode === "live" ? "LIVE" : "PAPER" }) : null,
    ]),
    el("div", { class: "top-side" }, [
      run ? el("span", { class: `live-pill run-${run}`, text: runLabel(run) }) : null,
      el("button", { type: "button", class: "icon-btn haptic", "aria-label": "Refresh", onclick: () => actions.refresh() }, [icon("refresh")]),
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
      "aria-current": (id === "look" ? state.overlay?.type === "look" : !state.overlay && state.tab === id) ? "page" : "false",
      onclick: () => (id === "look" ? actions.openLook() : actions.setTab(id)),
    }, [
      icon(id === "home" ? "home" : id === "scan" ? "coins" : id === "look" ? "look" : "tape"),
      el("span", { text: label }),
    ])),
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
  const decision = coinDecision(row);
  const glow = state.glowIds?.has(str(row.id, 80)) ? "is-new-buy" : "";
  const cls = ["coin-row", "haptic", decision, flashClass(state, mint), glow, extra].filter(Boolean).join(" ");
  const plain = plainReason(row);
  const reason = decision === "deferred" ? (plain && plain !== "Checking again soon" ? plain : "") : plain;
  const body = [
    coinIcon(iconField(row), row.symbol, row.name, state.link.base),
    el("span", { class: "coin-copy" }, [
      el("span", { class: "coin-name", text: str(row.name, 48) || "Unnamed" }),
      el("span", { class: "coin-meta", text: metaLine(row) }),
      el("span", { class: "coin-cap", text: `Mcap ${marketCapLabel(capSource(state, row))}` }),
      reason ? el("span", { class: "coin-reason", text: reason }) : null,
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
  return str(row.symbol, 12);
}

function capSource(state, row) {
  if (num(row?.market_cap_usd) != null || row?.market_cap_pending === true || row?.market_cap_pending === false) return row;
  const lists = [state.snapshot?.scanned, state.snapshot?.positions];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const found = list.find((item) => item?.mint && item.mint === row?.mint && (num(item.market_cap_usd) != null || item.market_cap_pending != null));
    if (found) return found;
  }
  return row;
}

function scanView(state, actions, rise) {
  const rows = sortedScanned(state.snapshot);
  const q = state.query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const decision = coinDecision(row);
    if (state.filter !== "all" && decision !== state.filter) return false;
    if (!q) return true;
    const hay = [row.name, row.symbol, row.mint, plainReason(row)].map((bit) => str(bit, 80).toLowerCase()).join(" ");
    return hay.includes(q);
  });
  const counts = { all: rows.length, bought: 0, rejected: 0, watching: 0, deferred: 0 };
  for (const row of rows) {
    const decision = coinDecision(row);
    if (decision) counts[decision] += 1;
  }
  return el("section", { class: rise ? "rise" : "", "data-view": "scan" }, [
    sampleRibbon(state.snapshot),
    el("div", { class: "filters" }, ["all", "bought", "watching", "deferred", "rejected"].map((id) => {
      const label = id === "all" ? "All" : id === "deferred" ? "Soon" : decisionLabel(id);
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
        el("span", { class: "coin-cap", text: `Mcap ${marketCapLabel(capSource(state, row))}` }),
      ]),
      pnl == null ? null : el("span", { class: pnl < 0 ? "pnl down" : "pnl up", text: [
        pair.primary,
        pair.secondary && pair.secondary !== "—" ? pair.secondary : "",
        num(row.pnl_pct) == null ? "" : formatPct(num(row.pnl_pct)),
      ].filter(Boolean).join(" · ") }),
    ]),
    el("dl", { class: "levels" }, [
      level("Entry", priceText(state, num(row.entry_usd))),
      level("Now", priceText(state, num(row.mark_usd))),
      level("Stop", priceText(state, num(row.stop_usd))),
      level("Target", priceText(state, num(row.take_profit_usd))),
      level("Mcap", marketCapLabel(capSource(state, row)) === "Updating…" ? "Updating…" : marketCapLabel(capSource(state, row))),
    ]),
    isMint(mint) ? tradeControls(state, actions, mint) : null,
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
  const sol = num(snap?.wallet?.sol);
  const eurRate = num(state.solEur);
  const equity = book == null ? null : formatPair(book, usdRate, currency);
  const points = curvePoints(snap).map((point) => ({
    t: point.t,
    v: currency === "SOL" && usdRate ? point.v / usdRate : point.v,
  }));
  const markers = tradeMarkers(state);
  const ranged = filterCurve(points, state.range || "1D");
  const bookCanvas = ranged.length ? el("canvas", { class: "equity book-line", "aria-label": "Portfolio value" }) : null;
  const start = num(snap?.equity?.start_usd);
  const baseline = start == null ? null : (currency === "SOL" && usdRate ? start / usdRate : start);
  const trades = Array.isArray(snap?.activity) ? snap.activity.length : 0;
  const multiple = book != null && start ? book / start : null;
  const todayPct = num(snap?.today?.pnl_pct);
  const walletBits = [];
  if (sol != null) walletBits.push(`${formatSolAmount(sol)} SOL`);
  if (sol != null && eurRate) walletBits.push(formatEur(sol * eurRate));
  const figure = equity ? splitFigure(equity.primary) : null;
  const node = el("section", { class: `home ${rise ? "rise" : ""}` }, [
    sampleRibbon(snap),
    ticker(state, actions),
    figure ? el("p", { class: "hero-book", "data-hero": "book" }, [
      el("span", { class: "whole", text: figure.whole }),
      figure.frac ? el("span", { class: "frac", text: figure.frac }) : null,
    ]) : null,
    el("div", { class: "pills" }, [
      start != null ? el("span", { class: "pill", text: `in ${formatCompactUsd(start)}` }) : null,
      trades ? el("span", { class: "pill", text: `${trades} trades` }) : null,
      multiple != null ? el("span", { class: "pill good", text: `${multiple.toFixed(2)}×` }) : null,
      todayPct != null ? el("span", { class: `pill ${todayPct < 0 ? "bad" : "good"}`, text: `${formatPct(todayPct)} today` }) : null,
      ...walletBits.map((bit) => el("span", { class: "pill", text: bit })),
    ]),
    bookCanvas ? el("div", { class: "chart-block" }, [
      bookCanvas,
      el("div", { class: "ranges" }, ["LIVE", "1H", "4H", "1D", "1W", "ALL"].map((id) => el("button", {
        type: "button",
        class: "chip haptic",
        "aria-pressed": (state.range || "1D") === id ? "true" : "false",
        onclick: () => actions.setRange(id),
      }, [id]))),
    ]) : null,
    positionsCard(state, actions),
    scannerCard(snap),
    recentCard(state, actions),
    decisionsCard(state, actions),
    metricTiles(snap, ranged, currency),
    capBlock(state),
    statusBits(snap) ? el("p", { class: "quiet", text: statusBits(snap) }) : null,
    snap?.generated_at ? el("p", { class: "marked", text: formatVilnius(snap.generated_at) }) : null,
    healthBlock(snap),
  ]);
  queueMicrotask(() => {
    const formatY = (value) => (currency === "SOL" ? formatSolAmount(value) : formatCompactUsd(value));
    const chartStyle = state.settings.chartStyle === "line" || state.settings.chartStyle === "candles" ? state.settings.chartStyle : "area";
    if (bookCanvas?.isConnected) track(mountMarkedLine(bookCanvas, ranged, markers, { formatY, style: chartStyle, baseline }));
    if (anim && state.settings.countUp !== false && effectsAllowed(state.settings)) {
      const whole = node.querySelector("[data-hero='book'] .whole");
      const frac = node.querySelector("[data-hero='book'] .frac");
      if (whole && anim.from.equityUsd != null && anim.to.equityUsd != null) {
        countUp(whole, anim.from.equityUsd, anim.to.equityUsd, (value) => {
          const parts = splitFigure(formatPair(value, usdRate, currency).primary);
          if (frac) frac.textContent = parts.frac;
          return parts.whole;
        });
      }
    }
  });
  return node;
}

function splitFigure(text) {
  const match = String(text).match(/^(.*?)(\.\d+)?$/);
  return { whole: match?.[1] || text, frac: match?.[2] || "" };
}

function filterCurve(points, range) {
  if (!points.length || range === "ALL") return points;
  const end = Date.parse(points[points.length - 1].t);
  const windowMs = { LIVE: 45 * 60 * 1000, "1H": 3600000, "4H": 4 * 3600000, "1D": 86400000, "1W": 7 * 86400000 }[range];
  if (!windowMs || !Number.isFinite(end)) return points;
  const cut = points.filter((point) => Date.parse(point.t) >= end - windowMs);
  return cut.length >= 2 ? cut : points;
}

function ticker(state, actions) {
  const rows = sortedScanned(state.snapshot).slice(0, 12);
  if (!rows.length) return null;
  return el("div", { class: "ticker" }, rows.map((row) => {
    const pos = (state.snapshot?.positions || []).find((item) => item?.mint === row.mint);
    const pct = num(pos?.pnl_pct);
    return el("button", {
      type: "button",
      class: "tick haptic",
      onclick: () => isMint(row.mint) && actions.openCoin(row.mint),
    }, [
      coinIcon(iconField(row), row.symbol, row.name, state.link.base),
      el("b", { text: `$${str(row.symbol, 8)}` }),
      pct == null ? null : el("em", { class: pct < 0 ? "down" : "up", text: formatPct(pct) }),
    ]);
  }));
}

function positionsCard(state, actions) {
  const rows = Array.isArray(state.snapshot?.positions) ? state.snapshot.positions : [];
  return el("section", { class: "panel" }, [
    el("h2", { text: "Open positions" }),
    rows.length ? el("div", {}, rows.map((row) => positionCard(state, row, actions))) : el("p", { class: "quiet", text: "No open positions" }),
  ]);
}

function scannerCard(snap) {
  const rows = sortedScanned(snap);
  if (!rows.length) return null;
  const rejected = rows.filter((row) => coinDecision(row) === "rejected");
  const passed = rows.filter((row) => coinDecision(row) === "bought");
  return el("section", { class: "panel" }, [
    el("h2", { text: "Scanner" }),
    el("div", { class: "metrics" }, [
      el("div", {}, [el("b", { text: String(rows.length) }), el("span", { text: "watched" })]),
      el("div", {}, [el("b", { text: String(passed.length) }), el("span", { text: "passed" })]),
      el("div", {}, [el("b", { text: String(rejected.length) }), el("span", { text: "rejected" })]),
    ]),
    ...rejected.slice(0, 4).map((row) => plainReason(row) ? el("p", { class: "reason", text: `${str(row.symbol, 8)} · ${plainReason(row)}` }) : null),
  ]);
}

function recentCard(state, actions) {
  const rows = sortedScanned(state.snapshot).filter((row) => {
    const decision = coinDecision(row);
    return decision === "bought" || decision === "rejected";
  }).slice(0, 6);
  if (!rows.length) return null;
  return el("section", { class: "panel" }, [
    el("h2", { text: "Recent" }),
    ...rows.map((row) => el("button", {
      type: "button",
      class: "recent haptic",
      onclick: () => isMint(row.mint) && actions.openCoin(row.mint),
    }, [
      coinIcon(iconField(row), row.symbol, row.name, state.link.base),
      el("span", {}, [
        el("b", { text: `$${str(row.symbol, 8)}` }),
        plainReason(row) ? el("small", { text: plainReason(row) }) : null,
      ]),
      el("em", { class: coinDecision(row) === "bought" ? "up" : "down", text: decisionLabel(coinDecision(row)) }),
    ])),
  ]);
}

function decisionsCard(state, actions) {
  const rows = (Array.isArray(state.snapshot?.activity) ? state.snapshot.activity : [])
    .filter((row) => row && oneOf(row.side, ["buy", "sell"]) && row.at)
    .slice()
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .slice(0, 8);
  if (!rows.length) return null;
  return el("section", { class: "panel" }, [
    el("h2", { text: "Decisions" }),
    ...rows.map((row) => {
      const side = oneOf(row.side, ["buy", "sell"]);
      const pnl = num(row.pnl_usd);
      return el("button", {
        type: "button",
        class: "decision haptic",
        onclick: () => isMint(row.mint) && actions.openCoin(row.mint),
      }, [
        el("time", { text: formatVilniusClock(Math.floor(Date.parse(row.at) / 1000)) }),
        el("em", { class: side === "sell" ? "down" : "up", text: side === "sell" ? "SELL" : "BUY" }),
        coinIcon(iconField(row), row.symbol, row.name, state.link.base),
        el("b", { text: `$${str(row.symbol, 8)}` }),
        pnl == null ? null : el("span", { class: pnl < 0 ? "down" : "up", text: formatCompactUsd(pnl) }),
      ]);
    }),
  ]);
}

function metricTiles(snap, points, currency) {
  const tiles = [];
  if (points.length >= 2) {
    const canvas = el("canvas", { class: "spark", "aria-hidden": "true" });
    const last = points[points.length - 1].v;
    tiles.push(el("div", { class: "tile" }, [
      el("span", { text: "Value" }),
      el("b", { text: currency === "SOL" ? `${formatSolAmount(last)} SOL` : formatCompactUsd(last) }),
      canvas,
    ]));
    queueMicrotask(() => {
      if (canvas.isConnected) track(mountSpark(canvas, points.map((point) => point.v)));
    });
  }
  const free = num(snap?.equity?.free_cash_usd);
  if (free != null) {
    tiles.push(el("div", { class: "tile" }, [
      el("span", { text: "Free cash" }),
      el("b", { text: formatCompactUsd(free) }),
    ]));
  }
  return tiles.length ? el("div", { class: "tiles" }, tiles) : null;
}

function tradeMarkers(state) {
  const rows = Array.isArray(state.snapshot?.activity) ? state.snapshot.activity : [];
  return rows.map((row) => {
    const side = oneOf(row?.side, ["buy", "sell"]);
    if (!side || !row?.at) return null;
    const sources = iconSources(iconField(row), state.link?.base || "", safeImageUrl);
    const usd = num(row.usd);
    const pnl = num(row.pnl_usd);
    const money = (value, sign) => (Math.abs(value) >= 1000 ? formatCompactUsd(value) : formatUsd(value, { sign }));
    const label = side === "buy"
      ? (usd == null ? "Buy" : `Buy ${money(usd, false)}`)
      : (pnl == null ? "Sell" : money(pnl, true));
    return { t: row.at, side, src: sources[0] || "", label };
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
  const decision = coinDecision({ ...row, ...coin });
  const tf = state.timeframe || state.settings.timeframe;
  const plain = plainReason({ reason_plain: coin?.reason_plain || row.reason_plain, reason: coin?.reason || row.reason });
  const reason = decision === "deferred" ? (plain && plain !== "Checking again soon" ? plain : "") : plain;
  return el("article", { class: `detail ${rise ? "rise" : ""} ${flashClass(state, mint)}` }, [
    el("header", { class: "hero" }, [
      coinIcon(iconField(coin) || iconField(row), symbol, name, state.link.base, true),
      el("div", {}, [
        el("h2", { text: name }),
        el("p", { class: "coin-meta", text: [symbol, formatAge(coin?.created_at || row.created_at)].filter((bit) => bit && bit !== "—").join(" · ") }),
        el("p", { class: "coin-cap", text: `Mcap ${marketCapLabel(capSource(state, { ...row, ...coin }))}` }),
        decision ? el("p", { class: `stamp ${decision}`, text: decisionLabel(decision) }) : null,
      ]),
    ]),
    quoteButton(state, actions, coin, row, price),
    reason ? el("p", { class: "lede", text: reason }) : null,
    !entry || entry.status === "loading"
      ? skeleton(2)
      : entry.status === "missing"
        ? notice("This coin has no detail file yet.")
        : entry.status === "error"
          ? notice("The coin file could not be read.", () => actions.reloadCoin(mint))
          : detailBody(state, actions, coin, row, tf),
    el("div", { class: "end-spacer", "aria-hidden": "true" }),
  ]);
}

function quoteButton(state, actions, coin, row, price) {
  const mc = state.quote === "mc";
  const figure = mc ? marketCapLabel(capSource(state, mergedCoin(coin, row))) : (price == null ? "Updating…" : priceText(state, price));
  return el("div", { class: "quote" }, [
    el("button", {
      type: "button",
      class: "price haptic",
      onclick: () => actions.setQuote(mc ? "price" : "mc"),
      "aria-label": mc ? "Show price" : "Show market cap",
      text: figure,
    }),
    el("p", { class: "quote-hint" }, [
      el("span", { class: mc ? "" : "on", text: "Price" }),
      " / ",
      el("span", { class: mc ? "on" : "", text: "MC" }),
    ]),
  ]);
}

function detailBody(state, actions, coin, row, tf) {
  const stats = coinStatGrid(coin, row);
  const region = el("div", { class: "chart-region", "data-chart-region": "1" });
  const links = externalLinks(coin.mint);
  queueMicrotask(() => hydrateChart(region, state, coin, tf));
  return el("div", {}, [
    el("div", { class: "tf" }, TIMEFRAMES.map((id) => el("button", {
      type: "button",
      class: "haptic",
      "aria-pressed": tf === id ? "true" : "false",
      onclick: () => actions.setTimeframe(id),
    }, [id]))),
    region,
    block("Stats", el("div", { class: "stats" }, stats.map(([label, value]) => el("div", { class: "stat" }, [
      el("span", { text: label }),
      el("b", { text: value }),
    ])))),
    block("Gates", gateList(coin.gates)),
    tradeList(coin.trades),
    block("Links", el("div", { class: "links" }, links.map((link) => el("a", {
      href: link.href,
      target: "_blank",
      rel: "noopener noreferrer",
      text: link.label,
    })))),
    block("Contract", el("div", { class: "ca" }, [
      el("code", { class: "mint", text: isMint(coin.mint) ? coin.mint : "" }),
      isMint(coin.mint)
        ? el("button", { type: "button", class: "copy haptic", onclick: () => actions.copy(coin.mint), text: "Copy" })
        : null,
    ])),
  ]);
}

function block(title, child) {
  return el("section", { class: "block" }, [
    el("h2", { class: "section-label", text: title }),
    child,
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
    const label = plainBit(gate?.label) || plainBit(gate?.id) || "Gate";
    const detail = plainReason(gate) || plainBit(gate?.detail);
    return el("li", { class: "gate" }, [
      el("strong", { text: label }),
      pass || fail ? el("em", { class: `flag ${pass ? "pass" : "fail"}`, text: pass ? "Pass" : "Fail" }) : null,
      detail ? el("p", { text: detail }) : null,
    ]);
  }));
}

function plainBit(value) {
  const text = str(value, 80);
  if (!text || looksTechnical(text)) return "";
  return text;
}

function tradeList(trades) {
  const rows = normalizeTrades(trades);
  if (!rows.length) return null;
  return block("Our trades", el("ul", { class: "trades" }, rows.map((trade) => el("li", {}, [
      el("span", { class: trade.side, text: trade.side === "sell" ? "Sell" : "Buy" }),
      el("span", { text: formatVilnius(new Date(trade.t * 1000).toISOString()) }),
      el("span", { text: formatPrice(trade.price) }),
    ]))));
}

function hydrateChart(region, state, coin, tf) {
  if (!region.isConnected) return;
  const local = candlesFromCoin(coin, tf);
  if (local.length < 2) {
    region.replaceChildren(el("p", { class: "chart-status", text: "Not enough trades yet" }));
    return;
  }
  const supply = tokenSupply(mergedCoin(coin, rowByMint(state, coin.mint)));
  const mc = state.quote === "mc" && supply != null && supply > 0;
  const scale = mc ? supply : 1;
  const candles = scale === 1 ? local : local.map((candle) => ({
    ...candle,
    o: candle.o * scale,
    h: candle.h * scale,
    l: candle.l * scale,
    c: candle.c * scale,
  }));
  const formatTime = (unix) => formatVilniusClock(unix);
  formatTime.full = (unix) => formatVilnius(new Date(unix * 1000).toISOString());
  const levels = levelsFor(state, coin).map((level) => ({ ...level, price: level.price * scale }));
  paintChart(region, candles, normalizeTrades(coin.trades), {
    formatPrice: (value) => (mc ? formatCompactUsd(value) : priceText(state, value)),
    formatTime,
    timeframe: tf,
    source: mc ? "Desk candles · market cap" : "Desk candles",
    levels,
  });
}

function levelsFor(state, coin) {
  const position = (state.snapshot?.positions || []).find((row) => row?.mint === coin?.mint);
  if (!position) return [];
  return tradeLevels(entryPrice(coin, position), { ...coin, ...position });
}

const BUY_AMOUNTS = [0.02, 0.05, 0.1];
const SELL_PCTS = [25, 50, 100];

function tradeControls(state, actions, mint) {
  const side = state.tradePick?.mint === mint ? state.tradePick.side : "";
  const note = el("p", { class: "trade-note", text: "You confirm the trade in Telegram. This phone holds no keys." });
  if (!isMint(mint)) return el("div", { class: "quick" }, [note]);
  if (side === "buy" || side === "sell") {
    const choices = side === "buy" ? BUY_AMOUNTS : SELL_PCTS;
    return el("div", { class: "quick" }, [
      el("div", { class: "trade-picks" }, choices.map((amount) => el("a", {
        class: "trade-pick haptic",
        href: telegramTradeUrl(side, mint, amount),
        target: "_blank",
        rel: "noopener noreferrer",
        text: side === "buy" ? `${amount} SOL` : `${amount}%`,
      }))),
      el("button", {
        type: "button",
        class: "trade-cancel haptic",
        onclick: () => actions.setTradePick(null, null),
        text: "Cancel",
      }),
      note,
    ]);
  }
  return el("div", { class: "quick" }, [
    el("div", { class: "trade-actions" }, [
      el("button", { type: "button", class: "trade-buy haptic", onclick: () => actions.setTradePick(mint, "buy"), text: "Buy" }),
      el("button", { type: "button", class: "trade-sell haptic", onclick: () => actions.setTradePick(mint, "sell"), text: "Sell" }),
    ]),
    note,
  ]);
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
    group("Palette", el("div", { class: "plates" }, THEMES.map((theme) => {
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
        const input = el("input", { class: "color", type: "color", "aria-label": "Custom accent", value: settings.accent || "#3dff8a" });
        input.addEventListener("input", () => actions.updateSettings({ accent: input.value }));
        return input;
      })(),
    ])),
    group("Background", seg(BACKGROUNDS.map((item) => [item.id, item.name]), settings.background, (id) => actions.updateSettings({ background: id }))),
    group("Particles", el("div", { class: "stack-tight" }, [
      reduced() ? el("p", { class: "quiet", text: "This phone asked for reduced motion, so particles stay paused." }) : null,
      toggle("Particles", settings.particles, (on) => actions.updateSettings({ particles: on })),
      seg(PARTICLE_STYLES.map((style) => [style.id, style.name]), settings.particleStyle, (id) => actions.updateSettings({ particleStyle: id })),
      slider("Density", settings.particleDensity, 0, 100, 1, (value) => actions.updateSettings({ particleDensity: value })),
      slider("Speed", settings.particleSpeed, 0, 100, 1, (value) => actions.updateSettings({ particleSpeed: value })),
    ])),
    group("Effects", el("div", { class: "stack-tight" }, [
      toggle("Effects", settings.effects, (on) => actions.updateSettings({ effects: on })),
      toggle("Chart glow", settings.chartGlow !== false, (on) => actions.updateSettings({ chartGlow: on })),
      toggle("Count up", settings.countUp !== false, (on) => actions.updateSettings({ countUp: on })),
      toggle("Press", settings.haptic !== false, (on) => actions.updateSettings({ haptic: on })),
      toggle("Card shine", settings.shine === true, (on) => actions.updateSettings({ shine: on })),
      toggle("Blur", settings.blur !== false, (on) => actions.updateSettings({ blur: on })),
      slider("Glow", settings.glow, 0, 100, 1, (value) => actions.updateSettings({ glow: value })),
      el("div", { class: "preview", id: "preview-flash" }, [
        el("b", { id: "preview-figure", text: "$792" }),
        el("button", { type: "button", class: "text-btn haptic", onclick: () => actions.preview(), text: "Preview" }),
      ]),
    ])),
    group("Chart", el("div", { class: "stack-tight" }, [
      seg(CHART_STYLES.map((item) => [item.id, item.name]), settings.chartStyle, (id) => actions.updateSettings({ chartStyle: id })),
      slider("Thickness", settings.chartWidth, 1, 4, 1, (value) => actions.updateSettings({ chartWidth: value })),
      seg(TIMEFRAMES.map((id) => [id, id]), settings.timeframe, (id) => actions.updateSettings({ timeframe: id })),
    ])),
    group("Type", el("div", { class: "stack-tight" }, [
      seg(FONT_FACES.map((item) => [item.id, item.name]), settings.fontFace, (id) => actions.updateSettings({ fontFace: id })),
      seg([["sm", "Small"], ["md", "Medium"], ["lg", "Large"]], settings.fontSize || "md", (id) => actions.updateSettings({ fontSize: id })),
    ])),
    group("Layout", seg([["comfy", "Comfy"], ["compact", "Compact"]], settings.density, (id) => actions.updateSettings({ density: id }))),
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

function slider(label, value, min, max, step, onInput) {
  const current = Number.isFinite(Number(value)) ? Number(value) : min;
  const input = el("input", {
    class: "density",
    type: "range",
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(current),
    "aria-label": label,
  });
  input.addEventListener("input", () => onInput(Number(input.value)));
  return el("label", { class: "density-row" }, [
    el("span", { text: label }),
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
  paintTrade(state, actions);
  document.getElementById("shell")?.classList.toggle("has-trade", state.overlay?.type === "coin");
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

function paintTrade(state, actions) {
  const shell = document.getElementById("shell");
  if (!shell) return;
  const existing = document.getElementById("tradebar");
  if (state.overlay?.type !== "coin") {
    existing?.remove();
    return;
  }
  const bar = existing || el("div", { id: "tradebar", class: "tradebar" });
  const dock = document.getElementById("dock");
  if (!existing) shell.insertBefore(bar, dock || null);
  bar.replaceChildren(tradeControls(state, actions, state.overlay.mint));
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
