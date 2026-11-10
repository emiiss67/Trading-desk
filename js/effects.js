const jobs = new Set();

export function effectsAllowed(settings) {
  return Boolean(settings?.effects) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function countUp(node, from, to, format, ms = 680) {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to) || from === to) {
    node.textContent = format(to);
    return;
  }
  const start = performance.now();
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    jobs.delete(stop);
  };
  const frame = (now) => {
    const p = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - p) ** 3;
    node.textContent = format(from + (to - from) * eased);
    if (p < 1) raf = requestAnimationFrame(frame);
    else stop();
  };
  jobs.add(stop);
  raf = requestAnimationFrame(frame);
}

export function cancelAnimations() {
  for (const stop of [...jobs]) stop();
}

export function burst() {
  const canvas = document.createElement("canvas");
  canvas.className = "burst";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.scale(dpr, dpr);
  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue("--accent").trim() || "#d6f56a";
  const ink = styles.getPropertyValue("--ink").trim() || "#fff";
  const bits = Array.from({ length: 42 }, (_, i) => ({
    x: w * 0.5 + (Math.random() - 0.5) * 40,
    y: h * 0.42,
    vx: (Math.random() - 0.5) * 9,
    vy: -Math.random() * 8 - 2,
    g: 0.18 + Math.random() * 0.08,
    s: 3 + Math.random() * 4,
    color: i % 3 === 0 ? ink : accent,
    life: 1,
  }));
  const t0 = performance.now();
  const tick = (now) => {
    const p = (now - t0) / 1200;
    ctx.clearRect(0, 0, w, h);
    for (const bit of bits) {
      bit.vy += bit.g;
      bit.x += bit.vx;
      bit.y += bit.vy;
      bit.life = Math.max(0, 1 - p);
      ctx.globalAlpha = bit.life;
      ctx.fillStyle = bit.color;
      ctx.fillRect(bit.x, bit.y, bit.s, bit.s * 0.7);
    }
    ctx.globalAlpha = 1;
    if (p < 1) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
}

let toastTimer = 0;
export function toast(message) {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 1700);
}
