import { AlertTriangle, Clock, Gift, LoaderCircle, PackageCheck } from 'lucide-react';
import type { GiftOverview } from './types';

interface Props {
  overview: GiftOverview | null;
}

const cards = [
  { key: 'scheduled_count', label: 'Scheduled', icon: Gift, color: 'text-sky-400' },
  { key: 'due_soon_count', label: 'Due Soon', icon: Clock, color: 'text-amber-400' },
  { key: 'overdue_count', label: 'Overdue', icon: AlertTriangle, color: 'text-rose-400' },
  { key: 'partial_count', label: 'Partial', icon: LoaderCircle, color: 'text-violet-400' },
  { key: 'failed_count', label: 'Failed', icon: AlertTriangle, color: 'text-rose-400' },
  { key: 'sent_last_24h', label: 'Sent 24h', icon: PackageCheck, color: 'text-emerald-400' },
] as const;

export function GiftOverviewCards({ overview }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {cards.map(({ key, label, icon: Icon, color }) => (
        <div key={key} className="card rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">{label}</p>
              <p className="text-3xl font-bold text-white font-data">
                {overview ? (overview[key] ?? 0).toLocaleString() : '—'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-800/60">
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
