import { ArrowRight } from 'lucide-react';

interface FunnelCardProps {
  from: string;
  to: string;
  startUsers: number;
  convertedUsers: number;
  conversionRate: string; // server returns "12.34"
  emphasis?: 'standard' | 'hero';
}

/**
 * A single hop in the funnel strip. `emphasis="hero"` variant gets larger
 * type + a gold accent, used for the north-star conversion
 * (create_completed → first_song_completed).
 *
 * States:
 *   - startUsers === 0  → dim card with "—" in the rate field (pre-cutover)
 *   - startUsers > 0, convertedUsers === 0 → honest "0.0%" (not hidden)
 *   - startUsers > 0, convertedUsers > 0 → "N.N%" green-ish
 */
export function FunnelCard({
  from,
  to,
  startUsers,
  convertedUsers,
  conversionRate,
  emphasis = 'standard',
}: FunnelCardProps) {
  const isHero = emphasis === 'hero';
  const isEmpty = startUsers === 0;

  const rateValue = isEmpty ? '—' : `${parseFloat(conversionRate).toFixed(1)}%`;
  const rateColor = isEmpty
    ? 'text-slate-500'
    : parseFloat(conversionRate) > 0
      ? 'text-emerald-400'
      : 'text-slate-400';

  const containerClasses = [
    'card rounded-xl transition-colors',
    isHero ? 'p-6 ring-1 ring-amber-500/30' : 'p-5',
    isEmpty ? 'opacity-60' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClasses}>
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
        <span className="truncate font-medium">{from}</span>
        <ArrowRight className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className={`truncate font-medium ${isHero ? 'text-amber-400' : ''}`}>
          {to}
        </span>
      </div>
      <p
        className={`font-bold font-data ${rateColor} ${isHero ? 'text-4xl' : 'text-3xl'}`}
      >
        {rateValue}
      </p>
      <p className="text-slate-500 text-xs mt-2">
        {convertedUsers.toLocaleString()} of {startUsers.toLocaleString()} users
      </p>
    </div>
  );
}
