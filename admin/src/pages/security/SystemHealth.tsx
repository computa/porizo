import { useEffect, useState, useCallback } from 'react';
import { Activity, RefreshCw, AlertTriangle, CheckCircle, Clock, Server, Zap } from 'lucide-react';
import { useApi } from '../../hooks/useApi';

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

const providerStatus = [
  { name: 'Suno (Music)', status: 'operational', latency: '~45s' },
  { name: 'ElevenLabs (TTS)', status: 'operational', latency: '~3s' },
  { name: 'Seed-VC (Voice)', status: 'operational', latency: '~12s' },
  { name: 'Replicate (Embedding)', status: 'operational', latency: '~5s' },
];

export function SystemHealth() {
  const { get, loading, error } = useApi();
  const [health, setHealth] = useState<HealthData | null>(null);

  const fetchHealth = useCallback(async () => {
    const data = await get<HealthData>('/security/health');
    setHealth(data);
  }, [get]);

  useEffect(() => {
    fetchHealth().catch(console.error);
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => fetchHealth().catch(console.error), 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  if (loading && !health) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading health status...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-rose-400">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      </div>
    );
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

      {/* Provider Status */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-slate-400" />
          Provider Status
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {providerStatus.map((provider) => (
            <div
              key={provider.name}
              className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700/30"
            >
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  provider.status === 'operational' ? 'bg-emerald-400' : 'bg-rose-400'
                } animate-pulse`} />
                <span className="text-slate-200">{provider.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 font-data">{provider.latency}</span>
                <span className={`text-xs px-2 py-1 rounded ${
                  provider.status === 'operational'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-rose-500/10 text-rose-400'
                }`}>
                  {provider.status === 'operational' ? 'Operational' : 'Degraded'}
                </span>
              </div>
            </div>
          ))}
        </div>
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
          Last checked: {formatDate(health.checkedAt)}
        </div>
      )}
    </div>
  );
}
