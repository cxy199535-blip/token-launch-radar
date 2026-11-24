// The token radar's model, version radar-2: one snapshot of the protocol universe in, one ranked
// board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other rankable pre-token protocol the snapshot carries, down to its $5,000,000 TVL cut: the radar
// ranks the whole pre-token field, not a sample of it. A protocol is pre-token when its record
// carries no token (no market cap, no CoinGecko id, no symbol); the snapshot's live-token protocols
// are kept apart and shown at their market values, never mixed into the ranked board.
//
// Implied value is calibrated from the snapshot's own live-token protocols, not from a fixed
// multiple and never from a protocol's name:
//
//   peers      = the live-token protocols in the same category, each with ratio mcap_usd / tvl_usd,
//                winsorized at the field's 75th percentile so one broken comp (a parent token's
//                market cap over a sliver of TVL) cannot carry a category: every well-populated
//                category's median sits under that cap, so only outliers are ever trimmed
//   multiple   = (n x category median + PRIOR_PEERS x global median) / (n + PRIOR_PEERS)
//                (a category with few live peers is shrunk toward the global median; a category
//                with none takes the global median itself)
//   early rows = every rankable pre-token protocol that also passes the house's own watchlist
//                screen (no wrapped, staked or bridged product of a token that already trades)
//   growthMult = 1 + (clamp(change_7d, -50, 100) / 100) x 0.4
//   maturity   = 0.7 + min(age_days, 1460) / 1460 x 0.3   (age unknown: 365 days)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity))
//
// Every figure in that formula is read from the snapshot at run time: run the same program on a
// future snapshot and the multiples, the board and the plans all move with the data. No protocol
// name is special-cased anywhere in this file.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  prior_peers: number;
  /** No live peer's mcap/TVL ratio counts above this percentile of the field's ratios. */
  ratio_cap_percentile: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  prior_peers: 6,
  ratio_cap_percentile: 75,
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibration: how many live peers priced it, their median ratio, the shrunk multiple. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  median: number;
  multiple: number;
}

/** The whole calibration the board was priced with, as the dashboard's model panel states it. */
export interface Calibration {
  global_median: number;
  live_peers: number;
  categories: CategoryMultiple[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    peer_count: number;
    peer_median: number;
    global_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's figures plus its farm plan, verbatim. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  peer_count: number;
  peer_median: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  /** Rankable pre-token records the house screen kept off the board: wrapped or derivative products. */
  screened_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The calibration: for every category, the live-token protocols in it and the multiple their
 * market caps put on their TVL, shrunk toward the global median by the peer count.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): { globalMedian: number; livePeers: number; byCategory: Map<string, CategoryMultiple>; table: CategoryMultiple[] } {
  const ratiosByCategory = new Map<string, number[]>();
  const raw: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    raw.push(p.mcap_usd / p.tvl_usd);
  }
  // Winsorize: a peer whose market cap belongs to a parent token or a legacy version can carry a
  // ratio in the hundreds on a sliver of TVL. No peer may price a category above the field's own
  // 75th percentile, so one broken comp cannot carry a whole category with it.
  const sortedRaw = [...raw].sort((a, b) => a - b);
  const cap = sortedRaw.length > 0 ? sortedRaw[Math.min(sortedRaw.length - 1, Math.floor((model.ratio_cap_percentile / 100) * sortedRaw.length))]! : 3;
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = Math.min(p.mcap_usd / p.tvl_usd, cap);
    all.push(ratio);
    if (p.category !== null) {
      const list = ratiosByCategory.get(p.category) ?? [];
      list.push(ratio);
      ratiosByCategory.set(p.category, list);
    }
  }
  const globalMedian = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of ratiosByCategory) {
    const med = median(ratios);
    const multiple = (ratios.length * med + model.prior_peers * globalMedian) / (ratios.length + model.prior_peers);
    byCategory.set(category, { category, peers: ratios.length, median: med, multiple });
  }
  const table = [...byCategory.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  return { globalMedian, livePeers: all.length, byCategory, table };
}

/** The multipliers and the implied value one protocol gets under `model` and `calib`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  calib: ReturnType<typeof calibrate>,
): { implied: number; multiple: number; peers: number; peerMedian: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const cm = protocol.category !== null ? calib.byCategory.get(protocol.category) : undefined;
  const multiple = cm !== undefined ? cm.multiple : calib.globalMedian;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, peers: cm?.peers ?? 0, peerMedian: cm?.median ?? calib.globalMedian, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Categories the house's own watchlist screen keeps off: products of a token that already trades. */
const SCREENED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol may not begin with, the house screen's own list. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whole words that mark a wrapped or staked product of another protocol's token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * The house's watchlist screen, applied to the whole field for the board's early rows: a wrapped,
 * staked or bridged product of a token that already trades is not a launch candidate, however the
 * snapshot's fields record it. Watchlist rows are never screened out; the house already chose them.
 */
