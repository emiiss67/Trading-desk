const COUNTS = { low: 26, medium: 48, high: 72 };

export function startParticles(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  let raf = 0;
  let running = false;
  let style = "motes";
  let parts = [];
  let width = 0;
  let height = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rgb() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--particle-rgb");
    const bits = raw.split(",").map((part) => Number(part.trim()));
    return bits.length === 3 && bits.every(Number.isFinite) ? bits : [214, 245, 106];
  }

  function make(i, total, scatter) {
    const cluster = i % 4;
    return {
      x: Math.random() * (width || 1),
      y: scatter ? Math.random() * (height || 1) : height + Math.random() * 20,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.45) * 0.22,
      r: Math.random() * 1.5 + 0.6,
      alpha: 0.12 + Math.random() * 0.28,
      s: 0.25 + Math.random() * 0.55,
      a: Math.random() * Math.PI * 2,
      rad: 28 + (i % 7) * 18,
      cx: (width || 1) * (0.18 + cluster * 0.22),
      cy: (height || 1) * (0.25 + (i % 5) * 0.12),
      n: total,
    };
  }

  function rebuild(nextStyle, density) {
    style = nextStyle;
    const count = COUNTS[density] || COUNTS.low;
    parts = Array.from({ length: count }, (_, i) => make(i, count, true));
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const [r, g, b] = rgb();
    for (const p of parts) {
      if (style === "embers") {
        p.y -= p.s;
        p.x += Math.sin(p.y * 0.02) * 0.2;
        if (p.y < -8) {
          p.y = height + 8;
          p.x = Math.random() * width;
        }
      } else if (style === "orbits") {
        p.a += 0.004 + p.s * 0.004;
        p.x = p.cx + Math.cos(p.a) * p.rad;
        p.y = p.cy + Math.sin(p.a) * p.rad * 0.55;
      } else {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -12) p.x = width + 12;
        if (p.x > width + 12) p.x = -12;
        if (p.y < -12) p.y = height + 12;
        if (p.y > height + 12) p.y = -12;
      }
      ctx.strokeStyle = `rgba(${r},${g},${b},${p.alpha})`;
      ctx.fillStyle = ctx.strokeStyle;
      if (style === "threads") {
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 18, p.y + p.vy * 18);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function frame() {
    if (!running) return;
    draw();
    raf = requestAnimationFrame(frame);
  }

  function sync({ on, style: nextStyle, density }) {
    if (!on || document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, width, height);
      return;
    }
    const count = COUNTS[density] || COUNTS.low;
    if (!running || nextStyle !== style || parts.length !== count) {
      resize();
      rebuild(nextStyle, density);
      running = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
  }

  const observer = new ResizeObserver(() => {
    if (running) resize();
  });
  observer.observe(canvas);
  return { sync };
}
