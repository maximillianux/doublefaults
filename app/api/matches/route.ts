import { NextResponse } from "next/server";

export const revalidate = 300; // re-fetch every 5 minutes

interface Competitor {
  winner: boolean;
  linescores?: { value: number; winner: boolean }[];
  score?: string;
  athlete: {
    displayName: string;
    shortName: string;
    flag?: { alt: string };
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
    country: string;
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

function parseEvent(event: {
  id: string;
  name: string;
  groupings: { competitions: Competition[] }[];
}): Tournament {
  const matches: Match[] = [];

  for (const grouping of event.groupings ?? []) {
    for (const comp of grouping.competitions ?? []) {
      const [p1, p2] = comp.competitors ?? [];
      if (!p1 || !p2) continue;

      const noteText = comp.notes?.[0]?.text ?? "";

      matches.push({
        id: comp.id,
        date: comp.date,
        state: comp.status?.type?.state ?? "pre",
        statusDetail: comp.status?.type?.detail ?? comp.status?.type?.description ?? "",
        venue: comp.venue?.fullName ?? "",
        court: comp.venue?.court ?? "",
        summary: noteText,
        players: [p1, p2].map((c) => ({
          name: c.athlete?.displayName ?? c.athlete?.shortName ?? "TBD",
          country: c.athlete?.flag?.alt ?? "",
          sets: (c.linescores ?? []).map((ls) => ls.value),
          winner: c.winner ?? false,
        })),
      });
    }
  }

  return { id: event.id, name: event.name, matches };
}

async function fetchTour(slug: string): Promise<Tournament[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${slug}/scoreboard`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.events ?? []).map(parseEvent);
}

export async function GET() {
  const [atp, wta] = await Promise.all([fetchTour("atp"), fetchTour("wta")]);

  const body: MatchesResponse = {
    atp,
    wta,
    fetchedAt: new Date().toISOString(),
  };

  return NextResponse.json(body);
}
