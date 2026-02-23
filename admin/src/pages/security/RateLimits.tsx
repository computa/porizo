import { useEffect, useState, useCallback } from 'react';
import { Gauge, RefreshCw, AlertTriangle, Filter, RotateCcw } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';

interface RateLimit {
  user_id: string;
  user_email: string | null;
  action_type: string;
  window_start_ms: number;
  window_seconds: number;
  count: number;
  limit_count: number;
}

const actionTypes = [
  'enrollment_start',
  'render_preview',
  'track_create',
  'reroll',
];

export function RateLimits() {
  const { get, post, loading, error } = useApi();
  const [limits, setLimits] = useState<RateLimit[]>([]);
  const [actionTypeFilter, setActionTypeFilter] = useState('');
  const [nearLimitOnly, setNearLimitOnly] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);

  const fetchLimits = useCallback(async () => {
    const params = new URLSearchParams();
    if (actionTypeFilter) params.append('actionType', actionTypeFilter);
    if (nearLimitOnly) params.append('nearLimit', 'true');
    params.append('limit', '50');

    const queryString = params.toString();
    const data = await get<{ limits: RateLimit[] }>(`/security/rate-limits${queryString ? `?${queryString}` : ''}`);
    setLimits(data.limits);
  }, [get, actionTypeFilter, nearLimitOnly]);

  useEffect(() => {
    fetchLimits().catch(console.error);
  }, [fetchLimits]);

  const handleReset = async (userId: string, actionType: string) => {
    const key = `${userId}-${actionType}`;
    setResetting(key);
    try {
      await post(`/security/rate-limits/${encodeURIComponent(userId)}/${encodeURIComponent(actionType)}/reset`, {
        reason: 'Admin dashboard reset',
      });
      await fetchLimits();
    } catch (err) {
      console.error('Failed to reset rate limit:', err);
    } finally {
      setResetting(null);
    }
  };

  const formatActionType = (type: string) => {
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const getUsagePercent = (count: number, limit: number) => {
    if (limit === 0) return 0;
    return Math.min(100, (count / limit) * 100);
  };

  const getUsageColor = (percent: number) => {
    if (percent >= 80) return { bar: 'bg-rose-500', text: 'text-rose-400' };
    if (percent >= 50) return { bar: 'bg-amber-500', text: 'text-amber-400' };
    return { bar: 'bg-slate-500', text: 'text-slate-400' };
  };

  const formatWindow = (seconds: number) => {
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 60)}m`;
  };

  // Stats
  const atLimit = limits.filter(l => l.count >= l.limit_count).length;
  const nearLimit = limits.filter(l => (l.count / l.limit_count) >= 0.8 && l.count < l.limit_count).length;

  if (loading && limits.length === 0) {
    return <LoadingState message="Loading rate limits..." />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/20 flex items-center justify-center">
            <Gauge className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Rate Limits</h1>
            <p className="text-sm text-slate-400">Current rate limit status per user</p>
          </div>
        </div>
        <button
          onClick={() => fetchLimits().catch(console.error)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Banner */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            Users at Limit
          </div>
          <div className="text-2xl font-bold text-white font-data">{atLimit}</div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Users Near Limit (&gt;80%)
          </div>
          <div className="text-2xl font-bold text-white font-data">{nearLimit}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 p-4 bg-slate-800/30 rounded-xl border border-slate-700/50">
        <Filter className="w-5 h-5 text-slate-400" />
        <select
          value={actionTypeFilter}
          onChange={(e) => setActionTypeFilter(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
        >
          <option value="">All Action Types</option>
          {actionTypes.map(type => (
            <option key={type} value={type}>{formatActionType(type)}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={nearLimitOnly}
            onChange={(e) => setNearLimitOnly(e.target.checked)}
            className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-rose-500 focus:ring-rose-500/50"
          />
          Near limit only (&gt;80%)
        </label>
      </div>

      {/* Rate Limits Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50 bg-slate-900/30">
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">User</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Action Type</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Usage</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Window</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {limits.map((limit) => {
                const percent = getUsagePercent(limit.count, limit.limit_count);
                const colors = getUsageColor(percent);
                const key = `${limit.user_id}-${limit.action_type}`;
                return (
                  <tr key={key} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4">
                      <div className="text-sm text-slate-200">
                        {limit.user_email || <span className="text-slate-500 italic">Unknown</span>}
                      </div>
                      <div className="text-xs text-slate-500 font-data truncate max-w-[150px]">{limit.user_id}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-1 bg-slate-700/50 text-slate-300 rounded text-sm">
                        {formatActionType(limit.action_type)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-32 h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${colors.bar} transition-all`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className={`text-sm font-data ${colors.text}`}>
                          {limit.count}/{limit.limit_count}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400 font-data">
                      {formatWindow(limit.window_seconds)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleReset(limit.user_id, limit.action_type)}
                        disabled={resetting === key}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className={`w-3.5 h-3.5 ${resetting === key ? 'animate-spin' : ''}`} />
                        Reset
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {limits.length === 0 && (
          <div className="flex items-center justify-center py-12 text-slate-500">
            No active rate limits found
          </div>
        )}
      </div>
    </div>
  );
}
