import { clampWindow } from "./series.js";
import { timeframeSeconds } from "./gecko.js";

function fit(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 0;
  const h = canvas.clientHeight || 0;
  const bw = Math.max(1, Math.floor(w * dpr));
  const bh = Math.max(1, Math.floor(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function palette() {
  const css = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    ink: pick("--ink", "#f4f1e8"),
    muted: pick("--faint", "#756f64"),
    line: pick("--line", "rgba(244,241,232,0.12)"),
    accent: pick("--accent", "#d6f56a"),
    bad: pick("--bad", "#ff8f78"),
  };
}

function triangle(ctx, x, y, dir, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (dir === "up") {
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x + 5, y + 3);
    ctx.lineTo(x - 5, y + 3);
  } else {
    ctx.moveTo(x, y + 5);
    ctx.lineTo(x + 5, y - 3);
    ctx.lineTo(x - 5, y - 3);
  }
  ctx.closePath();
  ctx.fill();
}

export function mountEquity(canvas, points, formatY) {
  let frame = 0;
  const draw = () => {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    if (w < 20 || h < 20 || !points.length) return;
    const col = palette();
    const pad = { l: 8, r: 58, t: 16, b: 18 };
    const values = points.map((point) => point.v).filter((value) => Number.isFinite(value));
    if (!values.length) return;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      min -= Math.abs(min) * 0.02 || 1;
      max += Math.abs(max) * 0.02 || 1;
    }
    const span = max - min;
    min -= span * 0.08;
    max += span * 0.12;
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const xOf = (i) => pad.l + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
    const yOf = (v) => pad.t + ((max - v) / (max - min)) * plotH;
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = col.muted;
    ctx.textAlign = "left";
    for (const frac of [0, 0.5, 1]) {
      const value = max - (max - min) * frac;
      const y = yOf(value);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(formatY(value), w - pad.r + 6, y + 4);
    }
    ctx.beginPath();
    points.forEach((point, i) => {
      const x = xOf(i);
      const y = yOf(point.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xOf(points.length - 1), pad.t + plotH);
    ctx.lineTo(xOf(0), pad.t + plotH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    grad.addColorStop(0, colorAlpha(col.accent, 0.28));
    grad.addColorStop(1, colorAlpha(col.accent, 0));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    points.forEach((point, i) => {
      const x = xOf(i);
      const y = yOf(point.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = col.accent;
    ctx.lineWidth = 1.75;
    ctx.stroke();
    const last = points[points.length - 1];
    const lx = xOf(points.length - 1);
    const ly = yOf(last.v);
    ctx.fillStyle = col.accent;
    ctx.beginPath();
    ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  observer.observe(canvas);
  draw();
  return { destroy() { observer.disconnect(); cancelAnimationFrame(frame); } };
}

function colorAlpha(color, alpha) {
  if (color.startsWith("#") && color.length === 7) {
    const n = Number.parseInt(color.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

function drawLevel(ctx, y, x0, x1, color, label) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.fillText(label, x0 + 4, y - 3);
  ctx.restore();
}

export function mountCandles(canvas, candles, trades, { formatPrice, formatTime, timeframe, levels = [] }) {
  const initial = Math.min(48, candles.length);
  let view = clampWindow(candles.length, candles.length - initial, initial);
  const pointers = new Map();
  let pinch = null;
  let moved = 0;
  let lastTap = 0;
  const tip = canvas.parentElement?.querySelector(".tip");
  const pad = { l: 8, r: 62, t: 14, b: 22 };

  const draw = () => {
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    if (tip) tip.hidden = true;
    if (w < 40 || h < 40 || !candles.length) return;
    view = clampWindow(candles.length, view.start, view.count);
    const col = palette();
    const slice = candles.slice(view.start, view.start + view.count);
    if (!slice.length) return;
    const gap = 8;
    const volH = Math.max(32, h * 0.2);
    const plotBottom = h - pad.b - volH - gap;
    const plotH = plotBottom - pad.t;
    const plotW = w - pad.l - pad.r;
    if (plotH < 20 || plotW < 20) return;
    let hi = -Infinity;
    let lo = Infinity;
    let vmax = 1;
    for (const candle of slice) {
      hi = Math.max(hi, candle.h);
      lo = Math.min(lo, candle.l);
      vmax = Math.max(vmax, candle.v);
    }
    for (const level of levels) {
      if (!Number.isFinite(level.price)) continue;
      hi = Math.max(hi, level.price);
      lo = Math.min(lo, level.price);
    }
    const span = hi - lo || Math.abs(hi) * 0.04 || 1;
    const yMax = hi + span * 0.08;
    const yMin = lo - span * 0.08;
    const yOf = (v) => pad.t + ((yMax - v) / (yMax - yMin)) * plotH;
    const slot = plotW / slice.length;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.lineWidth = 1;
    for (const frac of [0, 0.5, 1]) {
      const value = yMax - (yMax - yMin) * frac;
      const y = yOf(value);
      ctx.strokeStyle = col.line;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillStyle = col.muted;
      ctx.fillText(formatPrice(value), w - pad.r + 6, y + 4);
    }
    slice.forEach((candle, i) => {
      const x = pad.l + slot * i + slot / 2;
      const up = candle.c >= candle.o;
      const color = up ? col.accent : col.bad;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, yOf(candle.h));
      ctx.lineTo(x, yOf(candle.l));
      ctx.stroke();
      const bw = Math.max(1.5, Math.min(slot * 0.64, 16));
      const top = yOf(Math.max(candle.o, candle.c));
      const bot = yOf(Math.min(candle.o, candle.c));
      ctx.fillStyle = color;
      ctx.globalAlpha = up ? 0.92 : 0.8;
      ctx.fillRect(x - bw / 2, top, bw, Math.max(1, bot - top));
      const vh = (candle.v / vmax) * (volH - 2);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x - bw / 2, h - pad.b - vh, bw, vh);
      ctx.globalAlpha = 1;
    });
    const levelColor = { entry: col.muted, stop: col.bad, tp: col.accent, trail: col.ink };
    for (const level of levels) {
      if (!Number.isFinite(level.price)) continue;
      drawLevel(ctx, yOf(level.price), pad.l, w - pad.r, levelColor[level.id] || col.muted, level.label);
    }
    const limit = timeframeSeconds(timeframe);
    for (const trade of trades) {
      let best = -1;
      let bestD = Infinity;
      slice.forEach((candle, i) => {
        const dist = Math.abs(candle.t - trade.t);
        if (dist < bestD) {
          bestD = dist;
          best = i;
        }
      });
      if (best < 0 || bestD > limit * 1.6) continue;
      const candle = slice[best];
      const x = pad.l + slot * best + slot / 2;
      const buy = trade.side === "buy";
      triangle(ctx, x, buy ? yOf(candle.l) + 11 : yOf(candle.h) - 11, buy ? "up" : "down", buy ? col.accent : col.bad);
    }
    ctx.fillStyle = col.muted;
    ctx.textAlign = "left";
    ctx.fillText(formatTime(slice[0].t), pad.l, h - 6);
    ctx.textAlign = "right";
    ctx.fillText(formatTime(slice[slice.length - 1].t), w - pad.r, h - 6);
    canvas._desk = { slice, slot, pad, plotW, yOf, col };
  };

  const hideTip = () => {
    if (tip) tip.hidden = true;
  };

  const showTip = (clientX, index) => {
    const book = canvas._desk;
    if (!tip || !book || index < 0 || index >= book.slice.length) {
      hideTip();
      return;
    }
    const candle = book.slice[index];
    tip.hidden = false;
    tip.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = formatTime.full ? formatTime.full(candle.t) : formatTime(candle.t);
    const line = document.createElement("span");
    line.textContent = `O ${formatPrice(candle.o)}  H ${formatPrice(candle.h)}  L ${formatPrice(candle.l)}  C ${formatPrice(candle.c)}`;
    tip.append(title, line);
    const rect = canvas.getBoundingClientRect();
    const left = Math.min(Math.max(8, clientX - rect.left + 8), rect.width - 150);
    tip.style.left = `${left}px`;
  };

  const localX = (event) => event.clientX - canvas.getBoundingClientRect().left;

  const onDown = (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, event.clientX);
    moved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.abs(a - b) || 1, count: view.count, start: view.start, mid: (a + b) / 2 };
    }
  };

  const onMove = (event) => {
    if (!pointers.has(event.pointerId)) return;
    const prev = pointers.get(event.pointerId);
    pointers.set(event.pointerId, event.clientX);
    const book = canvas._desk;
    if (!book) return;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.abs(a - b) || 1;
      const ratio = (localX(event) - book.pad.l) / book.plotW;
      const center = pinch.start + pinch.count * Math.min(1, Math.max(0, ratio));
      const nextCount = pinch.count * (pinch.dist / dist);
      view = clampWindow(candles.length, center - nextCount * ratio, nextCount);
    } else if (pointers.size === 1) {
      const dx = event.clientX - prev;
      moved += Math.abs(dx);
      view = clampWindow(candles.length, view.start - dx / (book.plotW / view.count), view.count);
      const index = Math.floor((localX(event) - book.pad.l) / book.slot);
      showTip(event.clientX, index);
    }
    draw();
  };

  const onUp = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0 && moved < 6) {
      const now = Date.now();
      if (now - lastTap < 280) {
        const count = Math.min(48, candles.length);
        view = clampWindow(candles.length, candles.length - count, count);
        draw();
      }
      lastTap = now;
      const book = canvas._desk;
      if (book) showTip(event.clientX, Math.floor((localX(event) - book.pad.l) / book.slot));
    }
    if (pointers.size === 0 && moved >= 6) hideTip();
  };

  const onWheel = (event) => {
    event.preventDefault();
    const book = canvas._desk;
    if (!book) return;
    const ratio = (localX(event) - book.pad.l) / book.plotW;
    const factor = event.deltaY > 0 ? 1.12 : 0.88;
    const nextCount = view.count * factor;
    const center = view.start + view.count * Math.min(1, Math.max(0, ratio));
    view = clampWindow(candles.length, center - nextCount * ratio, nextCount);
    draw();
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const observer = new ResizeObserver(() => draw());
  observer.observe(canvas);
  draw();
  return {
    destroy() {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    },
  };
}

export function mountMarkedLine(canvas, points, markers, { formatY, style = "area" } = {}) {
  const images = new Map();
  let frame = 0;
  let alive = true;
  const born = performance.now();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const draw = () => {
    if (!alive) return;
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    if (w < 20 || h < 20 || !points.length) return;
    const col = palette();
    const pad = { l: 8, r: 54, t: 28, b: 16 };
    const values = points.map((point) => point.v).filter(Number.isFinite);
    if (!values.length) return;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      min -= Math.abs(min) * 0.04 || 1;
      max += Math.abs(max) * 0.04 || 1;
    }
    const span = max - min;
    min -= span * 0.12;
    max += span * 0.18;
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const times = points.map((point) => Date.parse(point.t));
    const xOf = (i) => pad.l + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
    const yOf = (v) => pad.t + ((max - v) / (max - min)) * plotH;
    const xOfTime = (stamp) => {
      const t = Date.parse(stamp);
      if (!Number.isFinite(t) || !times.length) return null;
      let best = 0;
      let bestD = Infinity;
      times.forEach((time, i) => {
        const dist = Math.abs(time - t);
        if (dist < bestD) {
          bestD = dist;
          best = i;
        }
      });
      return xOf(best);
    };
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 1;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = col.muted;
    for (const frac of [0, 1]) {
      const value = max - (max - min) * frac;
      const y = yOf(value);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(formatY(value), w - pad.r + 6, y + 4);
    }
    ctx.beginPath();
    points.forEach((point, i) => {
      const x = xOf(i);
      const y = yOf(point.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (style !== "line") {
      ctx.lineTo(xOf(points.length - 1), pad.t + plotH);
      ctx.lineTo(xOf(0), pad.t + plotH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
      grad.addColorStop(0, colorAlpha(col.accent, 0.32));
      grad.addColorStop(1, colorAlpha(col.accent, 0));
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      points.forEach((point, i) => {
        const x = xOf(i);
        const y = yOf(point.v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
    }
    const reveal = reduce ? 1 : Math.min(1, (performance.now() - born) / 700);
    if (style === "candles") {
      const body = Math.max(3, plotW / Math.max(points.length, 1) * 0.55);
      for (let i = 1; i < points.length; i += 1) {
        if (i / (points.length - 1) > reveal) break;
        const up = points[i].v >= points[i - 1].v;
        const y0 = yOf(points[i - 1].v);
        const y1 = yOf(points[i].v);
        ctx.fillStyle = up ? col.accent : col.bad;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(xOf(i) - body / 2, Math.min(y0, y1), body, Math.max(1.5, Math.abs(y1 - y0)));
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.l, 0, Math.max(plotW * reveal, 0), h);
      ctx.clip();
      ctx.beginPath();
      points.forEach((point, i) => {
        const x = xOf(i);
        const y = yOf(point.v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = col.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    const pulse = reduce ? 1 : 1 + Math.sin(performance.now() / 280) * 0.16;
    for (const marker of markers) {
      const x = xOfTime(marker.t);
      if (x == null) continue;
      const nearest = points.reduce((best, point) => (
        Math.abs(Date.parse(point.t) - Date.parse(marker.t)) < Math.abs(Date.parse(best.t) - Date.parse(marker.t)) ? point : best
      ), points[0]);
      const y = yOf(nearest.v);
      ctx.fillStyle = marker.side === "sell" ? col.bad : col.accent;
      ctx.beginPath();
      ctx.arc(x, y, 8 * pulse, 0, Math.PI * 2);
      ctx.fill();
      const img = marker.src ? images.get(marker.src) : null;
      if (img && img.complete && img.naturalWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 6.5, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, x - 6.5, y - 6.5, 13, 13);
        ctx.restore();
      }
      ctx.fillStyle = col.ink;
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(marker.side === "sell" ? "SELL" : "BUY", x, y - 14);
    }
    if (!reduce && reveal < 1) frame = requestAnimationFrame(draw);
    else if (!reduce && markers.length) frame = requestAnimationFrame(draw);
  };
  for (const marker of markers) {
    if (!marker.src || images.has(marker.src)) continue;
    const img = new Image();
    img.onload = () => draw();
    img.src = marker.src;
    images.set(marker.src, img);
  }
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  observer.observe(canvas);
  draw();
  return { destroy() { alive = false; observer.disconnect(); cancelAnimationFrame(frame); } };
}
