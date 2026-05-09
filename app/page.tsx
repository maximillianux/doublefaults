"use client";

import { useEffect, useState, useMemo } from "react";
import type { MatchesResponse, Tournament, Match } from "./api/matches/route";
import type { FormResponse, FormMatch, Surface } from "./api/form/route";

// ─── Country flag ───────────────────────────────────────────────────────────────

const ESPN_TO_ISO2: Record<string, string> = {
  afg:"AF",alb:"AL",alg:"DZ",and:"AD",ang:"AO",arg:"AR",arm:"AM",aruba:"AW",
  aus:"AU",aut:"AT",aze:"AZ",bah:"BS",ban:"BD",bar:"BB",bel:"BE",ben:"BJ",
  ber:"BM",bih:"BA",biz:"BZ",blr:"BY",bol:"BO",bot:"BW",bra:"BR",bru:"BN",
  bul:"BG",can:"CA",cay:"KY",chi:"CL",chn:"CN",civ:"CI",cmr:"CM",col:"CO",
  crc:"CR",cro:"HR",cub:"CU",cze:"CZ",den:"DK",dom:"DO",ecu:"EC",egy:"EG",
  esp:"ES",est:"EE",eth:"ET",fin:"FI",fij:"FJ",fra:"FR",gbr:"GB",geo:"GE",
  ger:"DE",gha:"GH",gre:"GR",gua:"GT",hkg:"HK",hon:"HN",hun:"HU",ina:"ID",
  ind:"IN",irl:"IE",irn:"IR",irq:"IQ",isl:"IS",isr:"IL",ita:"IT",jam:"JM",
  jpn:"JP",kaz:"KZ",ken:"KE",kgz:"KG",kor:"KR",ksa:"SA",kuw:"KW",lat:"LV",
  lba:"LY",lbn:"LB",ltu:"LT",lux:"LU",mac:"MO",mar:"MA",mas:"MY",mda:"MD",
  mex:"MX",mkd:"MK",mlt:"MT",mon:"MC",moz:"MZ",mri:"MU",ned:"NL",nep:"NP",
  ngr:"NG",nic:"NI",nor:"NO",nzl:"NZ",oma:"OM",pak:"PK",pan:"PA",par:"PY",
  per:"PE",phi:"PH",pol:"PL",por:"PT",prk:"KP",pur:"PR",qat:"QA",rom:"RO",
  rsa:"ZA",rus:"RU",rwa:"RW",sen:"SN",sgp:"SG",slo:"SI",slv:"SV",smr:"SM",
  srb:"RS",sri:"LK",sud:"SD",sui:"CH",svk:"SK",swe:"SE",syr:"SY",tah:"PF",
  tan:"TZ",tga:"TO",tha:"TH",tpe:"TW",tri:"TT",tun:"TN",tur:"TR",uae:"AE",
  uga:"UG",ukr:"UA",uru:"UY",usa:"US",uzb:"UZ",ven:"VE",vie:"VN",zim:"ZW",
};

function toFlagEmoji(code: string): string {
  const iso2 = ESPN_TO_ISO2[code.toLowerCase()];
  if (!iso2) return "🏳";
  return [...iso2.toUpperCase()].map((c) =>
    String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)
  ).join("");
}

// ─── Date utils ─────────────────────────────────────────────────────────────────

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildDateRange(): Date[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i - 1);
    return d;
  });
}

// ─── Surface styles ──────────────────────────────────────────────────────────────

const SURFACE: Record<Surface, { label: string; badge: string; dot: string }> = {
  clay:         { label: "Clay",    badge: "bg-orange-950/70 text-orange-300 border border-orange-800/40", dot: "bg-orange-500" },
  grass:        { label: "Grass",   badge: "bg-green-950/70 text-green-300 border border-green-800/40",   dot: "bg-green-500" },
  hard:         { label: "Hard",    badge: "bg-sky-950/70 text-sky-300 border border-sky-800/40",         dot: "bg-sky-500" },
  "indoor-hard":{ label: "Indoor",  badge: "bg-indigo-950/70 text-indigo-300 border border-indigo-800/40",dot: "bg-indigo-400" },
};

// ─── Form dots (mini overview) ───────────────────────────────────────────────────

