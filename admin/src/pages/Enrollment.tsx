import { useEffect, useState } from 'react';
import { Mic, CheckCircle, Star, TrendingUp, AlertCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useApi } from '../hooks/useApi';
import { KPICard } from '../components/KPICard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';

interface EnrollmentMetrics {
  totalEnrollments: number;
  completedEnrollments: number;
  completionRate: number;
  averageQualityScore: number;
  qualityDistribution: Array<{ bucket: string; count: number }>;
  abandonmentByStep: Array<{ step: string; count: number }>;
  last7Days: Array<{ date: string; started: number; completed: number }>;
}

const qualityColors: Record<string, string> = {
  'Excellent (85+)': 'bg-emerald-500',
  'Good (70-84)': 'bg-sky-500',
  'Fair (50-69)': 'bg-amber-500',
  'Poor (<50)': 'bg-rose-500',
};

const stepLabels: Record<string, string> = {
  RECORDING: 'Recording',
  UPLOADING: 'Uploading',
  QC_PROCESSING: 'QC Processing',
  EMBEDDING: 'Embedding',
  VERIFYING: 'Verifying',
};

export function Enrollment() {
  const { get, loading, error } = useApi();
  const [metrics, setMetrics] = useState<EnrollmentMetrics | null>(null);

  useEffect(() => {
    get<EnrollmentMetrics>('/metrics/enrollment')
      .then(setMetrics)
      .catch(console.error);
  }, [get]);

  if (loading && !metrics) {
    return <LoadingState message="Loading enrollment metrics..." />;
  }

  if (error) {
    return <ErrorState message={`Error loading metrics: ${error}`} />;
  }

  if (!metrics) return null;

  // Fallback to 1 prevents division by zero in percentage calculations
  const maxQuality = Math.max(...metrics.qualityDistribution.map(d => d.count), 1);
  const maxAbandonment = Math.max(...metrics.abandonmentByStep.map(d => d.count), 1);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Voice Enrollment Metrics</h1>
        <p className="text-slate-400 text-sm font-data">
          Tracking enrollment funnel performance and quality scores
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <KPICard
          title="Total Started"
          value={metrics.totalEnrollments.toLocaleString()}
          icon={Mic}
          accentColor="sky"
        />
        <KPICard
          title="Completed"
          value={metrics.completedEnrollments.toLocaleString()}
          icon={CheckCircle}
          accentColor="emerald"
        />
        <KPICard
          title="Avg Quality"
          value={metrics.averageQualityScore.toFixed(1)}
          subtitle="Score out of 100"
          icon={Star}
          trend={metrics.averageQualityScore >= 70 ? 'up' : 'down'}
          accentColor="amber"
        />
        <KPICard
          title="Completion Rate"
          value={`${metrics.completionRate.toFixed(1)}%`}
          icon={TrendingUp}
          trend={metrics.completionRate >= 70 ? 'up' : 'down'}
          accentColor="rose"
        />
      </div>

      {/* 7-Day Trend Chart */}
      {metrics.last7Days.length > 0 && (
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-sky-400" aria-hidden="true" />
            7-Day Enrollment Trend
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics.last7Days}>
                <defs>
                  <linearGradient id="startedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="completedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  stroke="#64748b"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { weekday: 'short' })}
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#f8fafc',
                  }}
                  labelFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <Area
                  type="monotone"
                  dataKey="started"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  fill="url(#startedGradient)"
                  name="Started"
                />
                <Area
                  type="monotone"
                  dataKey="completed"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#completedGradient)"
                  name="Completed"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-sky-500" />
              <span className="text-slate-400">Started</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-slate-400">Completed</span>
            </div>
          </div>
        </div>
      )}

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quality Distribution */}
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-400" aria-hidden="true" />
            Quality Distribution
          </h2>
          <div className="space-y-3">
            {metrics.qualityDistribution.map(({ bucket, count }) => {
              const percentage = (count / maxQuality) * 100;
              const totalCount = metrics.qualityDistribution.reduce((sum, d) => sum + d.count, 0);
              const pct = totalCount > 0 ? ((count / totalCount) * 100).toFixed(0) : '0';

              return (
                <div key={bucket} className="group">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-300">{bucket}</span>
                    <span className="font-data text-white">{pct}%</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${qualityColors[bucket] || 'bg-slate-500'} transition-all duration-500`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Abandonment by Step */}
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-400" aria-hidden="true" />
            Abandonment by Step
          </h2>
          <div className="space-y-3">
            {metrics.abandonmentByStep.map(({ step, count }) => {
              const percentage = (count / maxAbandonment) * 100;

              return (
                <div key={step} className="group">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-300">{stepLabels[step] || step}</span>
                    <span className="font-data text-white">{count}</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-rose-500 to-rose-400 transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
