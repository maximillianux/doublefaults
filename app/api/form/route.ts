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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

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

// ─── Surface lookup (ESPN eventlog path) ───────────────────────────────────────

const GRASS_KEYWORDS = [
  "wimbledon","queen's","queens club","halle","s-hertogenbosch","eastbourne",
  "newport","mallorca","boss open","stuttgart","nottingham","cinch championship",
  "libema","terra wortmann","rosmalen","antalya",
];
const CLAY_KEYWORDS = [
  "roland garros","french open","monte-carlo","monte carlo","internazionali","bnl",
  "mutua madrid","barcelona","hamburg","rio open","rio de janeiro","buenos aires",
  "argentina open","chile open","santiago","cordoba","córdoba","brasil open",
  "brasilia","tiriac","bucharest","budapest","bastad","nordea","umag","croatia open",
  "kitzbuhel","generali open","gstaad","swiss open","estoril","marrakech","casablanca",
  "bmw open","munich","lyon","geneva","istanbul","gijon","srpska","houston","clay court",
];

function surfaceFromEventName(name: string, indoor: boolean): Surface {
  const n = name.toLowerCase();
  if (GRASS_KEYWORDS.some((k) => n.includes(k))) return "grass";
  if (CLAY_KEYWORDS.some((k) => n.includes(k))) return "clay";
  return indoor ? "indoor-hard" : "hard";
}

// Convert JeffSackmann surface string to our Surface type
function surfaceFromCSV(raw: string): Surface {
  switch (raw.toLowerCase()) {
    case "clay":   return "clay";
    case "grass":  return "grass";
    case "carpet": return "indoor-hard";
    default:       return "hard";
  }
}

// ─── JeffSackmann challenger CSV ───────────────────────────────────────────────

function parseMatchCSV(text: string, wantedNorms: Set<string>): Map<string, FormMatch[]> {
  const map = new Map<string, FormMatch[]>();
  const lines = text.split("\n");
  if (lines.length < 2) return map;

  const headers = lines[0].split(",");
  const ci = (h: string) => headers.indexOf(h);

  const iWinnerName = ci("winner_name");
  const iLoserName  = ci("loser_name");
  const iDate       = ci("tourney_date");
  const iSurface    = ci("surface");
  const iTourney    = ci("tourney_name");
  const iWinnerRank = ci("winner_rank");
  const iLoserRank  = ci("loser_rank");

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 10) continue;

    const wName  = cols[iWinnerName] ?? "";
    const lName  = cols[iLoserName]  ?? "";
    const wNorm  = normName(wName);
    const lNorm  = normName(lName);

    const hasW = wantedNorms.has(wNorm);
    const hasL = wantedNorms.has(lNorm);
    if (!hasW && !hasL) continue;

    const raw  = cols[iDate] ?? "";
    const date = raw.length === 8
      ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`
      : raw;

    const surface  = surfaceFromCSV(cols[iSurface] ?? "");
    const tourney  = cols[iTourney] ?? "";

    if (hasW) {
      const entry: FormMatch = {
        result: "W", date, tournament: tourney, surface,
        opponent: lName,
        opponentRank: parseInt(cols[iLoserRank] ?? "") || null,
      };
      const arr = map.get(wNorm) ?? [];
      arr.push(entry);
      map.set(wNorm, arr);
    }
    if (hasL) {
      const entry: FormMatch = {
        result: "L", date, tournament: tourney, surface,
        opponent: wName,
        opponentRank: parseInt(cols[iWinnerRank] ?? "") || null,
      };
      const arr = map.get(lNorm) ?? [];
      arr.push(entry);
      map.set(lNorm, arr);
    }
  }

  return map;
}

async function fetchJSChallengerMatches(wantedNorms: Set<string>): Promise<Map<string, FormMatch[]>> {
  const year = new Date().getFullYear();
  // ATP challenger only — WTA has no equivalent file in JeffSackmann's repo
  const urls = [
    `https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_qual_chall_${year}.csv`,
    `https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_qual_chall_${year - 1}.csv`,
  ];

  const combined = new Map<string, FormMatch[]>();

  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { next: { revalidate: 86400 } });
        if (!res.ok) return;
        const parsed = parseMatchCSV(await res.text(), wantedNorms);
        for (const [norm, matches] of parsed) {
          const existing = combined.get(norm) ?? [];
          combined.set(norm, [...existing, ...matches]);
        }
      } catch { /* best-effort */ }
    })
  );

  return combined;
}

// ─── Rankings ──────────────────────────────────────────────────────────────────

async function fetchAllRankings(): Promise<Map<string, number>> {
  const [atpRes, wtaRes] = await Promise.all([
    fetch("https://site.api.espn.com/apis/site/v2/sports/tennis/atp/rankings", { next: { revalidate: 300 } }),
    fetch("https://site.api.espn.com/apis/site/v2/sports/tennis/wta/rankings", { next: { revalidate: 300 } }),
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

// ─── ESPN eventlog fetch ────────────────────────────────────────────────────────

type EventlogItem = { event?: { $ref: string }; competition?: { $ref: string } };

async function fetchSeasonItems(athleteId: string, season: number): Promise<EventlogItem[]> {
  const all: EventlogItem[] = [];
  let page = 1;
  const pageSize = 25;
  const ttl = season < new Date().getFullYear() ? 86400 : 300;

  while (all.length < 50) {
    const res = await fetch(
      `https://sports.core.api.espn.com/v2/sports/tennis/athletes/${athleteId}/eventlog` +
        `?season=${season}&limit=${pageSize}&page=${page}`,
      { next: { revalidate: ttl } }
    );
    if (!res.ok) break;
    const data = await res.json();
    const items: EventlogItem[] = data?.events?.items ?? [];
    all.push(...items);
    if (page >= (data?.events?.pageCount ?? 1) || items.length < pageSize) break;
    page++;
  }
  return all;
}

