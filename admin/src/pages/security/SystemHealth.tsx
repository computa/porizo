import { useEffect, useState, useCallback } from 'react';
import { Activity, RefreshCw, AlertTriangle, CheckCircle, Clock, Server, Zap, Shield, Lock, TrendingUp } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { getTimeSince, formatDateTimeSec } from '../../utils/date';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';

interface HealthData {
  jobs: {
    running: number;
    queued: number;
    failed: number;
  };
  dlqCount: number;
  recentErrors: Array<{
    workflow_type: string;
    step: string;
    count: number;
  }>;
  checkedAt: string;
}

interface ProviderStatus {
  provider_name: string;
  status: 'active' | 'paused' | 'disabled';
  paused_at: string | null;
  pause_reason: string | null;
  updated_at: string;
}

interface QueueStatus {
  queue_name: string;
  status: 'active' | 'paused' | 'draining';
  paused_at: string | null;
  pause_reason: string | null;
  updated_at: string;
}

interface ProvidersResponse {
  providers: ProviderStatus[];
}

interface QueuesResponse {
  queues: QueueStatus[];
}

interface RiskMetrics {
  distribution: Array<{ level: string; count: number }>;
  lockedAccounts: number;
  recentEscalations: Array<{ user_id: string; to: string; reason: string; date: string }>;
}

const riskLevelColors: Record<string, { bg: string; bar: string }> = {
  low: { bg: 'bg-emerald-500/10', bar: 'bg-emerald-500' },
  medium: { bg: 'bg-amber-500/10', bar: 'bg-amber-500' },
  high: { bg: 'bg-rose-500/10', bar: 'bg-rose-500' },
  blocked: { bg: 'bg-slate-600/20', bar: 'bg-slate-600' },
};

interface StatusStyle {
  label: string;
  badgeColor: string;
  dotColor: string;
}

function getStatusStyle(status: string): StatusStyle {
  switch (status) {
    case 'active':
      return {
        label: 'Active',
        badgeColor: 'bg-emerald-500/10 text-emerald-400',
        dotColor: 'bg-emerald-400',
      };
    case 'paused':
      return {
        label: 'Paused',
        badgeColor: 'bg-amber-500/10 text-amber-400',
        dotColor: 'bg-amber-400',
      };
    case 'draining':
      return {
        label: 'Draining',
        badgeColor: 'bg-sky-500/10 text-sky-400',
        dotColor: 'bg-sky-400',
      };
    default:
      return {
        label: 'Disabled',
        badgeColor: 'bg-rose-500/10 text-rose-400',
        dotColor: 'bg-rose-400',
      };
  }
}

