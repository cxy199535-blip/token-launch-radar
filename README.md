# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cxy199535-blip/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cxy199535-blip/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over a sealed DefiLlama snapshot (758 protocols, as of 2026-11-14). It ranks the protocols that record no token yet by an implied value, and gives each one a concrete farm plan.

The model (radar-2, in `lib/model.ts`) prices a protocol against the live tokens in its own category: the category multiple is the median market-cap-to-TVL ratio of that category's live peers, each ratio first capped at the field's 75th percentile so one broken comp cannot carry a category, then shrunk toward the global median by the peer count. The multiple is adjusted for the protocol's seven-day TVL growth and for how long it has run with no token. Before any of that, wrapped, staked and bridged products of tokens that already trade are screened out with the same screen the house applies to its own watchlist (91 of them in this snapshot); the 40 watchlist protocols are always carried. The board holds 198 protocols, and every row's detail view shows its own arithmetic — TVL × multiple × growth × maturity — and a seven-step farm plan built from its category, chains, size and momentum, with a cost and a time on every step.

The dashboard is a static page with no network calls: it sorts, filters by category, chain and watchlist membership, searches, and separates the protocols whose token already trades into their own view at the market's own values.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Needs Node.js 22.18 or later; standard library only. It writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
