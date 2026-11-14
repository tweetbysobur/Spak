/**
 * SPak Intelligence: pure analysis over a valued portfolio. No I/O, deterministic, integer-safe where amounts are
 * compared. Every insight names the numbers it is based on, and nothing is inferred beyond the data:
 * unpriced holdings are excluded from totals and counted separately, unreadable balances are reported as unknown.
 */
import { compareDecimal, fromBaseUnits, toBaseUnits } from "../spak-in/lib/decimal";
import { getNetwork } from "../spak-in/registries/networks";
import type { NetworkRead } from "./portfolio";

export interface Holding {
  walletId: string; address: string; network: string; networkName: string;
  assetId: string; symbol: string; decimals: number; native: boolean;
  units: string; amount: string;
  /** SPak's independent USD value; null when no verified price exists (then it is not counted in totals). */
  usd: string | null;
  priceSource: "CHAINLINK" | "COINGECKO" | null;
  priceNote: string | null;
  /** NEAR Intents lists this asset, so SPak can quote routes for it. */
  routable: boolean;
}
export interface Insight { kind: string; text: string; data: Record<string, unknown> }
export interface Share { usd: string; share: number }
export interface Snapshot {
  readAt: string;
  wallets: { id: string; family: string; address: string; label: string | null; usd: string; networks: string[] }[];
  holdings: Holding[];
  totals: { usd: string; priced: number; unpriced: number };
  byNetwork: ({ network: string; name: string } & Share)[];
  byAsset: ({ symbol: string; networks: { network: string; amount: string }[] } & Share)[];
  reads: NetworkRead[];
  insights: Insight[];
}

