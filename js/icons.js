import { el } from "./dom.js";
import { safeImageUrl } from "./api.js";
import { str } from "./text.js";
import { iconSources } from "./fields.js";

const NS = "http://www.w3.org/2000/svg";

function path(d) {
  const node = document.createElementNS(NS, "path");
  node.setAttribute("d", d);
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.6");
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  return node;
}

export function icon(name) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const paths = {
    back: ["M14.5 6.5 L8.5 12 L14.5 17.5"],
    refresh: ["M19.5 12 A7.5 7.5 0 1 1 17 6.2", "M19.5 4.5 V8.5 H15.5"],
    look: ["M4 7 H20", "M7 12 H17", "M10 17 H14"],
  };
  for (const d of paths[name] || []) svg.append(path(d));
  return svg;
}

export function initials(symbol, name) {
  const source = (str(symbol, 8) || str(name, 16)).replace(/[^A-Za-z0-9]/g, "");
  return source ? source.slice(0, 2).toUpperCase() : "·";
}

export function avatarColors(seed) {
  let hash = 2166136261;
  const text = String(seed || "coin");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash) % 360;
  return [`hsl(${hue} 42% 76%)`, `hsl(${(hue + 28) % 360} 36% 62%)`];
}

export function coinIcon(url, symbol, name, base, eager = false) {
  const wrap = el("span", { class: "coin-icon", "aria-hidden": "true" });
  const [a, b] = avatarColors(symbol || name || url);
  const face = el("span", { class: "avatar", text: initials(symbol, name) });
  face.style.setProperty("--a", a);
  face.style.setProperty("--b", b);
  wrap.append(face);
  const sources = iconSources(url, base, safeImageUrl);
  if (sources.length) {
    const img = el("img", {
      alt: "",
      loading: eager ? "eager" : "lazy",
      decoding: "async",
      referrerpolicy: "no-referrer",
    });
    let index = 0;
    const tryNext = () => {
      if (index >= sources.length) {
        img.remove();
        return;
      }
      img.src = sources[index];
      index += 1;
    };
    img.addEventListener("load", () => img.classList.add("is-loaded"));
    img.addEventListener("error", tryNext);
    tryNext();
    wrap.append(img);
  }
  return wrap;
}