function FormDots({ form }: { form: FormMatch[] | undefined }) {
  if (form === undefined) {
    return (
      <div className="flex gap-0.5 mt-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="w-2 h-2 rounded-sm bg-white/10 animate-pulse" />
        ))}
      </div>
    );
  }
  if (!form.length) return null;
  return (
    <div className="flex gap-0.5 mt-1">
      {form.map((m, i) => (
        <div
          key={i}
          title={`${m.result} · ${SURFACE[m.surface]?.label ?? m.surface} · vs ${m.opponent}`}
          className={`w-2 h-2 rounded-sm ${m.result === "W" ? "bg-green-500" : "bg-red-500/80"}`}
        />
      ))}
    </div>
  );
}

// ─── Expanded form detail ────────────────────────────────────────────────────────

function PlayerFormDetail({ name, form }: { name: string; form: FormMatch[] | undefined }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{name}</p>
      {form === undefined ? (
        <p className="text-xs text-slate-600 animate-pulse">Loading…</p>
      ) : !form.length ? (
        <p className="text-xs text-slate-600">No recent data</p>
      ) : (
        <div className="space-y-1.5">
          {[...form].reverse().map((m, i) => {
            const surf = SURFACE[m.surface];
            const dateStr = m.date
              ? new Date(m.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "";
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`font-bold w-4 shrink-0 ${m.result === "W" ? "text-green-400" : "text-red-400"}`}>
                  {m.result}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${surf?.badge ?? ""}`}>
                  {surf?.label ?? m.surface}
                </span>
                <span className="text-slate-300 truncate flex-1 min-w-0">
                  vs {m.opponent}
                  {m.opponentRank != null
                    ? <span className="ml-1 text-slate-500">#{m.opponentRank}</span>
                    : <span className="ml-1 text-slate-600">NR</span>}
                </span>
                <span className="text-slate-600 shrink-0 tabular-nums">{dateStr}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Match card ──────────────────────────────────────────────────────────────────

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

function MatchRow({ match, formData }: { match: Match; formData: FormResponse }) {
  const [expanded, setExpanded] = useState(false);
  const [p1, p2] = match.players;
  const st = STATE_LABEL[match.state] ?? STATE_LABEL.pre;

  return (
    <div className="border border-white/10 rounded-lg bg-white/5 overflow-hidden">
      {/* Main info */}
      <div className="p-4 space-y-3">
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
                {p.countryCode && (
                  <span
                    title={p.countryName || p.countryCode.toUpperCase()}
                    className="text-base leading-none shrink-0 cursor-default select-none"
                  >
                    {toFlagEmoji(p.countryCode)}
                  </span>
                )}
                <div className="min-w-0">
                  <span className={`text-sm ${p.winner ? "font-semibold text-white" : "text-slate-300"}`}>
                    <span
                      className="mr-1.5 text-xs font-normal tabular-nums"
                      title={p.rank == null ? "Outside top 150" : undefined}
                    >
                      {p.rank != null
                        ? <span className="text-slate-500">#{p.rank}</span>
                        : <span className="text-slate-600">NR</span>}
                    </span>
                    {p.name}
                    {p.winner && <span className="ml-1 text-yellow-400">✓</span>}
                  </span>
                  <FormDots form={formData[p.athleteId]} />
                </div>
              </div>
              <SetScore sets={p.sets} winner={p.winner} />
            </div>
          ))}
        </div>

        {match.state === "post" && !match.players.some((p) => p.sets.length > 0) && match.summary && (
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

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors border-t border-white/10"
      >
        {expanded ? "Hide" : "Form details"}
        <svg
          className={`w-3 h-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="px-4 pt-3 pb-4 border-t border-white/10 space-y-4 bg-white/[0.02]">
          <PlayerFormDetail name={p1.name} form={formData[p1.athleteId]} />
          <div className="border-t border-white/10" />
          <PlayerFormDetail name={p2.name} form={formData[p2.athleteId]} />
        </div>
      )}
    </div>
  );
}

// ─── Tournament / grid ───────────────────────────────────────────────────────────

function MatchGrid({ matches, label, formData }: { matches: Match[]; label?: string; formData: FormResponse }) {
  if (!matches.length) return null;
  return (
    <div className="space-y-2">
      {label && (
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 pl-1">
          {label}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {matches.map((m) => (
          <MatchRow key={m.id} match={m} formData={formData} />
        ))}
      </div>
    </div>
  );
}

function TournamentSection({ tournament, formData }: { tournament: Tournament; formData: FormResponse }) {
  const live     = tournament.matches.filter((m) => m.state === "in");
  const finished = tournament.matches.filter((m) => m.state === "post");
  const upcoming = tournament.matches.filter((m) => m.state === "pre");
  const showLabels = [live, finished, upcoming].filter((g) => g.length > 0).length > 1;

  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-white/80 border-b border-white/10 pb-2">
        {tournament.name}
        <span className="ml-2 text-xs font-normal text-slate-500">
          {finished.length > 0 && `${finished.length} result${finished.length !== 1 ? "s" : ""}`}
          {finished.length > 0 && upcoming.length > 0 && " · "}
          {upcoming.length > 0 && `${upcoming.length} upcoming`}
          {live.length > 0 && <span className="ml-2 text-green-400">● {live.length} live</span>}
        </span>
      </h2>
      <MatchGrid matches={live}     label={showLabels ? "Live"     : undefined} formData={formData} />
      <MatchGrid matches={finished} label={showLabels ? "Results"  : undefined} formData={formData} />
      <MatchGrid matches={upcoming} label={showLabels ? "Upcoming" : undefined} formData={formData} />
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────────

type Tab = "atp" | "wta";

export default function HomePage() {
  const dates    = useMemo(() => buildDateRange(), []);
  const todayStr = useMemo(() => localDateStr(dates[1]), [dates]);

  const [selectedDate, setSelectedDate] = useState<Date>(dates[1]);
  const [data,     setData]     = useState<MatchesResponse | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(false);
  const [tab,      setTab]      = useState<Tab>("atp");
  const [formData, setFormData] = useState<FormResponse>({});

  useEffect(() => {
    setLoading(true);
    setError(false);
    setData(null);
    setFormData({});

    fetch(`/api/matches?date=${localDateStr(selectedDate)}`)
      .then((r) => r.json())
      .then((d: MatchesResponse) => {
        setData(d);
        setLoading(false);

        const ids = [...d.atp, ...d.wta]
          .flatMap((t) => t.matches.flatMap((m) => m.players.map((p) => p.athleteId)))
          .filter(Boolean);
        const unique = [...new Set(ids)];
        if (!unique.length) return;

        fetch(`/api/form?ids=${unique.join(",")}`)
          .then((r) => r.json())
          .then(setFormData)
          .catch(() => {});
      })
      .catch(() => { setError(true); setLoading(false); });
  }, [selectedDate]);

  const selectedStr = localDateStr(selectedDate);
  const tournaments: Tournament[] = data ? data[tab] : [];
  const totalMatches = tournaments.reduce((sum, t) => sum + t.matches.length, 0);

  return (
    <main className="min-h-screen bg-[#0a0a14] text-white">
      <header className="border-b border-white/10 sticky top-0 z-10 bg-[#0a0a14]/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 pt-4 pb-3 flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight">🎾 DoubleFaults</h1>
          {data && (
            <p className="text-xs text-slate-500">
              Updated {new Date(data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>

        <div className="max-w-6xl mx-auto px-4 pb-3">
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {dates.map((d) => {
              const str = localDateStr(d);
              const isToday    = str === todayStr;
              const isSelected = str === selectedStr;
              return (
                <button
                  key={str}
                  onClick={() => setSelectedDate(d)}
                  className={`flex flex-col items-center px-4 py-2 rounded-xl text-xs font-medium shrink-0 transition-colors ${
                    isSelected
                      ? "bg-yellow-400 text-black"
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-wide font-semibold">
                    {isToday ? "Today" : d.toLocaleDateString("en-US", { weekday: "short" })}
                  </span>
                  <span className="text-lg font-bold leading-tight">{d.getDate()}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 flex gap-1 pb-3">
          {(["atp", "wta"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                tab === t ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-10">
        {error && (
          <p className="text-red-400 text-center py-12">Failed to load matches. Please refresh.</p>
        )}
        {loading && !error && (
          <div className="flex items-center justify-center py-24">
            <p className="text-slate-400 animate-pulse">Loading matches…</p>
          </div>
        )}
        {!loading && !error && tournaments.length === 0 && (
          <div className="text-center py-24 text-slate-500">
            <p className="text-4xl mb-4">🎾</p>
            <p className="text-lg font-medium">No {tab.toUpperCase()} matches scheduled</p>
            <p className="text-sm mt-1">
              {selectedStr > todayStr
                ? "Schedule may not be confirmed yet — check back closer to the date."
                : "Try a different date or tour."}
            </p>
          </div>
        )}
        {!loading && !error && tournaments.length > 0 && (
          <>
            <p className="text-sm text-slate-400">
              {tournaments.length} tournament{tournaments.length !== 1 ? "s" : ""} · {totalMatches} match{totalMatches !== 1 ? "es" : ""}
            </p>
            {tournaments.map((t) => (
              <TournamentSection key={t.id} tournament={t} formData={formData} />
            ))}
          </>
        )}
      </div>
    </main>
  );
}