const name = (n: string) => getNetwork(n)?.name ?? n;
/** USD strings to integer micro-dollars and back, so sums and shares never drift. */
const micro = (usd: string) => BigInt(toBaseUnits(usd, 6));
const usdOf = (m: bigint) => fromBaseUnits(m.toString(), 6);
const pct = (part: bigint, whole: bigint) => (whole > 0n ? Number((part * 10_000n) / whole) / 100 : 0);
const money = (usd: string) => `$${Number(usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (amount: string) => { const [i, f = ""] = amount.split("."); const t = f.slice(0, 6).replace(/0+$/, ""); return `${Number(i).toLocaleString("en-US")}${t ? `.${t}` : ""}`; };

export function analyse(args: { holdings: Holding[]; reads: NetworkRead[]; wallets: { id: string; family: string; address: string; label: string | null }[]; readAt: Date }): Snapshot {
  const { holdings, reads } = args;
  const priced = holdings.filter((h) => h.usd !== null);
  const total = priced.reduce((s, h) => s + micro(h.usd!), 0n);

  const sumBy = (key: (h: Holding) => string) => {
    const m = new Map<string, bigint>();
    for (const h of priced) m.set(key(h), (m.get(key(h)) ?? 0n) + micro(h.usd!));
    return m;
  };
  const netUsd = sumBy((h) => h.network);
  const byNetwork = [...netUsd].map(([network, u]) => ({ network, name: name(network), usd: usdOf(u), share: pct(u, total) })).sort((a, b) => compareDecimal(b.usd, a.usd));
  const assetUsd = sumBy((h) => h.symbol);
  const symbols = [...new Set(holdings.map((h) => h.symbol))];
  const byAsset = symbols.map((symbol) => {
    const u = assetUsd.get(symbol) ?? 0n;
    const nets = new Map<string, bigint>();
    const dec = holdings.find((h) => h.symbol === symbol)!.decimals;
    for (const h of holdings.filter((x) => x.symbol === symbol && x.decimals === dec)) nets.set(h.network, (nets.get(h.network) ?? 0n) + BigInt(h.units));
    return { symbol, usd: usdOf(u), share: pct(u, total), networks: [...nets].map(([network, units]) => ({ network, amount: fromBaseUnits(units.toString(), dec) })) };
  }).sort((a, b) => compareDecimal(b.usd, a.usd));

  const wallets = args.wallets.map((w) => {
    const mine = priced.filter((h) => h.walletId === w.id);
    return { ...w, usd: usdOf(mine.reduce((s, h) => s + micro(h.usd!), 0n)), networks: [...new Set(holdings.filter((h) => h.walletId === w.id).map((h) => h.network))] };
  });

  return { readAt: args.readAt.toISOString(), wallets, holdings, totals: { usd: usdOf(total), priced: priced.length, unpriced: holdings.length - priced.length }, byNetwork, byAsset, reads, insights: insights({ holdings, reads, total, byNetwork, byAsset }) };
}

function insights(a: { holdings: Holding[]; reads: NetworkRead[]; total: bigint; byNetwork: Snapshot["byNetwork"]; byAsset: Snapshot["byAsset"] }): Insight[] {
  const out: Insight[] = [];
  const down = a.reads.filter((r) => r.status === "UNAVAILABLE");
  if (down.length) out.push({ kind: "DATA_UNAVAILABLE", text: `SPak could not read ${[...new Set(down.map((r) => name(r.network)))].join(", ")} just now. Balances there are unknown, not zero, and are left out of every figure below.`, data: { networks: down.map((r) => r.network) } });
  const partial = a.reads.filter((r) => r.status === "PARTIAL");
  if (partial.length) out.push({ kind: "DATA_PARTIAL", text: `Some token balances could not be read on ${[...new Set(partial.map((r) => name(r.network)))].join(", ")}.`, data: { reads: partial.map((r) => ({ network: r.network, assets: r.unknownAssets })) } });
  if (!a.holdings.length) return out;

  const top = a.byAsset.find((x) => x.share > 0);
  const many = a.byAsset.filter((x) => x.share > 0).length > 1;
  if (top) out.push({ kind: "LARGEST_EXPOSURE", text: `Your largest exposure is ${top.symbol}: ${money(top.usd)}, ${top.share}% of your priced holdings${top.share >= 50 && many ? ", more than half in one asset" : ""}.`, data: { symbol: top.symbol, usd: top.usd, share: top.share, concentrated: top.share >= 50 && many } });
  // Said once: the network line only when it adds something the asset line does not.
  const topNet = a.byNetwork[0];
  if (topNet && a.byNetwork.length > 1 && topNet.share !== top?.share) out.push({ kind: "NETWORK_CONCENTRATION", text: `${topNet.share}% of your priced value is on ${topNet.name}.`, data: { network: topNet.network, share: topNet.share } });
  for (const x of a.byAsset) if (x.networks.length > 1) {
    out.push({ kind: "SPREAD_ACROSS_NETWORKS", text: `Your ${x.symbol} is spread across ${x.networks.length} networks: ${x.networks.map((n) => `${fmt(n.amount)} on ${name(n.network)}`).join(", ")}.`, data: { symbol: x.symbol, networks: x.networks } });
  }
  // Tokens without the network's native asset cannot pay their own deposit fee on EVM and Solana.
  const byWalletNet = new Map<string, Holding[]>();
  for (const h of a.holdings) byWalletNet.set(`${h.walletId}|${h.network}`, [...(byWalletNet.get(`${h.walletId}|${h.network}`) ?? []), h]);
  for (const hs of byWalletNet.values()) {
    const net = getNetwork(hs[0].network);
    if (!net || net.family === "near") continue;
    if (!hs.some((h) => h.native) && hs.some((h) => !h.native)) {
      out.push({ kind: "NO_GAS", text: `You hold ${[...new Set(hs.map((h) => h.symbol))].join(", ")} on ${net.name} but no ${net.nativeSymbol}. Sending from ${net.name} needs ${net.nativeSymbol} for the network fee.`, data: { network: net.id, address: hs[0].address, nativeSymbol: net.nativeSymbol } });
    }
  }
  const unpriced = a.holdings.filter((h) => h.usd === null);
  if (unpriced.length) out.push({ kind: "UNPRICED", text: `${unpriced.length} holding${unpriced.length > 1 ? "s have" : " has"} no verified price (${[...new Set(unpriced.map((h) => h.symbol))].join(", ")}) and ${unpriced.length > 1 ? "are" : "is"} not counted in your total.`, data: { symbols: [...new Set(unpriced.map((h) => h.symbol))] } });
  const stuck = a.holdings.filter((h) => !h.routable && h.assetId !== "near:native");
  if (stuck.length) out.push({ kind: "NOT_ROUTABLE", text: `${[...new Set(stuck.map((h) => `${h.symbol} on ${h.networkName}`))].join(", ")} cannot be moved through NEAR Intents right now.`, data: { assets: [...new Set(stuck.map((h) => h.assetId))] } });
  if (a.holdings.some((h) => h.assetId === "near:native")) out.push({ kind: "NEAR_NEEDS_WRAP", text: "NEAR Intents moves wrapped NEAR (wNEAR), not native NEAR. Native NEAR also pays your NEAR gas and storage, so keep some.", data: {} });
  return out;
}

// ---------------------------------------------------------------------------------------------- questions and intents

/** Answer a SPak-in PORTFOLIO_QUERY ("How much USDC do I have?", "my balance on Base") from real holdings only. */
export function answerQuery(s: Snapshot, q: { assets: string[]; networks: string[] } | null) {
  const assets = (q?.assets ?? []).map((x) => x.toUpperCase());
  const nets = q?.networks ?? [];
  const hs = s.holdings.filter((h) => (!assets.length || assets.includes(h.symbol.toUpperCase())) && (!nets.length || nets.includes(h.network)));
  const usd = usdOf(hs.filter((h) => h.usd !== null).reduce((t, h) => t + micro(h.usd!), 0n));
  const scope = [assets.length ? assets.join(", ") : "", nets.length ? `on ${nets.map(name).join(", ")}` : ""].filter(Boolean).join(" ");
  const lines = hs.sort((a, b) => compareDecimal(b.usd ?? "0", a.usd ?? "0")).map((h) => `${fmt(h.amount)} ${h.symbol} on ${h.networkName}${h.usd !== null ? ` (${money(h.usd)})` : " (no verified price)"}`);
  const unknownNets = s.reads.filter((r) => r.status !== "OK" && (!nets.length || nets.includes(r.network))).map((r) => name(r.network));
  const text = hs.length
    ? `You hold ${scope ? `${scope}: ` : ""}${money(usd)} across ${hs.length} holding${hs.length > 1 ? "s" : ""}.`
    : `SPak found no ${scope || "balances"} in your connected wallets.`;
  return { text, lines, usd, holdings: hs, incomplete: unknownNets.length ? `Not fully read: ${[...new Set(unknownNets)].join(", ")}.` : null };
}

export interface Feasibility { status: "OK" | "INSUFFICIENT" | "UNKNOWN"; available: string | null; required: string; symbol: string; network: string; notes: string[] }

/** Can this exact transfer be funded from the wallet SPak-in chose? Read-only; Guard and the quote still decide. */
export function feasibility(s: Snapshot, leg: { sourceNetwork: string; sourceAssetId: string; refundAddress: string; amount: string; symbol: string; decimals: number }): Feasibility {
  const net = getNetwork(leg.sourceNetwork);
  const read = s.reads.find((r) => r.network === leg.sourceNetwork && r.address.toLowerCase() === leg.refundAddress.toLowerCase());
  const base = { required: leg.amount, symbol: leg.symbol, network: leg.sourceNetwork };
  if (!read || read.status === "UNAVAILABLE" || (read.status === "PARTIAL" && read.unknownAssets.includes(leg.symbol))) {
    return { ...base, status: "UNKNOWN", available: null, notes: [`SPak could not read your ${leg.symbol} balance on ${name(leg.sourceNetwork)}. Your wallet will check it before signing.`] };
  }
  const own = s.holdings.filter((h) => h.network === leg.sourceNetwork && h.address.toLowerCase() === leg.refundAddress.toLowerCase());
  const h = own.find((x) => x.assetId === leg.sourceAssetId);
  const have = BigInt(h?.units ?? "0");
  const need = BigInt(toBaseUnits(leg.amount, leg.decimals));
  const available = fromBaseUnits(have.toString(), leg.decimals);
  const notes: string[] = [];
  if (have < need) {
    notes.push(`You have ${fmt(available)} ${leg.symbol} on ${name(leg.sourceNetwork)} in this wallet; this transfer needs ${fmt(leg.amount)}.`);
    return { ...base, status: "INSUFFICIENT", available, notes };
  }
  const native = own.find((x) => x.native);
  if (net && net.family !== "near" && !h?.native && !native) notes.push(`You have no ${net.nativeSymbol} on ${net.name} to pay the network fee for the deposit.`);
  if (h?.native && have === need) notes.push(`This is your whole ${leg.symbol} balance. The deposit also needs ${leg.symbol} for the network fee, so send a little less.`);
  if (net?.family === "near" && !h?.native) notes.push("The NEAR deposit also needs a small amount of NEAR for gas and the deposit account's storage registration.");
  return { ...base, status: "OK", available, notes };
}

/** Holdings that could fund an instruction whose source network SPak-in still needs, as complete instructions to pick. */
export function sourceOptions(s: Snapshot, a: { symbol: string; amount: string | null; destinationNetwork: string | null }) {
  const sym = a.symbol.toUpperCase();
  const dst = a.destinationNetwork ? name(a.destinationNetwork) : null;
  return s.holdings.filter((h) => h.symbol.toUpperCase() === sym && h.network !== a.destinationNetwork && h.routable)
    .sort((x, y) => compareDecimal(y.amount, x.amount) || x.network.localeCompare(y.network)).map((h) => {
    const enough = a.amount === null || compareDecimal(h.amount, a.amount) >= 0;
    const amount = a.amount ?? h.amount;
    return {
      network: h.network, address: h.address, available: h.amount, enough,
      instruction: enough && dst ? `Move ${amount} ${h.symbol} from ${h.networkName} to ${dst}` : null,
      text: `${fmt(h.amount)} ${h.symbol} on ${h.networkName}${enough ? "" : ` (not enough for ${fmt(a.amount!)})`}`,
    };
  });
}