export function SystemHealth() {
  const { get, loading, error } = useApi();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [queues, setQueues] = useState<QueueStatus[]>([]);
  const [riskMetrics, setRiskMetrics] = useState<RiskMetrics | null>(null);

  const fetchHealth = useCallback(async () => {
    const [healthData, providerData, queueData, riskData] = await Promise.all([
      get<HealthData>('/security/health'),
      get<ProvidersResponse>('/providers'),
      get<QueuesResponse>('/queues'),
      get<RiskMetrics>('/security/risk-metrics').catch(() => null),
    ]);
    setHealth(healthData);
    setProviders(providerData.providers || []);
    setQueues(queueData.queues || []);
    if (riskData) setRiskMetrics(riskData);
  }, [get]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchHealth().catch(console.error);
    }, 0);
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => fetchHealth().catch(console.error), 30000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [fetchHealth]);

  if (loading && !health) {
    return <LoadingState message="Loading health status..." />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <Activity className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">System Health</h1>
            <p className="text-sm text-slate-400">Operational status and job metrics</p>
          </div>
        </div>
        <button
          onClick={() => fetchHealth().catch(console.error)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Banner */}
      {health && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <Zap className="w-4 h-4 text-sky-400" />
              Jobs Running
            </div>
            <div className="text-2xl font-bold text-white font-data">{health.jobs.running}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <Clock className="w-4 h-4 text-amber-400" />
              Jobs Queued
            </div>
            <div className="text-2xl font-bold text-white font-data">{health.jobs.queued}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              Failed (24h)
            </div>
            <div className="text-2xl font-bold text-white font-data">{health.jobs.failed}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              DLQ Pending
            </div>
            <div className="text-2xl font-bold text-white font-data">{health.dlqCount}</div>
          </div>
        </div>
      )}

      {/* User Risk Distribution */}
      {riskMetrics && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-400" />
            User Risk Distribution
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Risk Levels */}
            <div className="space-y-3">
              {riskMetrics.distribution.map(({ level, count }) => {
                const total = riskMetrics.distribution.reduce((sum, d) => sum + d.count, 0);
                const percentage = total > 0 ? (count / total) * 100 : 0;
                const colors = riskLevelColors[level] || riskLevelColors.medium;

                return (
                  <div key={level}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-300 capitalize">{level}</span>
                      <span className="font-data text-white">{percentage.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${colors.bar} transition-all duration-500`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recent Escalations */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" aria-hidden="true" />
                Recent Escalations
              </h3>
              {riskMetrics.recentEscalations.length === 0 ? (
                <div className="text-slate-500 text-sm">No recent escalations</div>
              ) : (
                <div className="space-y-2">
                  {riskMetrics.recentEscalations.slice(0, 5).map((esc, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2 px-3 bg-slate-900/50 rounded-lg">
                      <span className="text-slate-300 font-data text-sm truncate max-w-[120px]">
                        {esc.user_id.slice(0, 8)}...
                      </span>
                      <div className="flex items-center gap-3">
                        <span className={`text-sm px-2 py-0.5 rounded ${
                          esc.to === 'high' || esc.to === 'blocked' ? 'text-rose-400 bg-rose-500/10' : 'text-amber-400 bg-amber-500/10'
                        }`}>
                          {esc.to}
                        </span>
                        <span className="text-slate-500 text-xs">{getTimeSince(esc.date)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {riskMetrics.lockedAccounts > 0 && (
                <div className="mt-4 flex items-center gap-2 text-sm text-rose-400 bg-rose-500/10 px-3 py-2 rounded-lg">
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  {riskMetrics.lockedAccounts} locked account{riskMetrics.lockedAccounts > 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Provider Status */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-slate-400" />
          Provider Status
        </h2>
        {providers.length === 0 ? (
          <div className="text-slate-500 text-sm">No provider status data available.</div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {providers.map((provider) => {
              const style = getStatusStyle(provider.status);
              return (
                <div
                  key={provider.provider_name}
                  className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700/30"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${style.dotColor} animate-pulse`} />
                    <div>
                      <span className="text-slate-200 capitalize">{provider.provider_name}</span>
                      {provider.pause_reason && (
                        <p className="text-xs text-slate-500 mt-1">{provider.pause_reason}</p>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${style.badgeColor}`}>
                    {style.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Queue Status */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-slate-400" />
          Queue Status
        </h2>
        {queues.length === 0 ? (
          <div className="text-slate-500 text-sm">No queue status data available.</div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {queues.map((queue) => {
              const style = getStatusStyle(queue.status);
              return (
                <div
                  key={queue.queue_name}
                  className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700/30"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${style.dotColor} animate-pulse`} />
                    <div>
                      <span className="text-slate-200">{queue.queue_name}</span>
                      {queue.pause_reason && (
                        <p className="text-xs text-slate-500 mt-1">{queue.pause_reason}</p>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${style.badgeColor}`}>
                    {style.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Errors */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-rose-400" />
          Recent Errors (24h)
        </h2>
        {health && health.recentErrors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Workflow</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Step</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {health.recentErrors.map((err, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4 text-sm text-slate-300 font-data">{err.workflow_type}</td>
                    <td className="py-3 px-4 text-sm text-slate-400 font-data">{err.step || '-'}</td>
                    <td className="py-3 px-4 text-sm text-right">
                      <span className="px-2 py-1 bg-rose-500/10 text-rose-400 rounded font-data">
                        {err.count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-slate-500">
            <CheckCircle className="w-5 h-5 mr-2 text-emerald-400" />
            No errors in the last 24 hours
          </div>
        )}
      </div>

      {/* Last Checked */}
      {health && (
        <div className="text-center text-xs text-slate-500">
          Last checked: {formatDateTimeSec(health.checkedAt)}
        </div>
      )}
    </div>
  );
}
