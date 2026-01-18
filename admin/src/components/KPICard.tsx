import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  accentColor?: 'rose' | 'emerald' | 'amber' | 'sky';
}

const accentStyles = {
  rose: {
    bg: 'bg-rose-500/10',
    icon: 'text-rose-400',
    glow: 'glow-rose-sm',
  },
  emerald: {
    bg: 'bg-emerald-500/10',
    icon: 'text-emerald-400',
    glow: '',
  },
  amber: {
    bg: 'bg-amber-500/10',
    icon: 'text-amber-400',
    glow: '',
  },
  sky: {
    bg: 'bg-sky-500/10',
    icon: 'text-sky-400',
    glow: '',
  },
};

export function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accentColor = 'rose',
}: KPICardProps) {
  const styles = accentStyles[accentColor];

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-rose-400' : 'text-slate-500';

  return (
    <div className="card rounded-xl p-5 hover:border-slate-600/30 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-400 mb-1">{title}</p>
          <p className="text-3xl font-bold text-white font-data">{value}</p>
          {subtitle && (
            <p className={`text-sm mt-2 flex items-center gap-1 ${trendColor}`}>
              {trend && <TrendIcon className="w-4 h-4" aria-hidden="true" />}
              {subtitle}
            </p>
          )}
        </div>
        <div className={`p-3 rounded-lg ${styles.bg} ${styles.glow}`}>
          <Icon className={`w-6 h-6 ${styles.icon}`} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
