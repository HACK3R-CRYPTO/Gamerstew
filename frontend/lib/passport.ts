// ─── Passport data assembly (server-only) ────────────────────────────────────
// One call gathers everything the public /pass/[address] page and its OG image
// need: on-chain GamePass facts (username, best scores, games played), the
// lifetime UBI contribution (HabitatRegistry + PerkShop, summed — PerkShop's
// playerUbiContributed was previously read nowhere), backend progression
// (level/streak/badges/habitat), and the all-time combined rank from the
// subgraph. Every source is best-effort: a dead RPC or backend never 404s the
// passport, it just renders fewer stats.

import { createPublicClient, http, formatUnits } from "viem";
import { celo } from "viem/chains";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";
import { HABITATS } from "@/lib/habitats";
import { collectiveById } from "@/lib/collectives";
import { fetchPlayerAllTimeCombinedStats } from "@/lib/subgraph";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3005";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

const PERK_SHOP_ABI = [
  {
    type: "function",
    name: "playerUbiContributed",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Same thresholds as the profile page's petStageFor.
export function petForLevel(level: number): { id: string; name: string; src: string } {
  if (level >= 50) return { id: "king", name: "King Slime", src: "/pets/stage-5-king.png" };
  if (level >= 30) return { id: "crystal", name: "Crystal Slime", src: "/pets/stage-4-crystal.png" };
  if (level >= 15) return { id: "teen", name: "Teen Slime", src: "/pets/stage-3-teen.png" };
  if (level >= 5) return { id: "baby", name: "Baby Slime", src: "/pets/stage-2-baby.png" };
  return { id: "egg", name: "Mystery Egg", src: "/pets/stage-1-egg.png" };
}

export type PassportData = {
  address: string;
  minted: boolean;
  username: string | null;
  level: number;
  streak: number;
  gamesPlayed: number;
  bestRhythm: number;
  bestSimon: number;
  bestStack: number;
  rank: number | null;         // all-time combined rank (subgraph)
  badges: { gold: number; silver: number; bronze: number };
  pet: { id: string; name: string; src: string };
  habitat: { id: number; name: string; bgImage?: string; gradient: string; accent: string } | null;
  ubiTotalG: number;           // lifetime G$ routed to the UBI pool (habitat + perks)
  collective: { id: string; name: string; emoji: string; tagline: string };
};

// /pass/[handle] accepts a username ("ogazboiz") or a 0x address. Usernames
// are the canonical share form; this resolves either to the wallet.
const SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
  "https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.2/gn";

export async function resolvePassHandle(handle: string): Promise<string | null> {
  const h = decodeURIComponent(handle || "").trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(h)) return h.toLowerCase();
  if (!/^[a-zA-Z0-9_]{2,24}$/.test(h)) return null;
  const lookup = async (u: string) => {
    try {
      const r = await fetch(SUBGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query P($u: String!) { players(where: { username: $u }, first: 1) { id } }`,
          variables: { u },
        }),
        next: { revalidate: 300 },
      });
      const json = await r.json();
      return (json?.data?.players?.[0]?.id as string) ?? null;
    } catch {
      return null;
    }
  };
  return (await lookup(h)) ?? (await lookup(h.toLowerCase()));
}

async function backendJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      headers: { "x-internal-secret": INTERNAL_SECRET ?? "" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getPassport(addressRaw: string): Promise<PassportData | null> {
  const address = addressRaw.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) return null;
  const addr = address as `0x${string}`;

  const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
  const gamePass = { address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`, abi: GAME_PASS_ABI } as const;

  const [chain, user, badgesRes, habitatRes, standing, choiceRes] = await Promise.all([
    client
      .multicall({
        contracts: [
          { ...gamePass, functionName: "hasMinted", args: [addr] },
          { ...gamePass, functionName: "getUsername", args: [addr] },
          { ...gamePass, functionName: "gamesPlayed", args: [addr] },
          { ...gamePass, functionName: "bestScore", args: [addr, 0] },
          { ...gamePass, functionName: "bestScore", args: [addr, 1] },
          { address: CONTRACT_ADDRESSES.PERK_SHOP as `0x${string}`, abi: PERK_SHOP_ABI, functionName: "playerUbiContributed", args: [addr] },
        ],
      })
      .catch(() => null),
    backendJson(`/api/user/${address}`),
    backendJson(`/api/badges/${address}`),
    backendJson(`/api/habitat/${address}`),
    fetchPlayerAllTimeCombinedStats(address).catch(() => null),
    backendJson(`/api/collective/${address}`),
  ]);

  const minted = chain?.[0]?.status === "success" ? Boolean(chain[0].result) : false;
  const username = chain?.[1]?.status === "success" && chain[1].result ? String(chain[1].result) : null;
  const gamesPlayed = chain?.[2]?.status === "success" ? Number(chain[2].result) : 0;
  const bestRhythm = chain?.[3]?.status === "success" ? Number(chain[3].result) : 0;
  const bestSimon = chain?.[4]?.status === "success" ? Number(chain[4].result) : 0;
  const perkUbiWei = chain?.[5]?.status === "success" ? (chain[5].result as bigint) : BigInt(0);

  // A passport only exists for real players: minted pass OR any recorded play.
  if (!minted && gamesPlayed === 0 && !user) return null;

  const level = Number((user as { level?: number } | null)?.level ?? 1) || 1;
  const streak = Number((user as { streak?: number } | null)?.streak ?? 0) || 0;

  const summary = (badgesRes as { summary?: { totalGold?: number; totalSilver?: number; totalBronze?: number } } | null)?.summary;
  const badges = {
    gold: summary?.totalGold ?? 0,
    silver: summary?.totalSilver ?? 0,
    bronze: summary?.totalBronze ?? 0,
  };

  // Habitat: equipped tier id → art + name from the tier table.
  const equippedId = Number((habitatRes as { equipped?: number } | null)?.equipped ?? 0);
  const tier = HABITATS.find((h) => h.id === equippedId) ?? null;
  const habitat = tier
    ? { id: tier.id, name: tier.name, bgImage: tier.bgImage, gradient: tier.bg.gradient, accent: tier.bg.accent }
    : null;

  // Lifetime UBI: habitat donations (backend, raw 18-dec string) + perk buys.
  const habitatUbiWei = BigInt(String((habitatRes as { ubiDonated?: string | number } | null)?.ubiDonated ?? "0") || "0");
  const ubiTotalG = Math.round(Number(formatUnits(habitatUbiWei + perkUbiWei, 18)) * 100) / 100;

  const col = collectiveById((choiceRes as { collectiveId?: string | null } | null)?.collectiveId);

  return {
    address,
    minted,
    username,
    level,
    streak,
    gamesPlayed,
    bestRhythm: standing?.bestRhythm ?? bestRhythm,
    bestSimon: standing?.bestSimon ?? bestSimon,
    bestStack: standing?.bestStack ?? 0,
    rank: standing?.rank ?? null,
    badges,
    pet: petForLevel(level),
    habitat,
    ubiTotalG,
    collective: { id: col.id, name: col.name, emoji: col.emoji, tagline: col.tagline },
  };
}
