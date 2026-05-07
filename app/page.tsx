"use client";

import { useEffect, useState } from "react";
import type { MatchesResponse, Tournament, Match } from "./api/matches/route";

const STATE_LABEL: Record<string, { label: string; color: string }> = {
  pre:  { label: "Scheduled", color: "text-slate-400" },
  in:   { label: "Live",      color: "text-green-400" },
  post: { label: "Final",     color: "text-slate-500" },
};

function SetScore({ sets, winner }: { sets: number[]; winner: boolean }) {
  if (!sets.length) return null;
  return (
    <span className={`font-mono text-sm tabular-nums ${winner ? "font-bold" : "text-slate-400"}`}>
      {sets.join(" ")}
    </span>
  );
}

function MatchRow({ match }: { match: Match }) {
  const [p1, p2] = match.players;
  const st = STATE_LABEL[match.state] ?? STATE_LABEL.pre;

  return (
    <div className="border border-white/10 rounded-lg p-4 space-y-3 bg-white/5 hover:bg-white/10 transition-colors">
      <div className="flex items-center justify-between text-xs">
        <span className={`font-semibold uppercase tracking-wide ${st.color}`}>
          {match.state === "in" ? "● Live" : st.label}
          {match.statusDetail && match.state !== "pre" ? ` · ${match.statusDetail}` : ""}
        </span>
        {(match.court || match.venue) && (
          <span className="text-slate-500">
            {[match.court, match.venue].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {[p1, p2].map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {p.country && (
                <span className="text-xs text-slate-400 w-5 shrink-0">{p.country}</span>
              )}
              <span className={`truncate text-sm ${p.winner ? "font-semibold text-white" : "text-slate-300"}`}>
                {p.name}
                {p.winner && <span className="ml-1 text-yellow-400">✓</span>}
              </span>
            </div>
            <SetScore sets={p.sets} winner={p.winner} />
          </div>
        ))}
      </div>

      {match.summary && match.state === "post" && (
        <p className="text-xs text-slate-500 pt-1 border-t border-white/10 truncate">
          {match.summary}
        </p>
      )}

      {match.state === "pre" && match.date && (
        <p className="text-xs text-slate-500">
          {new Date(match.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}

function TournamentSection({ tournament }: { tournament: Tournament }) {
  const live = tournament.matches.filter((m) => m.state === "in");
  const upcoming = tournament.matches.filter((m) => m.state === "pre");
  const finished = tournament.matches.filter((m) => m.state === "post");
  const ordered = [...live, ...upcoming, ...finished];

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-white/80 border-b border-white/10 pb-2">
        {tournament.name}
        <span className="ml-2 text-xs font-normal text-slate-500">
          {tournament.matches.length} match{tournament.matches.length !== 1 ? "es" : ""}
          {live.length > 0 && (
            <span className="ml-2 text-green-400">● {live.length} live</span>
          )}
        </span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((m) => (
          <MatchRow key={m.id} match={m} />
        ))}
      </div>
    </section>
  );
}

type Tab = "atp" | "wta";

export default function HomePage() {
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("atp");

  useEffect(() => {
    fetch("/api/matches")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const tournaments: Tournament[] = data ? data[tab] : [];
  const totalMatches = tournaments.reduce((sum, t) => sum + t.matches.length, 0);

  return (
    <main className="min-h-screen bg-[#0a0a14] text-white">
      <header className="border-b border-white/10 sticky top-0 z-10 bg-[#0a0a14]/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              🎾 DoubleFaults
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">{today}</p>
          </div>
          {data && (
            <p className="text-xs text-slate-500">
              Updated {new Date(data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>

        <div className="max-w-6xl mx-auto px-4 flex gap-1 pb-3">
          {(["atp", "wta"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                tab === t
                  ? "bg-yellow-400 text-black"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-10">
        {error && (
          <p className="text-red-400 text-center py-12">
            Failed to load matches. Please refresh.
          </p>
        )}

        {!data && !error && (
          <div className="flex items-center justify-center py-24">
            <p className="text-slate-400 animate-pulse">Loading matches...</p>
          </div>
        )}

        {data && tournaments.length === 0 && (
          <div className="text-center py-24 text-slate-500">
            <p className="text-4xl mb-4">🎾</p>
            <p className="text-lg font-medium">No {tab.toUpperCase()} matches today</p>
            <p className="text-sm mt-1">Check back later or try the other tour.</p>
          </div>
        )}

        {data && tournaments.length > 0 && (
          <>
            <p className="text-sm text-slate-400">
              {tournaments.length} tournament{tournaments.length !== 1 ? "s" : ""} · {totalMatches} match{totalMatches !== 1 ? "es" : ""}
            </p>
            {tournaments.map((t) => (
              <TournamentSection key={t.id} tournament={t} />
            ))}
          </>
        )}
      </div>
    </main>
  );
}
