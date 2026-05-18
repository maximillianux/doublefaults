import { NextResponse } from "next/server";

export type Surface = "clay" | "grass" | "hard" | "indoor-hard";

export interface FormMatch {
  result: "W" | "L";
  date: string;
  tournament: string;
  surface: Surface;
  opponent: string;
  opponentRank: number | null;
}

export type FormResponse = Record<string, FormMatch[]>;

// ─── Concurrency limiter ────────────────────────────────────────────────────────
// Prevents EMFILE by capping simultaneous HTTP connections.

async function concurrentMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─── Surface lookup ────────────────────────────────────────────────────────────

const GRASS_KEYWORDS = [
  "wimbledon", "queen's", "queens club", "halle", "s-hertogenbosch",
  "eastbourne", "newport", "mallorca", "boss open", "stuttgart",
  "nottingham", "cinch championship", "libema", "terra wortmann",
  "rosmalen", "antalya",
];

const CLAY_KEYWORDS = [
  "roland garros", "french open",
  "monte-carlo", "monte carlo",
  "internazionali", "bnl",
  "mutua madrid",
  "barcelona",
  "hamburg",
  "rio open", "rio de janeiro",
  "buenos aires", "argentina open",
  "chile open", "santiago",
  "cordoba", "córdoba",
  "brasil open", "brasilia",
  "tiriac", "bucharest",
  "budapest",
  "bastad", "nordea",
  "umag", "croatia open",
  "kitzbuhel", "generali open",
  "gstaad", "swiss open",
  "estoril",
  "marrakech", "casablanca",
  "bmw open", "munich",
  "lyon",
  "geneva",
  "istanbul",
  "gijon",
  "srpska",
  "houston", "clay court",
];

function surfaceFromEvent(name: string, indoor: boolean): Surface {
  const n = name.toLowerCase();
  if (GRASS_KEYWORDS.some((k) => n.includes(k))) return "grass";
  if (CLAY_KEYWORDS.some((k) => n.includes(k))) return "clay";
  return indoor ? "indoor-hard" : "hard";
}

// ─── Rankings ──────────────────────────────────────────────────────────────────

async function fetchAllRankings(): Promise<Map<string, number>> {
  const [atpRes, wtaRes] = await Promise.all([
    fetch("https://site.api.espn.com/apis/site/v2/sports/tennis/atp/rankings", {
      next: { revalidate: 300 },
    }),
    fetch("https://site.api.espn.com/apis/site/v2/sports/tennis/wta/rankings", {
      next: { revalidate: 300 },
    }),
  ]);
  const map = new Map<string, number>();
  for (const res of [atpRes, wtaRes]) {
    if (!res.ok) continue;
    const data = await res.json();
    for (const rank of data.rankings?.[0]?.ranks ?? []) {
      if (rank.athlete?.id) map.set(String(rank.athlete.id), rank.current as number);
    }
  }
  return map;
}

// ─── Per-player form fetch ──────────────────────────────────────────────────────

interface CoreCompetitor {
  id: string;
  name: string;
  winner: boolean;
}

interface CoreCompetition {
  date?: string;
  venue?: { indoor?: boolean };
  competitors?: CoreCompetitor[];
}

type EventlogItem = { event?: { $ref: string }; competition?: { $ref: string } };

async function fetchEventlogItems(athleteId: string): Promise<EventlogItem[]> {
  const all: EventlogItem[] = [];
  let page = 1;
  const pageSize = 25;

  while (all.length < 40) {  // cap at 40 raw items to avoid runaway
    const res = await fetch(
      `https://sports.core.api.espn.com/v2/sports/tennis/athletes/${athleteId}/eventlog` +
        `?season=2026&limit=${pageSize}&page=${page}`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) break;
    const data = await res.json();
    const items: EventlogItem[] = data?.events?.items ?? [];
    all.push(...items);

    const pageCount: number = data?.events?.pageCount ?? 1;
    if (page >= pageCount || items.length < pageSize) break;
    page++;
  }

  return all;
}

async function fetchForm(
  athleteId: string,
  rankings: Map<string, number>
): Promise<FormMatch[]> {
  const items = await fetchEventlogItems(athleteId);
  if (!items.length) return [];

  const uniqueEventRefs = [
    ...new Set(items.map((it) => it.event?.["$ref"]).filter(Boolean)),
  ] as string[];

  // Cap per-player concurrency at 8 connections
  const [compResults, eventEntries] = await Promise.all([
    concurrentMap(items, 8, async (item) => {
      const ref = item.competition?.["$ref"];
      if (!ref) return null;
      try {
        const res = await fetch(ref, { next: { revalidate: 300 } });
        return res.ok ? ((await res.json()) as CoreCompetition) : null;
      } catch {
        return null;
      }
    }),
    concurrentMap(uniqueEventRefs, 4, async (ref) => {
      try {
        const res = await fetch(ref, { next: { revalidate: 86400 } });
        if (!res.ok) return [ref, ""] as [string, string];
        const data = await res.json();
        return [ref, (data.name as string) ?? ""] as [string, string];
      } catch {
        return [ref, ""] as [string, string];
      }
    }),
  ]);

  const eventNameMap = Object.fromEntries(eventEntries);

  const matches: FormMatch[] = [];
  for (let i = 0; i < items.length; i++) {
    const comp = compResults[i];
    if (!comp) continue;

    const eventRef = items[i].event?.["$ref"] ?? "";
    const eventName = eventNameMap[eventRef] ?? "";
    const indoor = comp.venue?.indoor ?? false;

    const competitors = comp.competitors ?? [];
    const us = competitors.find((c) => String(c.id) === athleteId);
    const opponent = competitors.find((c) => String(c.id) !== athleteId);
    if (!us || !opponent) continue;

    if (!us.winner && !opponent.winner) continue;
    if (opponent.name?.toLowerCase() === "bye") continue;

    matches.push({
      result: us.winner ? "W" : "L",
      date: comp.date ?? "",
      tournament: eventName,
      surface: surfaceFromEvent(eventName, indoor),
      opponent: opponent.name ?? "Unknown",
      opponentRank: rankings.get(String(opponent.id)) ?? null,
    });
  }

  matches.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return matches.slice(0, 10);
}

// ─── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);

  if (!ids.length) return NextResponse.json({});

  const rankings = await fetchAllRankings();

  // Cap top-level athlete concurrency at 6 to avoid EMFILE
  const entries = await concurrentMap(ids, 6, async (id) =>
    [id, await fetchForm(id, rankings)] as [string, FormMatch[]]
  );

  return NextResponse.json(Object.fromEntries(entries) satisfies FormResponse);
}
