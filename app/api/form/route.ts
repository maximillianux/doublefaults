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

export type FormResponse = Record<string, FormMatch[]>; // athleteId → last 10 (oldest→newest)

// ─── Surface lookup ────────────────────────────────────────────────────────────

const GRASS_KEYWORDS = [
  "wimbledon", "queen's", "queens club", "halle", "s-hertogenbosch",
  "eastbourne", "newport", "mallorca", "boss open", "stuttgart",
  "nottingham", "cinch championship", "libema", "terra wortmann",
  "rosmalen", "antalya",
];

const CLAY_KEYWORDS = [
  // Grand Slam / Masters clay
  "roland garros", "french open",
  "monte-carlo", "monte carlo",
  "internazionali", "bnl",        // Rome
  "mutua madrid",                  // Madrid
  "barcelona",
  "hamburg",
  // South America (all clay)
  "rio open", "rio de janeiro",
  "buenos aires", "argentina open",
  "chile open", "santiago",
  "cordoba", "córdoba",
  "brasil open", "brasilia",
  // Other European clay
  "tiriac",                        // Bucharest / Tiriac Open
  "bucharest",
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
  "srpska",                        // Serbia Open
  "istanbul",
  // North America clay
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

async function fetchForm(
  athleteId: string,
  rankings: Map<string, number>
): Promise<FormMatch[]> {
  const logRes = await fetch(
    `https://sports.core.api.espn.com/v2/sports/tennis/athletes/${athleteId}/eventlog?season=2026&limit=25`,
    { next: { revalidate: 300 } }
  );
  if (!logRes.ok) return [];

  const log = await logRes.json();
  const items: { event?: { $ref: string }; competition?: { $ref: string } }[] =
    log?.events?.items ?? [];
  if (!items.length) return [];

  // Unique event refs to fetch names
  const uniqueEventRefs = [...new Set(items.map((it) => it.event?.["$ref"]).filter(Boolean))] as string[];

  // Fetch competitions + event names in parallel
  const [compResults, eventEntries] = await Promise.all([
    Promise.all(
      items.map(async (item) => {
        const ref = item.competition?.["$ref"];
        if (!ref) return null;
        try {
          // Use short TTL so in-progress matches aren't frozen in cache
        const res = await fetch(ref, { next: { revalidate: 300 } });
          return res.ok ? ((await res.json()) as CoreCompetition) : null;
        } catch {
          return null;
        }
      })
    ),
    Promise.all(
      uniqueEventRefs.map(async (ref) => {
        try {
          const res = await fetch(ref, { next: { revalidate: 86400 } });
          if (!res.ok) return [ref, ""] as [string, string];
          const data = await res.json();
          return [ref, (data.name as string) ?? ""] as [string, string];
        } catch {
          return [ref, ""] as [string, string];
        }
      })
    ),
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

    // Skip in-progress / not-yet-played (no winner) and byes
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

  // Newest first, capped at 10
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

  const entries = await Promise.all(
    ids.map(async (id) => [id, await fetchForm(id, rankings)] as [string, FormMatch[]])
  );

  return NextResponse.json(Object.fromEntries(entries) satisfies FormResponse);
}
