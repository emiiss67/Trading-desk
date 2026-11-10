#!/usr/bin/env python3
"""Write the public SAMPLE desk fixture and the PWA icons. Not a trading bot."""

from __future__ import annotations

import json
import math
import random
import struct
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
END = datetime(2026, 11, 10, 17, 39, 45, tzinfo=timezone.utc)
SOL_USD = 186.4


def mint(seed: str) -> str:
    rng = random.Random(seed)
    return "".join(rng.choice(ALPH) for _ in range(44))


def sig(seed: str) -> str:
    rng = random.Random(seed)
    return "".join(rng.choice(ALPH) for _ in range(88))


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def series(seed: str, n: int, step: int, end_ts: int, start: float, end: float, vol: float):
    rng = random.Random(seed)
    walk = [0.0]
    for _ in range(n):
        walk.append(walk[-1] + rng.uniform(-1.0, 1.2))
    span = walk[-1] - walk[0] or 1.0
    path = [start + (end - start) * ((v - walk[0]) / span) for v in walk]
    t = end_ts - step * (n - 1)
    rows = []
    for i in range(n):
        o = max(1e-12, path[i])
        c = max(1e-12, path[i + 1])
        wick = abs(rng.gauss(0.01, 0.004))
        h = max(o, c) * (1 + wick)
        low = min(o, c) * (1 - wick * 0.85)
        v = max(1.0, abs(rng.gauss(vol, vol * 0.28)))
        rows.append(
            {
                "t": int(t),
                "o": round(o, 10),
                "h": round(h, 10),
                "l": round(low, 10),
                "c": round(c, 10),
                "v": round(v, 2),
            }
        )
        t += step
    return rows


def pack(rows, scales):
    out = {}
    for name, step, n, vol in scales:
        # Re-slice the 1m path by sampling a fresh series that ends on the same price.
        out[name] = rows[name]
    return out


def position(qty, entry, mark):
    cost = qty * entry
    value = qty * mark
    pnl = value - cost
    pct = (pnl / cost * 100) if cost else 0
    return {
        "qty_tokens": round(qty, 4),
        "entry_usd": entry,
        "mark_usd": mark,
        "cost_usd": round(cost, 2),
        "value_usd": round(value, 2),
        "pnl_usd": round(pnl, 2),
        "pnl_pct": round(pct, 2),
    }


def svg(path: Path, c1: str, c2: str, kind: str) -> None:
    shapes = {
        "ring": '<circle cx="64" cy="64" r="26" fill="none" stroke="#1a1c12" stroke-width="8"/>',
        "diamond": '<path d="M64 30 L96 64 L64 98 L32 64 Z" fill="#1a1c12"/>',
        "bars": '<rect x="36" y="50" width="12" height="36" rx="3" fill="#1a1c12"/><rect x="58" y="36" width="12" height="50" rx="3" fill="#1a1c12"/><rect x="80" y="58" width="12" height="28" rx="3" fill="#1a1c12"/>',
        "arc": '<path d="M38 76 A28 28 0 1 1 90 76" fill="none" stroke="#1a1c12" stroke-width="8" stroke-linecap="round"/>',
        "tri": '<path d="M64 30 L100 96 H28 Z" fill="#1a1c12"/>',
        "dots": '<circle cx="44" cy="66" r="9" fill="#1a1c12"/><circle cx="64" cy="46" r="9" fill="#1a1c12"/><circle cx="84" cy="66" r="9" fill="#1a1c12"/>',
        "slash": '<path d="M42 94 L86 34" stroke="#1a1c12" stroke-width="10" stroke-linecap="round"/>',
    }
    body = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{c1}"/>
      <stop offset="1" stop-color="{c2}"/>
    </linearGradient>
  </defs>
  <circle cx="64" cy="64" r="64" fill="url(#g)"/>
  {shapes[kind]}