interface CoreCompetitor { id: string; name: string; winner: boolean }
interface CoreCompetition { date?: string; venue?: { indoor?: boolean }; competitors?: CoreCompetitor[] }

async function fetchESPNForm(
  athleteId: string,
  rankings: Map<string, number>
): Promise<FormMatch[]> {
  const year = new Date().getFullYear();
  const current = await fetchSeasonItems(athleteId, year);
  const items = current.length >= 20 ? current : [...current, ...await fetchSeasonItems(athleteId, year - 1)];
  if (!items.length) return [];

  const uniqueEventRefs = [...new Set(items.map((it) => it.event?.["$ref"]).filter(Boolean))] as string[];

  const [compResults, eventEntries] = await Promise.all([
    concurrentMap(items, 8, async (item) => {
      const ref = item.competition?.["$ref"];
      if (!ref) return null;
      try {
        const res = await fetch(ref, { next: { revalidate: 300 } });
        return res.ok ? (await res.json() as CoreCompetition) : null;
      } catch { return null; }
    }),
    concurrentMap(uniqueEventRefs, 4, async (ref) => {
      try {
        const res = await fetch(ref, { next: { revalidate: 86400 } });
        if (!res.ok) return [ref, ""] as [string, string];
        const data = await res.json();
        return [ref, (data.name as string) ?? ""] as [string, string];
      } catch { return [ref, ""] as [string, string]; }
    }),
  ]);

  const eventNameMap = Object.fromEntries(eventEntries);
  const matches: FormMatch[] = [];

  for (let i = 0; i < items.length; i++) {
    const comp = compResults[i];
    if (!comp) continue;
    const eventName = eventNameMap[items[i].event?.["$ref"] ?? ""] ?? "";
    const indoor    = comp.venue?.indoor ?? false;
    const competitors = comp.competitors ?? [];
    const us       = competitors.find((c) => String(c.id) === athleteId);
    const opponent = competitors.find((c) => String(c.id) !== athleteId);
    if (!us || !opponent) continue;
    if (!us.winner && !opponent.winner) continue;
    if (opponent.name?.toLowerCase() === "bye") continue;

    matches.push({
      result: us.winner ? "W" : "L",
      date: comp.date ?? "",
      tournament: eventName,
      surface: surfaceFromEventName(eventName, indoor),
      opponent: opponent.name ?? "Unknown",
      opponentRank: rankings.get(String(opponent.id)) ?? null,
    });
  }

  return matches;
}

// ─── Combine ESPN + JeffSackmann ───────────────────────────────────────────────

async function fetchForm(
  athleteId: string,
  playerName: string,
  rankings: Map<string, number>,
  jsData: Map<string, FormMatch[]>
): Promise<FormMatch[]> {
  const espn = await fetchESPNForm(athleteId, rankings);

  // Supplement with challenger matches the ESPN eventlog doesn't cover
  const norm       = normName(playerName);
  const challenger = jsData.get(norm) ?? [];

  // Merge ESPN (authoritative, correct dates) + JeffSackmann (challenger coverage).
  // Dedup by (opponent, year) — JeffSackmann uses tourney_date not match date so
  // we can't compare dates directly. ESPN entries take priority (added first).
  const seen = new Set<string>();
  const merged: FormMatch[] = [];
  for (const m of [...espn, ...challenger]) {
    const key = `${normName(m.opponent)}:${m.date.slice(0, 4)}`;
    if (!seen.has(key)) { seen.add(key); merged.push(m); }
  }

  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return merged.slice(0, 10);
}

// ─── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // Expect ?players=id:encodedName,id:encodedName,...
  const players = (searchParams.get("players") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60)
    .map((s) => {
      const colon = s.indexOf(":");
      return { id: s.slice(0, colon), name: decodeURIComponent(s.slice(colon + 1)) };
    })
    .filter((p) => p.id && p.name);

  if (!players.length) return NextResponse.json({});

  const wantedNorms = new Set(players.map((p) => normName(p.name)));

  const [rankings, jsData] = await Promise.all([
    fetchAllRankings(),
    fetchJSChallengerMatches(wantedNorms),
  ]);

  const entries = await concurrentMap(players, 6, async ({ id, name }) =>
    [id, await fetchForm(id, name, rankings, jsData)] as [string, FormMatch[]]
  );

  return NextResponse.json(Object.fromEntries(entries) satisfies FormResponse);
}
