import { useEffect, useState } from 'react';
import { Zap, Eye, Timer, AlertCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useApi } from '../hooks/useApi';
import { getTimeSince } from '../utils/date';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';

interface RenderPipelineMetrics {
  successRate: { preview: number; full: number };
  errorBreakdown: Array<{ error_code: string; count: number; last_seen: string }>;
  stepLatency: Array<{ step: string; avg_ms: number; sample_count: number }>;
  dailyTrend: Array<{ date: string; success: number; failed: number }>;
}

const stepLabels: Record<string, string> = {
  LYRICS: 'Lyrics',
  MUSIC_PLAN: 'Music Plan',
  INSTRUMENTAL: 'Instrumental',
  GUIDE_VOCAL: 'Guide Vocal',
  VOICE_CONVERT: 'Voice Convert',
  MIX: 'Mix',
  WATERMARK: 'Watermark',
};

// Target p95 success rate per spec (docs/spec-audit.md)
const HEALTH_THRESHOLD = 95;

function getHealthStatus(rate: number): { label: string; color: string; barColor: string } {
  const isHealthy = rate >= HEALTH_THRESHOLD;
  return {
    label: isHealthy ? 'Healthy' : 'Needs Attention',
    color: isHealthy ? 'text-emerald-400' : 'text-amber-400',
    barColor: isHealthy ? 'bg-emerald-500' : 'bg-amber-500',
  };
}

export function Pipeline() {
  const { get, loading, error } = useApi();
  const [metrics, setMetrics] = useState<RenderPipelineMetrics | null>(null);

  useEffect(() => {
    get<RenderPipelineMetrics>('/metrics/render-pipeline')
      .then(setMetrics)
      .catch(console.error);
  }, [get]);

  if (loading && !metrics) {
    return <LoadingState message="Loading pipeline metrics..." />;
  }

  if (error) {
    return <ErrorState message={`Error loading metrics: ${error}`} />;
  }

  if (!metrics) return null;

  const maxLatency = Math.max(...metrics.stepLatency.map(s => s.avg_ms), 1);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Render Pipeline Health</h1>
        <p className="text-slate-400 text-sm font-data">
          Monitoring render success rates, latency, and errors
        </p>
      </div>

      {/* Success Rate Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Preview Renders */}
        <div className="card rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 flex items-center justify-center">
              <Eye className="w-5 h-5 text-sky-400" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Preview Renders</h3>
              <p className="text-sm text-slate-400">Quick preview generation</p>
            </div>
          </div>
          {(() => {
            const status = getHealthStatus(metrics.successRate.preview);
            return (
              <>
                <div className="flex items-end gap-3 mb-3">
                  <span className="text-4xl font-bold text-white font-data">
                    {metrics.successRate.preview.toFixed(1)}%
                  </span>
                  <span className={`text-sm mb-1 ${status.color}`}>{status.label}</span>
                </div>
                <div
                  className="h-3 bg-slate-800 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={Math.round(metrics.successRate.preview)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Preview render success rate: ${metrics.successRate.preview.toFixed(1)}%`}
                >
                  <div
                    className={`h-full transition-all duration-500 ${status.barColor}`}
                    style={{ width: `${metrics.successRate.preview}%` }}
                  />
                </div>
              </>
            );
          })()}
        </div>

        {/* Full Renders */}
        <div className="card rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Full Renders</h3>
              <p className="text-sm text-slate-400">Complete song generation</p>
            </div>
          </div>
          {(() => {
            const status = getHealthStatus(metrics.successRate.full);
            return (
              <>
                <div className="flex items-end gap-3 mb-3">
                  <span className="text-4xl font-bold text-white font-data">
                    {metrics.successRate.full.toFixed(1)}%
                  </span>
                  <span className={`text-sm mb-1 ${status.color}`}>{status.label}</span>
                </div>
                <div
                  className="h-3 bg-slate-800 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={Math.round(metrics.successRate.full)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Full render success rate: ${metrics.successRate.full.toFixed(1)}%`}
                >
                  <div
                    className={`h-full transition-all duration-500 ${status.barColor}`}
                    style={{ width: `${metrics.successRate.full}%` }}
                  />
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Daily Trend Chart */}
      {metrics.dailyTrend.length > 0 && (
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            Daily Success/Failure Trend
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.dailyTrend}>
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
                <Legend
                  wrapperStyle={{ color: '#94a3b8' }}
                />
                <Bar dataKey="success" fill="#10b981" name="Success" radius={[4, 4, 0, 0]} />
                <Bar dataKey="failed" fill="#f43f5e" name="Failed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Step Latency */}
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Timer className="w-5 h-5 text-amber-400" aria-hidden="true" />
            Step Latency (Avg)
          </h2>
          <div className="space-y-4">
            {metrics.stepLatency.map(({ step, avg_ms, sample_count }) => {
              const avgPct = (avg_ms / maxLatency) * 100;

              return (
                <div key={step}>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-300">{stepLabels[step] || step}</span>
                    <span className="font-data text-slate-400">
                      <span className="text-sky-400">{(avg_ms / 1000).toFixed(1)}s</span>
                      <span className="text-slate-500 ml-2">({sample_count} samples)</span>
                    </span>
                  </div>
                  <div
                    className="h-2 bg-slate-800 rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.round(avgPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${stepLabels[step] || step} latency: ${(avg_ms / 1000).toFixed(1)} seconds`}
                  >
                    <div
                      className="h-full bg-sky-500 rounded-full transition-all duration-500"
                      style={{ width: `${avgPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Error Breakdown */}
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-400" aria-hidden="true" />
            Error Breakdown (Top 5)
          </h2>
          {metrics.errorBreakdown.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-500">
              No errors in the selected period
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {metrics.errorBreakdown.slice(0, 5).map(({ error_code, count, last_seen }) => (
                <div key={error_code} className="py-3 flex items-center justify-between">
                  <div>
                    <span className="text-rose-400 font-data text-sm">{error_code}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-white font-data font-medium">{count}</span>
                    <span className="text-slate-500 text-sm">{getTimeSince(last_seen)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