export function passesHouseScreen(p: SnapshotProtocol): boolean {
  if (p.category !== null && SCREENED_CATEGORIES.has(p.category)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calib = calibrate(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is on the board, whatever the filters below say.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The radar proper: every other rankable pre-token protocol that passes the house's own screen.
  // Coverage is the point of a radar; a board that samples the field hides the early rows.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && passesHouseScreen(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model, calib) }));
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.multiple),
      peer_count: s.peers,
      peer_median: round4(s.peerMedian),
      global_multiple: round4(calib.globalMedian),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

const L2_CHAINS = new Set(['Arbitrum', 'Base', 'Optimism', 'Linea', 'Scroll', 'Mantle', 'Blast', 'zkSync Era', 'Mode', 'Taiko', 'Manta', 'Zora', 'BOB', 'Soneium', 'Ink', 'Unichain', 'World Chain', 'Fraxtal', 'Metis', 'Polygon zkEVM']);

/** What one transaction costs on a chain, in the plain bands a farmer budgets by. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return '$8 to $15 of gas a transaction';
  if (chain === 'Solana') return 'under $0.05 of fees a transaction';
  if (chain === 'Binance' || chain === 'BNB Chain') return 'about $0.30 of gas a transaction';
  if (L2_CHAINS.has(chain)) return 'under $1 of gas a transaction';
  return 'about $1 to $3 of gas a transaction';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A category's playbook: the main action, the second qualifying action, and the risk to watch. */
function playbook(p: SnapshotProtocol, capital: number, chain: string): { main: string; second: string; risk: string } {
  const c = p.category ?? '';
  const name = p.name;
  if (c === 'Risk Curators' || c === 'Onchain Capital Allocator') return {
    main: `Deposit $${capital} of USDC into the largest ${name} vault on ${chain} and keep the vault shares in the same wallet.`,
    second: `Move a quarter of the position into a second ${name} vault with a different underlying market, so the wallet shows two distinct vault positions.`,
    risk: `A curator vault's share price falls if its underlying markets sour: read the vault's own risk page before depositing and again before adding.`,
  };
  if (c.includes('Lending') || c === 'CDP' || c.includes('Collateral')) return {
    main: `Supply $${capital} of USDC to ${name} on ${chain}; if it is a collateral market, post the USDC and mint or borrow no more than 30 per cent against it.`,
    second: `Repay any borrow in full inside the first week, then supply a further $25 so the wallet shows both a borrow cycle and a plain supply.`,
    risk: `Keep the position's health factor above 2 at all times: a borrowed position left unmonitored can be liquidated in one volatile hour.`,
  };
  if (c.includes('Dex') || c.includes('Liquidity')) return {
    main: `Provide $${capital} split evenly between USDC and the paired asset in ${name}'s deepest pool on ${chain} and keep the LP position open.`,
    second: `Route one $25 swap through a second ${name} pool each week, so the wallet is both a liquidity provider and a trader there.`,
    risk: `Liquidity positions drift with price: check the position's range and impermanent loss every week and rebalance only when it leaves the range.`,
  };
  if (c.includes('Bridge')) return {
    main: `Bridge $${capital} of USDC from Ethereum to ${chain === 'Ethereum' ? 'a chain the bridge serves' : chain} through ${name} and use the bridged funds in one app on the far side.`,
    second: `After seven days bridge $25 back the other way, so the wallet has a completed round trip in both directions.`,
    risk: `Bridges settle at different speeds: note the stated finality time before sending and never bridge funds you need the same day.`,
  };
  if (c.includes('Staking') || c.includes('Restaking') || c === 'Staking Pool') return {
    main: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`,
    second: `Put a quarter of the receipt token to work in one partner app that accepts it, such as a lending market or a pool, and leave the rest staked.`,
    risk: `A staking receipt can trade below the asset it claims: check its market price against the redemption value before adding more.`,
  };
  if (c.includes('RWA')) return {
    main: `Mint $${capital} of ${name}'s yield asset on ${chain} from USDC and hold it in the minting wallet.`,
    second: `Before the hold ends, read the redemption terms and queue a $25 test redemption, so you know the exit works before any larger position.`,
    risk: `Real-world-asset tokens redeem on the issuer's schedule, not the market's: expect queues and minimums, and size the position as locked.`,
  };
  if (c.includes('Derivative') || c.includes('Perpetual') || c.includes('Basis')) return {
    main: `Deposit $${capital} of USDC as margin or into the funding vault on ${name} and open one small hedged position at the lowest size it allows.`,
    second: `Close the position inside the first week, withdraw a quarter of the margin, then redeposit it, so the wallet shows a full trade and cash cycle.`,
    risk: `Margin positions liquidate fast: keep leverage at the minimum and the margin ratio above half, and never leave a position open over a weekend unmonitored.`,
  };
  if (c.includes('Yield') || c.includes('Farm')) return {
    main: `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and leave auto-compounding on.`,
    second: `After two weeks move a quarter of the shares into a second ${name} vault with a different underlying asset.`,
    risk: `A yield vault's rate is variable and its share price can dip with its strategy: compare the share price, not the headline rate, week to week.`,
  };
  if (c.includes('Stablecoin') || c.includes('Wrapper')) return {
    main: `Mint or wrap $${capital} of the stable asset through ${name} on ${chain} and hold it in the minting wallet.`,
    second: `Use $25 of the asset in one payment, pool or lending app that accepts it, so the wallet shows the asset in circulation, not only minted.`,
    risk: `A young stable asset can trade under its peg: check its market price weekly and keep the position small enough to exit in one swap.`,
  };
  if (c === 'Payments') return {
    main: `Fund a ${name} account with $${capital} from ${chain} and make one real payment or transfer to a second wallet you control.`,
    second: `Repeat a smaller payment once a month, so the account shows a pattern of genuine use rather than a single deposit.`,
    risk: `Payment apps can hold or review transfers: keep amounts small, keep the funding trail simple, and keep records of every transfer.`,
  };
  if (c === 'Insurance') return {
    main: `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold and keep the policy for its full term.`,
    second: `Renew the cover once when it lapses, so the wallet shows two separate policy periods.`,
    risk: `Cover pays only on the wording's terms: read the exclusions before buying, because most farming losses are not covered events.`,
  };
  if (c.includes('Prediction')) return {
    main: `Fund $${capital} on ${name} and take one position in its most liquid market.`,
    second: `Let the market settle, withdraw the proceeds once, then take one further position, so the wallet shows a settled cycle.`,
    risk: `Prediction positions can go to zero at settlement: size every position as money fully at risk and never average into a losing market.`,
  };
  if (c === 'Chain') return {
    main: `Bridge $${capital} of USDC onto ${name} and use two of its native apps in the first week, keeping a small native balance for gas.`,
    second: `Make one transaction a week on the chain after that, rotating between its apps, so the wallet reads as a resident, not a visitor.`,
    risk: `A new chain's bridges and apps are its weakest points: keep the bridged amount small until the chain has run a full quarter without an incident.`,
  };
  return {
    main: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    second: `Add a further $25 after the first week and make one more qualifying action, such as a claim, a vote or a second deposit, in the same wallet.`,
    risk: `Any single-protocol position carries that protocol's contract risk: keep this wallet's exposure to ${name} at the planned capital and no more.`,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, seven-day change), never from a
 * hand-written list of names: the playbook follows the category, the gas band follows the chain,
 * the capital follows the TVL, the hold follows the age, and the cadence follows the week's move.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbook(p, capital, chain);
  const change = p.change_7d;
  const cadence: FarmStep = change === null
    ? {
        text: `The snapshot records no seven-day move for ${p.name}, so work on a two-week rhythm: one qualifying action a fortnight until a trend shows.`,
        cost: gas,
        time: '10 minutes a fortnight',
      }
    : change >= 0
      ? {
          text: `${p.name}'s TVL grew ${change.toFixed(1)} per cent in the snapshot's seven days: keep a weekly qualifying action, such as a deposit, a swap or a claim, while it is growing.`,
          cost: gas,
          time: '10 minutes a week',
        }
      : {
          text: `${p.name}'s TVL slipped ${Math.abs(change).toFixed(1)} per cent in the snapshot's seven days: keep the position, but halve new deposits until two weekly readings in a row are level or better.`,
          cost: 'no new capital until the slide stops',
          time: '10 minutes a week to check',
        };
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.`,
      cost: gas,
      time: '10 minutes',
    },
    { text: book.main, cost: `$${capital} of capital plus ${gas}`, time: '15 minutes to set up' },
    { text: book.second, cost: gas, time: '10 minutes' },
    cadence,
    {
      text: `Hold the position for at least ${hold} days, so the activity spans more than one weekly snapshot of the protocol.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; a claim page that asks for a fee is a fake.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `${book.risk} Write the wallet, the dates and every transaction in a farm log as you go.`,
      cost: 'nothing but the log',
      time: '5 minutes a week',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js: the same figures and the same farm plan the board carries. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    peer_count: row.model.peer_count,
    peer_median: row.model.peer_median,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const calib = calibrate(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const screened = snapshot.protocols.filter((p) => isRankable(p) && !watchlist.has(p.slug) && !passesHouseScreen(p)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration: {
      global_median: round4(calib.globalMedian),
      live_peers: calib.livePeers,
      categories: calib.table.map((c) => ({ category: c.category, peers: c.peers, median: round4(c.median), multiple: round4(c.multiple) })),
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    screened_size: screened,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
