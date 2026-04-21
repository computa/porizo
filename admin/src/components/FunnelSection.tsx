import { useEffect, useState } from 'react';
import { Activity, Flame, Repeat } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { FunnelCard } from './FunnelCard';

// Time range is shared across all Growth sections for consistent admin scoping.
// Per-section scoping is a follow-up if admins ask for it.

interface FunnelStep {
  from: string;
  to: string;
  startUsers: number;
  convertedUsers: number;
  conversionRate: string;
}

interface FunnelResponse {
  days: number;
  steps: FunnelStep[];
}

interface EventCount {
  event_name: string;
  count: number;
}

interface OverviewResponse {
  days: number;
  counts: EventCount[];
}

interface DailyBucket {
  date: string;
  count: number;
}

interface DailyResponse {
  event_name: string;
  days: number;
  byDay: DailyBucket[];
}

interface FunnelSectionProps {
  days: number;
}

// The north-star hop — create_completed → first_song_completed — gets hero
// emphasis. That's the moment the core value prop actually delivers.
const HERO_HOP_INDEX = 2;

export function FunnelSection({ days }: FunnelSectionProps) {
  const { get } = useApi();
  const [funnel, setFunnel] = useState<FunnelResponse | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    Promise.all([
      get<FunnelResponse>(`/dashboard/analytics/funnel?days=${days}`),
      get<OverviewResponse>(`/dashboard/analytics/overview?days=${days}`),
      get<DailyResponse>(`/dashboard/analytics/daily/first_song_completed?days=${days}`),
    ])
      .then(([f, o, d]) => {
        if (cancelled) return;
        setFunnel(f);
        setOverview(o);
        setDaily(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [get, days]);

  const sessionResumedCount =
    overview?.counts.find((c) => c.event_name === 'session_resumed')?.count ?? 0;

  const totalFunnelStartUsers = funnel?.steps[0]?.startUsers ?? 0;
  const allHopsEmpty =
    !!funnel && funnel.steps.every((s) => s.startUsers === 0);

  if (isLoading && !funnel) {
    return <FunnelSkeleton />;
  }

  if (error) {
    return (
      <section className="card rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-2">Funnel</h2>
        <p className="text-rose-400 text-sm">
          Couldn't load funnel data: {error}
        </p>
      </section>
    );
  }

  if (allHopsEmpty) {
    return (
      <section className="card rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-2">
          <Flame className="w-5 h-5 text-amber-400" /> Funnel
        </h2>
        <p className="text-slate-400 text-sm">
          Funnel data will appear once iOS events start flowing. Check back in a few hours.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2">
        <Flame className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-semibold text-white">Funnel</h2>
        <span className="text-xs text-slate-500">
          Last {days} days · {totalFunnelStartUsers.toLocaleString()} users entered
        </span>
      </div>

      {/* Funnel steps strip — hop #2 gets hero emphasis (north-star). */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {funnel?.steps.map((step, i) => (
          <FunnelCard
            key={`${step.from}-${step.to}`}
            from={step.from}
            to={step.to}
            startUsers={step.startUsers}
            convertedUsers={step.convertedUsers}
            conversionRate={step.conversionRate}
            emphasis={i === HERO_HOP_INDEX ? 'hero' : 'standard'}
          />
        ))}
      </div>

      {/* Retention row — separate from funnel hops because a session is a
          re-engagement signal, not a conversion step. */}
      <div className="card rounded-xl p-5 flex items-center gap-4">
        <div className="p-2 rounded-lg bg-sky-500/10">
          <Repeat className="w-5 h-5 text-sky-400" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-400">Active sessions</p>
          <p className="text-2xl font-bold text-white font-data">
            {sessionResumedCount.toLocaleString()}
          </p>
          <p className="text-slate-500 text-xs mt-1">
            session_resumed events · last {days} days
          </p>
        </div>
      </div>

      {/* Daily series for the north-star conversion. */}
      {daily && daily.byDay.length > 0 && (
        <div className="card rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-amber-400" />
            <p className="text-sm font-medium text-slate-400">
              Completed songs per day
            </p>
          </div>
          <DailyBarStrip byDay={daily.byDay} />
        </div>
      )}

      {/* Event counts table — full enumeration sorted DESC. */}
      {overview && overview.counts.length > 0 && (
        <div className="card rounded-xl p-5">
          <p className="text-sm font-medium text-slate-400 mb-3">
            All events · last {days} days
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs uppercase tracking-wide">
                <th className="text-left font-medium py-2">Event</th>
                <th className="text-right font-medium py-2">Count</th>
              </tr>
            </thead>
            <tbody>
              {overview.counts.map((row) => (
                <tr key={row.event_name} className="border-t border-slate-700/40">
                  <td className="py-2 text-slate-200">{row.event_name}</td>
                  <td className="py-2 text-right font-data text-white">
                    {row.count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FunnelSkeleton() {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2">
        <Flame className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-semibold text-white">Funnel</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="card rounded-xl p-5 h-32 animate-pulse bg-slate-800/30"
          />
        ))}
      </div>
      <p className="text-slate-500 text-sm">Loading funnel…</p>
    </section>
  );
}

function DailyBarStrip({ byDay }: { byDay: DailyBucket[] }) {
  const max = Math.max(1, ...byDay.map((b) => b.count));
  return (
    <div className="flex items-end gap-1 h-20">
      {byDay.map((b) => {
        const heightPct = Math.max(4, Math.round((b.count / max) * 100));
        return (
          <div
            key={b.date}
            className="flex-1 flex flex-col items-center justify-end group"
            title={`${b.date}: ${b.count}`}
          >
            <div
              className="w-full bg-amber-500/60 group-hover:bg-amber-400 rounded-t-sm transition-colors"
              style={{ height: `${heightPct}%` }}
              aria-label={`${b.date}: ${b.count} first songs completed`}
            />
          </div>
        );
      })}
    </div>
  );
}
