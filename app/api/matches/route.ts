import { NextResponse } from "next/server";

export const revalidate = 300; // re-fetch every 5 minutes

interface Competitor {
  id: string;
  winner: boolean;
  linescores?: { value: number; winner: boolean }[];
  score?: string;
  athlete: {
    displayName: string;
    shortName: string;
    flag?: { href?: string; alt: string };
  };
}

interface Competition {
  id: string;
  date: string;
  status: {
    period: number;
    type: {
      name: string;
      state: string; // "pre" | "in" | "post"
      description: string;
      detail: string;
    };
  };
  venue?: { fullName: string; court?: string };
  notes?: { text: string; type: string }[];
  competitors: Competitor[];
}

export interface Match {
  id: string;
  date: string;
  state: string;
  statusDetail: string;
  venue: string;
  court: string;
  summary: string;
  players: {
    athleteId: string;
    name: string;
    countryCode: string;
    countryName: string;
    rank: number | null;
    sets: number[];
    winner: boolean;
  }[];
}

export interface Tournament {
  id: string;
  name: string;
  matches: Match[];
}

export interface MatchesResponse {
  atp: Tournament[];
  wta: Tournament[];
  fetchedAt: string;
}

// Strips diacritics and lowercases for fuzzy name matching
function normName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Builds a "name:<normalised>" → rank map from JeffSackmann's weekly CSVs.
// These cover 2000+ players vs ESPN's 150 cap.
async function fetchExtendedRankings(slug: string): Promise<Map<string, number>> {
  const org = slug === "atp" ? "tennis_atp" : "tennis_wta";
  const base = `https://raw.githubusercontent.com/JeffSackmann/${org}/master/${slug}`;
  try {
    const [rankText, playerText] = await Promise.all([
      fetch(`${base}_rankings_current.csv`, { next: { revalidate: 86400 } }).then((r) => r.text()),
      fetch(`${base}_players.csv`,          { next: { revalidate: 86400 } }).then((r) => r.text()),
    ]);

    // player_id → "firstname lastname" (normalised)
    const playerNames = new Map<string, string>();
    for (const line of playerText.split("\n").slice(1)) {
      const [id, first, last] = line.split(",");
      if (id && first && last) playerNames.set(id, normName(`${first} ${last}`));
    }

    // Find latest date (last non-empty row)
    const rankLines = rankText.split("\n").filter(Boolean);
    const latestDate = rankLines.at(-1)?.split(",")[0] ?? "";

    const map = new Map<string, number>();
    for (const line of rankLines) {
      const [date, rank, playerId] = line.split(",");
      if (date !== latestDate) continue;
      const name = playerNames.get(playerId);
      if (name && rank) map.set(`name:${name}`, Number(rank));
    }
    return map;
  } catch {
    return new Map();
  }
}

async function fetchRankings(slug: string): Promise<Map<string, number>> {
  const [espnRes, extended] = await Promise.all([
    fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/${slug}/rankings`, {
      next: { revalidate: 300 },
    }),
    fetchExtendedRankings(slug),
  ]);

  // Start with extended (name-keyed), then overlay ESPN IDs (top 150, authoritative)
  const map = new Map<string, number>(extended);
  if (espnRes.ok) {
    const data = await espnRes.json();
    for (const rank of data.rankings?.[0]?.ranks ?? []) {
      if (rank.athlete?.id) map.set(rank.athlete.id, rank.current);
    }
  }
  return map;
}

function parseEvent(
  event: { id: string; name: string; groupings: { grouping?: { slug?: string }; competitions: Competition[] }[] },
  rankings: Map<string, number>,
  dateFilter: string,  // "YYYY-MM-DD" — keep only matches whose UTC date matches
  tourPrefix: string   // "mens" | "womens" — keep only matching grouping slugs
): Tournament {
  const matches: Match[] = [];

  for (const grouping of event.groupings ?? []) {
    if (!grouping.grouping?.slug?.startsWith(tourPrefix)) continue;
    for (const comp of grouping.competitions ?? []) {
      // ESPN returns the full tournament draw; filter to just the requested day
      if (!comp.date.startsWith(dateFilter)) continue;

      const [p1, p2] = comp.competitors ?? [];
      if (!p1 || !p2) continue;

      // Skip matches where either player hasn't been determined yet
      const p1Name = p1.athlete?.displayName ?? p1.athlete?.shortName ?? "";
      const p2Name = p2.athlete?.displayName ?? p2.athlete?.shortName ?? "";
      if (!p1Name || !p2Name || p1Name.toLowerCase() === "tbd" || p2Name.toLowerCase() === "tbd") continue;

      matches.push({
        id: comp.id,
        date: comp.date,
        state: comp.status?.type?.state ?? "pre",
        statusDetail: comp.status?.type?.detail ?? comp.status?.type?.description ?? "",
        venue: comp.venue?.fullName ?? "",
        court: comp.venue?.court ?? "",
        summary: comp.notes?.[0]?.text ?? "",
        players: [p1, p2].map((c) => {
          const flagHref = c.athlete?.flag?.href ?? "";
          const codeMatch = flagHref.match(/\/([a-z]+)\.png$/i);
          return {
            athleteId: c.id,
            name: c.athlete?.displayName ?? c.athlete?.shortName ?? "TBD",
            countryCode: codeMatch ? codeMatch[1].toLowerCase() : "",
            countryName: c.athlete?.flag?.alt ?? "",
            rank: rankings.get(c.id)
              ?? rankings.get(`name:${normName(c.athlete?.displayName ?? c.athlete?.shortName ?? "")}`)
              ?? null,
            sets: (c.linescores ?? []).map((ls) => ls.value),
            winner: c.winner ?? false,
          };
        }),
      });
    }
  }

  return { id: event.id, name: event.name, matches };
}

async function fetchTour(slug: string, espnDate: string): Promise<Tournament[]> {
  const scoreUrl = `https://site.api.espn.com/apis/site/v2/sports/tennis/${slug}/scoreboard?dates=${espnDate}`;
  const [scoreRes, rankings] = await Promise.all([
    fetch(scoreUrl, { next: { revalidate: 300 } }),
    fetchRankings(slug),
  ]);
  if (!scoreRes.ok) return [];
  const data = await scoreRes.json();
  // Convert ESPN date "YYYYMMDD" back to "YYYY-MM-DD" for match filtering
  const dateFilter = `${espnDate.slice(0, 4)}-${espnDate.slice(4, 6)}-${espnDate.slice(6, 8)}`;
  const tourPrefix = slug === "atp" ? "mens" : "womens";
  return (data.events ?? [])
    .map((e: Parameters<typeof parseEvent>[0]) => parseEvent(e, rankings, dateFilter, tourPrefix))
    .filter((t: Tournament) => t.matches.length > 0);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // Expect "YYYY-MM-DD" from client; fall back to today UTC
  const dateParam = searchParams.get("date");
  const espnDate = dateParam
    ? dateParam.replace(/-/g, "")
    : new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const [atp, wta] = await Promise.all([fetchTour("atp", espnDate), fetchTour("wta", espnDate)]);

  return NextResponse.json({
    atp,
    wta,
    fetchedAt: new Date().toISOString(),
  } satisfies MatchesResponse);
}
