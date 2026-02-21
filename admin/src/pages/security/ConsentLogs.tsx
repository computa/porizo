import { useEffect, useState, useCallback } from 'react';
import { ClipboardCheck, RefreshCw, AlertTriangle, Filter, CheckCircle, Clock, XCircle } from 'lucide-react';
import { useApi } from '../../hooks/useApi';

interface ConsentLog {
  id: string;
  user_id: string;
  user_email: string | null;
  consent_version: string | null;
  consent_at: string;
  status: string;
}

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; bg: string }> = {
  completed: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  active: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  pending: { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  expired: { icon: XCircle, color: 'text-slate-400', bg: 'bg-slate-500/10' },
  revoked: { icon: XCircle, color: 'text-rose-400', bg: 'bg-rose-500/10' },
};

const consentVersions = ['v1.0', 'v1.1', 'v2.0'];

export function ConsentLogs() {
  const { get, loading, error } = useApi();
  const [consents, setConsents] = useState<ConsentLog[]>([]);
  const [versionFilter, setVersionFilter] = useState('');

  const fetchConsents = useCallback(async () => {
    const params = new URLSearchParams();
    if (versionFilter) params.append('consentVersion', versionFilter);
    params.append('limit', '50');

    const queryString = params.toString();
    const data = await get<{ consents: ConsentLog[] }>(`/security/consent-logs${queryString ? `?${queryString}` : ''}`);
    setConsents(data.consents);
  }, [get, versionFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchConsents().catch(console.error);
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchConsents]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading && consents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading consent logs...
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
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center">
            <ClipboardCheck className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Consent Logs</h1>
            <p className="text-sm text-slate-400">Voice profile consent records</p>
          </div>
        </div>
        <button
          onClick={() => fetchConsents().catch(console.error)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* NEW Badge */}
      <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
        <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded font-medium">NEW</span>
        <span className="text-sm text-emerald-300">Voice profile consent tracking for compliance and audit purposes.</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 p-4 bg-slate-800/30 rounded-xl border border-slate-700/50">
        <Filter className="w-5 h-5 text-slate-400" />
        <select
          value={versionFilter}
          onChange={(e) => setVersionFilter(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
        >
          <option value="">All Versions</option>
          {consentVersions.map(version => (
            <option key={version} value={version}>{version}</option>
          ))}
        </select>
      </div>

      {/* Consents Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50 bg-slate-900/30">
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">User</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Consent Version</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Consent Date</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Profile Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {consents.map((consent) => {
                const config = statusConfig[consent.status] || statusConfig.pending;
                const Icon = config.icon;
                return (
                  <tr key={consent.id} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4">
                      <div className="text-sm text-slate-200">
                        {consent.user_email || <span className="text-slate-500 italic">Unknown</span>}
                      </div>
                      <div className="text-xs text-slate-500 font-data">{consent.user_id}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-1 bg-slate-700/50 text-slate-300 rounded text-sm font-data">
                        {consent.consent_version || 'N/A'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400 font-data">
                      {formatDate(consent.consent_at)}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${config.bg} ${config.color}`}>
                        <Icon className="w-3 h-3" />
                        {consent.status.charAt(0).toUpperCase() + consent.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {consents.length === 0 && (
          <div className="flex items-center justify-center py-12 text-slate-500">
            No consent records found
          </div>
        )}
      </div>
    </div>
  );
}
