# Desk

A static, read-only iPhone web app for a private Solana desk. It lists coins the bot has scanned, opens a coin for the gate results and a canvas candlestick chart, and keeps a separate read-only view of the book, the tape, and the desk pulse.

The phone holds no keys. It cannot trade, and it cannot change bot settings. Appearance options stay in `localStorage` on the device.

Plain HTML, CSS, and ES modules. No build step and no runtime libraries. Charts are drawn on `<canvas>`. The only network calls after unlock are:

- `snapshot.json` and `coins/<mint>.json` on the data base from the private link
- coin icon URLs named in those files
- the public [GeckoTerminal](https://api.geckoterminal.com/docs/index.html) API, and only when a coin file has no candles for the selected timeframe

## Private link

Open the app as:

```text
https://<pages-host>/<repo>/#d=<base64url>&k=<access-id>
```

- `d` is the data base URL, base64url-encoded (UTF-8, no padding). Example data base: `https://<pages-host>/<repo>/sample`
- `k` is a random id, 8–128 characters from `[A-Za-z0-9_-]`
- The hash is never sent to a server. With no hash, or a bad one, the phone shows a lock screen and no desk data.
- After a valid link opens, the app keeps `#d` and `k` in the address bar. Add to Home Screen from that Safari page so the icon launches the same URL, hash included. The manifest has no `start_url`, because iOS would otherwise open the icon without the hash.
- On the lock screen, paste the full private link or the `#d=…&k=…` part and tap Unlock. That saves the link in this app’s own storage, including inside the home-screen app.
- iOS home-screen apps do not share Safari storage. The first launch from the icon reads the hash and saves the link into the home-screen app’s own `localStorage`.
- **Forget this device** (Appearance) deletes that saved link, any cached JSON, and the hash.

This is not authentication. Anyone who knows the data base URL can read the JSON. Do not put secrets, wallet keys, or API keys in the files.

```bash
python3 - <<'PY'
import base64
base = "https://USER.github.io/Trading-desk/sample"
token = base64.urlsafe_b64encode(base.encode()).decode().rstrip("=")
print(f"https://USER.github.io/Trading-desk/#d={token}&k=sample-desk-key-1")
PY
```

For this repository, once GitHub Pages is serving the `main` branch, the public sample link is:

```text
https://emiiss67.github.io/Trading-desk/#d=aHR0cHM6Ly9lbWlpc3M2Ny5naXRodWIuaW8vVHJhZGluZy1kZXNrL3NhbXBsZQ&k=sample-desk-key-1
```

`sample-desk-key-1` is a demo id for the public sample files, not a credential. Local demo (http is allowed only for localhost):

```text
http://127.0.0.1:4173/#d=aHR0cDovLzEyNy4wLjAuMTo0MTczL3NhbXBsZQ&k=sample-desk-key-1
```

when the data base is `http://127.0.0.1:4173/sample`.

## GitHub Pages

1. Push `main`.
2. Settings → Pages → Deploy from a branch → `main` → `/` (root) → Save.
3. The site is `https://<user>.github.io/<repo>/`. Paths are relative, so a project site works without a build.
4. On iPhone, open the private link in Safari first (the address bar keeps `#d` and `k`), then Share → Add to Home Screen. Delete an older home-screen icon that was added before this fix and add it again from that page.

`.nojekyll` is included so GitHub Pages serves the directories as-is.

A service worker caches the app shell (network first, offline fallback). Same-origin JSON is cached for at most 20 seconds and is not part of the shell. Cross-origin desk files are not written into the cache.

## What the bot should write

A later Python bot can publish a directory like this:

```text
snapshot.json
coins/<mint>.json
icons/...            # optional, if icon paths are relative
```

Serve it with CORS so the phone can read it (`Access-Control-Allow-Origin: *` or the Pages origin) and a short cache (`Cache-Control: max-age=5` or `no-cache`). UTF-8 JSON. Timestamps are ISO-8601 UTC. Candle times are unix seconds. Text is shown as text; HTML in fields is not rendered.

Regenerate the committed fixture with `python3 tools/make_sample.py`. Those files are fictional except the Bonk mint, which is a public token so the chart fallback has a real pool.

## `snapshot.json`

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | number | `1` |
| `sample` | boolean | When `true`, the app shows a sample banner |
| `generated_at` | string | ISO-8601 UTC. Shown as `Europe/Vilnius` |
| `desk.title` | string | Desk name |
| `desk.mode` | `paper` \| `live` | Account mode |
| `desk.run_state` | `live` \| `paused` \| `halted` | Bot run state |
| `desk.compounder_pct` | number | Optional |
| `wallet.sol` | number | Wallet balance in SOL |
| `wallet.sol_usd` | number | SOL price used for the USD/SOL display |
| `equity.usd` | number | Marked equity |
| `equity.free_cash_usd` | number | Cash not in open coins |
| `equity.start_usd` | number | Book start |
| `today.pnl_usd` | number | Today’s P&L in USD |
| `today.pnl_pct` | number | Today’s P&L percent |
| `today.cap_usd` | number | Daily loss/use cap |
| `today.cap_used_usd` | number | Used today |
| `today.cap_status` | `ok` \| `warning` \| `hit` | |
| `health.status` | `ok` \| `degraded` \| `down` | |
| `health.summary` | string | |
| `health.bots[]` | objects | `id`, `name`, `status`, `detail`, `last_seen` |
| `equity_curve[]` | objects | `t` ISO, `equity_usd` |
| `scanned[]` | coin refs | Newest first is friendly; the app also sorts by `scanned_at` |
| `positions[]` | positions | Open book |
| `activity[]` | fills | Buys and sells |

Coin ref: `mint`, `name`, `symbol`, `icon`, `scanned_at`, `created_at`, `decision` (`bought` \| `rejected` \| `watching`), `reason`, `price_usd`, `market_cap_usd`.

Position: `mint`, `name`, `symbol`, `icon`, `qty_tokens`, `entry_usd`, `mark_usd`, `cost_usd`, `value_usd`, `pnl_usd`, `pnl_pct`, `stop_usd`, `take_profit_usd`, `opened_at`.

Fill: `id`, `mint`, `name`, `symbol`, `icon`, `side` (`buy` \| `sell`), `at`, `qty_tokens`, `price_usd`, `sol`, `usd`, `pnl_usd`, `pnl_pct`, `tx`. `tx` is a Solana signature; the app links `https://solscan.io/tx/<tx>` only when it matches base58. `id` must be stable so a new buy can glow and a new winning sell can play a short burst.

`icon` is an `https` URL or a path relative to the data base (`icons/ngls.svg`). Broken or unsafe URLs fall back to a generated initial.

## `coins/<mint>.json`

`mint` is the base58 mint (32–44 characters) and the filename.

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | number | `1` |
| `name`, `symbol`, `icon`, `created_at` | | |
| `price_usd`, `market_cap_usd`, `liquidity_usd` | number | |
| `holders` | number | |
| `top_holder_pct` | number | Percent, not a fraction |
| `pool` | string | Optional GeckoTerminal pool address. If omitted, the app looks up a Solana pool |
| `gates[]` | objects | `id`, `label`, `pass` (boolean), `detail` |
| `trades[]` | objects | `at`, `side`, `price_usd`, `tx`. Drawn on the chart |
| `candles` | object | Keys `1m`, `5m`, `15m`, `1h`. Each value is `[{ "t", "o", "h", "l", "c", "v" }]`. `t` is unix seconds, `v` is volume. Empty or missing series fall back to GeckoTerminal |

Links to pump.fun, Solscan, and DexScreener are built from the mint. URLs inside the JSON are not used as link targets.

## Phone UI

- **Home** is the book: today’s P&L, portfolio value, a P&L line, and a portfolio line with a coin icon and BUY/SELL label on each fill. Wallet SOL is shown with an EUR value from `wallet.sol_eur`, or from CoinGecko when that field is missing.
- **Coins** is the scan list: icon, name, symbol, age, decision, reason, search, and filters.
- A coin opens the price, market stats, gates, contract copy, and a candlestick chart (1m / 5m / 15m / 1h) with volume and the desk’s buys and sells. Drag pans, pinch or wheel zooms, double-tap resets.
- **Positions** and **Tape** are the open book and the fills.
- **Book** and **Tape** are the open positions and the fills. Daily cap, run state, and bot health stay on Home when the file includes them. Missing numbers are omitted.
- Coin charts draw the entry, a stop ( `stop_usd`, otherwise entry × 0.6 ), a target ( `take_profit_usd`, otherwise 2× entry ), a trailing level when the file has one, and the buy/sell marks.
- Icons accept `icon`, `image`, `image_url`, `icon_url`, or `logo`. `ipfs://` and `/ipfs/<cid>` URLs are loaded through ipfs.io, dweb.link, cloudflare-ipfs.com, then cf-ipfs.com, then a generated avatar.

## Fields the exporter should add

The sample snapshot already has `equity_curve`, `activity`, `wallet.sol`, and `wallet.sol_usd`. A live writer that only matches an older shape should add:

| Field | Why |
| --- | --- |
| `wallet.sol_eur` | EUR value of the SOL balance. If absent, the phone asks CoinGecko. |
| `equity_curve[].t` and `equity_curve[].equity_usd` | Portfolio line. `portfolio_history[].t` + `value_usd` is also read. |
| `equity.start_usd` | Builds the P&L line as portfolio minus start when `pnl_curve` is absent. |
| `pnl_curve[]` with `t` and `pnl_usd` | Optional explicit P&L history. Preferred over the derived line. |
| `activity[].at`, `side`, `icon` or `image`, `symbol`, `mint` | Trade markers on the portfolio line. |
| `positions[].trailing_usd` | Trailing line on the coin chart. Also accepted as `trailing_stop_usd`. |
| `positions[].stop_usd` and `take_profit_usd` | Stop and target. If omitted, the chart uses entry × 0.6 and entry × 2. |
| `icon` or `image` as `https` or `ipfs://` | Real coin art. Relative paths still resolve against the data base. |
- Pull down, or use the refresh control. While the page is visible it refetches about every 15 seconds.
- Appearance (local only): Midnight, OLED black, Neon green, Purple haze, Light; accent color; particle style, density, and on/off; effects; comfy or compact; default timeframe; USD or SOL. Particles pause when the tab is hidden and stay off when the OS asks for reduced motion.

Check the fixture with `node --test` (or `npm test`). There is no install step.
