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
    name: string;
    countryCode: string; // 3-letter ESPN code, e.g. "srb"
    countryName: string; // full name, e.g. "Serbia"
    rank: number | null;  // ATP/WTA ranking, null if unranked
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

async function fetchRankings(slug: string): Promise<Map<string, number>> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${slug}/rankings`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return new Map();
  const data = await res.json();
  const map = new Map<string, number>();
  for (const rank of data.rankings?.[0]?.ranks ?? []) {
    if (rank.athlete?.id) map.set(rank.athlete.id, rank.current);
  }
  return map;
}

function parseEvent(
  event: { id: string; name: string; groupings: { competitions: Competition[] }[] },
  rankings: Map<string, number>
): Tournament {
  const matches: Match[] = [];

  for (const grouping of event.groupings ?? []) {
    for (const comp of grouping.competitions ?? []) {
      const [p1, p2] = comp.competitors ?? [];
      if (!p1 || !p2) continue;

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
            name: c.athlete?.displayName ?? c.athlete?.shortName ?? "TBD",
            countryCode: codeMatch ? codeMatch[1].toLowerCase() : "",
            countryName: c.athlete?.flag?.alt ?? "",
            rank: rankings.get(c.id) ?? null,
            sets: (c.linescores ?? []).map((ls) => ls.value),
            winner: c.winner ?? false,
          };
        }),
      });
    }
  }

  return { id: event.id, name: event.name, matches };
}

async function fetchTour(slug: string): Promise<Tournament[]> {
  const [scoreRes, rankings] = await Promise.all([
    fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/${slug}/scoreboard`, {
      next: { revalidate: 300 },
    }),
    fetchRankings(slug),
  ]);
  if (!scoreRes.ok) return [];
  const data = await scoreRes.json();
  return (data.events ?? []).map((e: Parameters<typeof parseEvent>[0]) =>
    parseEvent(e, rankings)
  );
}

export async function GET() {
  const [atp, wta] = await Promise.all([fetchTour("atp"), fetchTour("wta")]);

  return NextResponse.json({
    atp,
    wta,
    fetchedAt: new Date().toISOString(),
  } satisfies MatchesResponse);
}