</svg>
'''
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, pad: float) -> None:
    bg = (20, 20, 15, 255)
    accent = (214, 245, 106, 255)
    ink = (22, 24, 14, 255)
    fold = (138, 166, 58, 255)
    raw = bytearray()
    cx = cy = (size - 1) / 2
    radius = size * (0.30 if pad else 0.36)

    def mix(a, b, t):
        return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))

    def cover_circle(x, y, r):
        d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        if d <= r - 0.8:
            return 1.0
        if d >= r + 0.8:
            return 0.0
        return max(0.0, min(1.0, (r + 0.8 - d) / 1.6))

    for y in range(size):
        raw.append(0)
        for x in range(size):
            px = bg
            a = cover_circle(x, y, radius)
            if a:
                px = mix(bg, accent, a)
            # page
            left = cx - radius * 0.34
            right = cx + radius * 0.38
            top = cy - radius * 0.46
            bot = cy + radius * 0.50
            if left <= x <= right and top <= y <= bot and a > 0.8:
                px = ink
                fx = right - radius * 0.28
                if x > fx and y < top + (x - fx) * 0.9:
                    px = fold
            raw.extend(px)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def main() -> None:
    end_ts = int(END.timestamp())
    ngls = mint("sample-nightglass")
    hrbr = mint("sample-harbor")
    cpth = mint("sample-coppermoth")
    lowt = mint("sample-lowtide")
    crne = mint("sample-crane")
    vlkn = mint("sample-violetkiln")
    eel = mint("sample-glasseel")
    bonk = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"

    icons = {
        "ngls": ("#e5f7a4", "#8fb34a", "ring"),
        "hrbr": ("#c7e4ff", "#5d8eb8", "bars"),
        "cpth": ("#ffd0b4", "#d98452", "diamond"),
        "lowt": ("#b7efe4", "#3f8f86", "arc"),
        "crne": ("#f6e7c4", "#c9a15a", "tri"),
        "eel": ("#ddd9ff", "#7a74c4", "dots"),
        "bonk": ("#ffe08a", "#e08a2a", "slash"),
    }
    for name, spec in icons.items():
        svg(ROOT / "sample" / "icons" / f"{name}.svg", *spec)

    write_png(ROOT / "icons" / "icon-512.png", 512, False)
    write_png(ROOT / "icons" / "icon-maskable-512.png", 512, True)
    write_png(ROOT / "icons" / "icon-192.png", 192, False)
    write_png(ROOT / "icons" / "apple-touch-icon.png", 180, False)
    write_png(ROOT / "icons" / "favicon-32.png", 32, False)

    def coin_series(seed, start, end, vol):
        return {
            "1m": series(seed + "-1", 120, 60, end_ts, start, end, vol),
            "5m": series(seed + "-5", 80, 300, end_ts, start, end, vol * 4),
            "15m": series(seed + "-15", 64, 900, end_ts, start, end, vol * 9),
            "1h": series(seed + "-60", 48, 3600, end_ts, start, end, vol * 20),
        }

    ng_entry, ng_mark = 0.0000182, 0.0000244
    hb_entry, hb_mark = 0.000041, 0.000037
    cp_entry, cp_exit = 0.0000091, 0.0000112
    ng = position((0.55 * SOL_USD) / ng_entry, ng_entry, ng_mark)
    hb = position((0.40 * SOL_USD) / hb_entry, hb_entry, hb_mark)
    cp_cost = 0.35 * SOL_USD
    cp_qty = cp_cost / cp_entry
    cp_value = cp_qty * cp_exit
    cp_pnl = cp_value - cp_cost
    cp_pct = cp_pnl / cp_cost * 100

    cash = round(3.15 * SOL_USD, 2)
    equity = round(cash + ng["value_usd"] + hb["value_usd"], 2)
    opened_ng = END - timedelta(hours=2, minutes=34)
    opened_hb = END - timedelta(hours=1, minutes=51)
    sold_cp = END - timedelta(minutes=44)

    def ref(mint_id, name, symbol, icon, scanned, created, decision, reason, price, mcap):
        return {
            "mint": mint_id,
            "name": name,
            "symbol": symbol,
            "icon": icon,
            "scanned_at": iso(scanned),
            "created_at": iso(created),
            "decision": decision,
            "reason": reason,
            "price_usd": price,
            "market_cap_usd": mcap,
        }

    scanned = [
        ref(eel, "Glass Eel", "EEL", "icons/eel.svg", END - timedelta(minutes=3), END - timedelta(hours=6), "watching", "Fresh curve. Waiting on a second quiet minute.", 0.0000062, 11400),
        ref(bonk, "Bonk", "BONK", "icons/bonk.svg", END - timedelta(minutes=18), END - timedelta(days=900), "watching", "Public mint so the chart can fall back to GeckoTerminal. Sample gates, not a signal.", 0.00000282, 248000000),
        ref(cpth, "Copper Moth", "CPTH", "icons/cpth.svg", END - timedelta(hours=1, minutes=27), END - timedelta(hours=9), "bought", "Passed gates. Sold into strength.", cp_exit, 18600),
        ref(hrbr, "Harbor", "HRBR", "icons/hrbr.svg", END - timedelta(hours=1, minutes=51), END - timedelta(hours=20), "bought", "Passed gates. Size 0.40 SOL.", hb_mark, 28400),
        ref(ngls, "Nightglass", "NGLS", "icons/ngls.svg", END - timedelta(hours=2, minutes=34), END - timedelta(hours=5), "bought", "Passed gates. Size 0.55 SOL.", ng_mark, 64200),
        ref(crne, "Paper Crane", "CRNE", "icons/crne.svg", END - timedelta(hours=2, minutes=59), END - timedelta(days=2), "watching", "Clean so far. Holders still thin.", 0.0000133, 22100),
        ref(vlkn, "Violet Kiln", "VLKN", "icons/missing-violet.svg", END - timedelta(hours=3, minutes=17), END - timedelta(hours=4), "rejected", "Top holder 28% is over the 20% ceiling.", 0.000031, 41000),
        ref(lowt, "Lowtide", "LOWT", "icons/lowt.svg", END - timedelta(hours=3, minutes=29), END - timedelta(minutes=40), "rejected", "Liquidity $2.1k is under the $8k floor.", 0.0000044, 6900),
    ]

    curve = []
    rng = random.Random("equity")
    start_eq = equity - 41.2
    steps = 48
    level = start_eq
    for i in range(steps):
        t = END - timedelta(minutes=15 * (steps - 1 - i))
        if i < steps - 1:
            level += rng.uniform(-4.5, 6.2)
            level += (equity - level) * 0.08
        else:
            level = equity
        curve.append({"t": iso(t), "equity_usd": round(level, 2)})
    curve[0]["equity_usd"] = round(start_eq, 2)
    curve[-1]["equity_usd"] = equity

    snapshot = {
        "schema_version": 1,
        "sample": True,
        "generated_at": iso(END),
        "desk": {
            "title": "Sample night desk",
            "mode": "paper",
            "run_state": "live",
            "compounder_pct": 35,
        },
        "wallet": {"sol": 3.15, "sol_usd": SOL_USD},
        "equity": {"usd": equity, "free_cash_usd": cash, "start_usd": 640},
        "today": {
            "pnl_usd": 41.2,
            "pnl_pct": round(41.2 / start_eq * 100, 2),
            "cap_usd": 150,
            "cap_used_usd": 41.2,
            "cap_status": "ok",
        },
        "health": {
            "status": "ok",
            "summary": "Scanner, gates, and broker answered on the last pass.",
            "bots": [
                {"id": "scanner", "name": "Scanner", "status": "ok", "detail": "Reading new curves.", "last_seen": iso(END - timedelta(seconds=12))},
                {"id": "gates", "name": "Gates", "status": "ok", "detail": "Last coin cleared liquidity and holder checks.", "last_seen": iso(END - timedelta(seconds=20))},
                {"id": "broker", "name": "Broker", "status": "ok", "detail": "Paper fills only. No live orders.", "last_seen": iso(END - timedelta(seconds=40))},
            ],
        },
        "equity_curve": curve,
        "scanned": scanned,
        "positions": [
            {
                "mint": ngls,
                "name": "Nightglass",
                "symbol": "NGLS",
                "icon": "icons/ngls.svg",
                "stop_usd": round(ng_entry * 0.82, 10),
                "take_profit_usd": round(ng_entry * 1.9, 10),
                "opened_at": iso(opened_ng),
                **ng,
            },
            {
                "mint": hrbr,
                "name": "Harbor",
                "symbol": "HRBR",
                "icon": "icons/hrbr.svg",
                "stop_usd": round(hb_entry * 0.84, 10),
                "take_profit_usd": round(hb_entry * 1.7, 10),
                "opened_at": iso(opened_hb),
                **hb,
            },
        ],
        "activity": [
            {
                "id": "sample-fill-eel-skip",
                "mint": cpth,
                "name": "Copper Moth",
                "symbol": "CPTH",
                "icon": "icons/cpth.svg",
                "side": "sell",
                "at": iso(sold_cp),
                "qty_tokens": round(cp_qty, 4),
                "price_usd": cp_exit,
                "sol": 0.43,
                "usd": round(cp_value, 2),
                "pnl_usd": round(cp_pnl, 2),
                "pnl_pct": round(cp_pct, 2),
                "tx": sig("sample-tx-cpth-sell"),
            },
            {
                "id": "sample-fill-cpth-buy",
                "mint": cpth,
                "name": "Copper Moth",
                "symbol": "CPTH",
                "icon": "icons/cpth.svg",
                "side": "buy",
                "at": iso(END - timedelta(hours=1, minutes=27)),
                "qty_tokens": round(cp_qty, 4),
                "price_usd": cp_entry,
                "sol": 0.35,
                "usd": round(cp_cost, 2),
                "pnl_usd": None,
                "pnl_pct": None,
                "tx": sig("sample-tx-cpth-buy"),
            },
            {
                "id": "sample-fill-hrbr",
                "mint": hrbr,
                "name": "Harbor",
                "symbol": "HRBR",
                "icon": "icons/hrbr.svg",
                "side": "buy",
                "at": iso(opened_hb),
                "qty_tokens": hb["qty_tokens"],
                "price_usd": hb_entry,
                "sol": 0.40,
                "usd": hb["cost_usd"],
                "pnl_usd": None,
                "pnl_pct": None,
                "tx": sig("sample-tx-hrbr"),
            },
            {
                "id": "sample-fill-ngls",
                "mint": ngls,
                "name": "Nightglass",
                "symbol": "NGLS",
                "icon": "icons/ngls.svg",
                "side": "buy",
                "at": iso(opened_ng),
                "qty_tokens": ng["qty_tokens"],
                "price_usd": ng_entry,
                "sol": 0.55,
                "usd": ng["cost_usd"],
                "pnl_usd": None,
                "pnl_pct": None,
                "tx": sig("sample-tx-ngls"),
            },
        ],
    }

    def write_coin(meta, price, mcap, liq, holders, top, gates, trades, candles, pool=""):
        body = {
            "schema_version": 1,
            "sample": True,
            "mint": meta["mint"],
            "name": meta["name"],
            "symbol": meta["symbol"],
            "icon": meta["icon"],
            "created_at": meta["created_at"],
            "price_usd": price,
            "market_cap_usd": mcap,
            "liquidity_usd": liq,
            "holders": holders,
            "top_holder_pct": top,
            "gates": gates,
            "trades": trades,
            "candles": candles,
        }
        if pool:
            body["pool"] = pool
        path = ROOT / "sample" / "coins" / f"{meta['mint']}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")

    def gates(*rows):
        return [{"id": i, "label": label, "pass": ok, "detail": detail} for i, label, ok, detail in rows]

    by = {row["symbol"]: row for row in scanned}
    write_coin(
        by["NGLS"], ng_mark, 64200, 12840, 214, 8.4,
        gates(
            ("liq", "Liquidity", True, "$12.8k free liquidity, above the $8k floor."),
            ("holders", "Holders", True, "214 holders. Top wallet 8.4%."),
            ("flow", "Flow", True, "Buys led the last five minutes."),
            ("age", "Age", True, "Curve is five hours old."),
        ),
        [{"at": iso(opened_ng), "side": "buy", "price_usd": ng_entry, "tx": sig("sample-tx-ngls")}],
        coin_series("ngls", ng_entry * 0.92, ng_mark, 1800),
    )
    write_coin(
        by["HRBR"], hb_mark, 28400, 9100, 96, 14.2,
        gates(
            ("liq", "Liquidity", True, "$9.1k free liquidity."),
            ("holders", "Holders", True, "Top wallet 14.2%, under 20%."),
            ("flow", "Flow", False, "Sellers showed up after the entry."),
        ),
        [{"at": iso(opened_hb), "side": "buy", "price_usd": hb_entry, "tx": sig("sample-tx-hrbr")}],
        coin_series("hrbr", hb_entry * 0.96, hb_mark, 900),
    )
    write_coin(
        by["CPTH"], cp_exit, 18600, 7400, 140, 11.0,
        gates(
            ("liq", "Liquidity", True, "$7.4k at the sale. Was above the floor on entry."),
            ("holders", "Holders", True, "Top wallet 11%."),
        ),
        [
            {"at": iso(END - timedelta(hours=1, minutes=27)), "side": "buy", "price_usd": cp_entry, "tx": sig("sample-tx-cpth-buy")},
            {"at": iso(sold_cp), "side": "sell", "price_usd": cp_exit, "tx": sig("sample-tx-cpth-sell")},
        ],
        coin_series("cpth", cp_entry * 0.9, cp_exit, 700),
    )
    write_coin(
        by["LOWT"], 0.0000044, 6900, 2100, 48, 18.0,
        gates(
            ("liq", "Liquidity", False, "$2.1k is under the $8k floor."),
            ("holders", "Holders", True, "Top wallet 18%."),
            ("age", "Age", False, "Curve is under an hour old."),
        ),
        [],
        coin_series("lowt", 0.0000035, 0.0000044, 240),
    )
    write_coin(
        by["CRNE"], 0.0000133, 22100, 8600, 77, 16.4,
        gates(
            ("liq", "Liquidity", True, "$8.6k, just over the floor."),
            ("holders", "Holders", False, "Only 77 holders."),
        ),
        [],
        coin_series("crne", 0.000012, 0.0000133, 500),
    )
    write_coin(
        by["VLKN"], 0.000031, 41000, 15000, 120, 28.0,
        gates(
            ("liq", "Liquidity", True, "$15k free liquidity."),
            ("top", "Top holder", False, "Top wallet holds 28%, over the 20% ceiling."),
        ),
        [],
        coin_series("vlkn", 0.000028, 0.000031, 640),
    )
    write_coin(
        by["BONK"], 0.00000282, 248000000, 270000, 800000, 6.2,
        gates(
            ("sample", "Sample only", True, "This row exists so a phone can load a public chart. It is not a desk signal."),
        ),
        [],
        {},
    )

    snap_path = ROOT / "sample" / "snapshot.json"
    snap_path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {snap_path}")
    print("equity", equity, "cash", cash)
    print("ngls", ngls)


if __name__ == "__main__":
    main()
