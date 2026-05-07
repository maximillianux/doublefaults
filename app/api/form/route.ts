import { NextResponse } from "next/server";

export type FormResult = "W" | "L";
export type FormResponse = Record<string, FormResult[]>; // athleteId → last 10 results (oldest→newest)

async function fetchForm(athleteId: string): Promise<FormResult[]> {
  // 1. Fetch event log for the current season
  const logUrl = `https://sports.core.api.espn.com/v2/sports/tennis/athletes/${athleteId}/eventlog?season=2026&limit=10`;
  const logRes = await fetch(logUrl, { next: { revalidate: 300 } });
  if (!logRes.ok) return [];

  const log = await logRes.json();
  const items: { competitor: { $ref: string } }[] = log?.events?.items ?? [];
  if (!items.length) return [];

  // 2. Fetch all competitor refs in parallel (past results cached 24h, they never change)
  const results = await Promise.all(
    items.map(async (item) => {
      try {
        const ref = item.competitor?.["$ref"];
        if (!ref) return null;
        const res = await fetch(ref, { next: { revalidate: 86400 } });
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.winner === "boolean" ? (data.winner ? "W" : "L") : null;
      } catch {
        return null;
      }
    })
  );

  // Filter nulls, reverse so oldest is first
  return (results.filter(Boolean) as FormResult[]).reverse();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ids = (searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 60);

  if (!ids.length) return NextResponse.json({});

  const entries = await Promise.all(
    ids.map(async (id) => [id, await fetchForm(id)] as [string, FormResult[]])
  );

  const body: FormResponse = Object.fromEntries(entries);
  return NextResponse.json(body);
}
