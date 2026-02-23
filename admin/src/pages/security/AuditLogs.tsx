import { useEffect, useState, useCallback, Fragment } from 'react';
import { FileText, RefreshCw, Filter, ChevronDown, ChevronRight } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { formatDateTimeSec } from '../../utils/date';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';

interface AuditLog {
  id: string;
  user_id: string | null;
  admin_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata_json: string | null;
  created_at: string;
}

const resourceTypes = ['user', 'job', 'track_version', 'share_token', 'config'];

export function AuditLogs() {
  const { get, loading, error } = useApi();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const fetchLogs = useCallback(async () => {
    const params = new URLSearchParams();
    if (actionFilter) params.append('action', actionFilter);
    if (resourceTypeFilter) params.append('resourceType', resourceTypeFilter);
    params.append('limit', '50');

    const queryString = params.toString();
    const data = await get<{ logs: AuditLog[] }>(`/security/audit-logs${queryString ? `?${queryString}` : ''}`);
    setLogs(data.logs);
  }, [get, actionFilter, resourceTypeFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLogs().catch(console.error);
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchLogs]);

  const formatAction = (action: string) => {
    return action.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const toggleExpand = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatMetadata = (json: string | null) => {
    if (!json) return null;
    try {
      return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      return json;
    }
  };

  const getActionColor = (action: string) => {
    if (action.includes('delete') || action.includes('lock') || action.includes('block')) {
      return 'text-rose-400 bg-rose-500/10';
    }
    if (action.includes('create') || action.includes('unlock') || action.includes('approve')) {
      return 'text-emerald-400 bg-emerald-500/10';
    }
    if (action.includes('update') || action.includes('reset')) {
      return 'text-amber-400 bg-amber-500/10';
    }
    return 'text-slate-400 bg-slate-500/10';
  };

  if (loading && logs.length === 0) {
    return <LoadingState message="Loading audit logs..." />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
            <FileText className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Audit Logs</h1>
            <p className="text-sm text-slate-400">Admin action history and audit trail</p>
          </div>
        </div>
        <button
          onClick={() => fetchLogs().catch(console.error)}
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
        <span className="text-sm text-emerald-300">Admin audit trail now available - all administrative actions are logged.</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 p-4 bg-slate-800/30 rounded-xl border border-slate-700/50">
        <Filter className="w-5 h-5 text-slate-400" />
        <input
          type="text"
          placeholder="Search by action..."
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="flex-1 max-w-xs bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
        />
        <select
          value={resourceTypeFilter}
          onChange={(e) => setResourceTypeFilter(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
        >
          <option value="">All Resource Types</option>
          {resourceTypes.map(type => (
            <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      {/* Logs Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50 bg-slate-900/30">
                <th className="w-8"></th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Timestamp</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Admin</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Action</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Resource Type</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Resource ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {logs.map((log) => (
                <Fragment key={log.id}>
                  <tr className="hover:bg-slate-800/30 cursor-pointer" onClick={() => toggleExpand(log.id)}>
                    <td className="py-3 px-2">
                      {log.metadata_json && (
                        expandedRows.has(log.id) ? (
                          <ChevronDown className="w-4 h-4 text-slate-500" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-500" />
                        )
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400 font-data whitespace-nowrap">
                      {formatDateTimeSec(log.created_at)}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-200">
                      {log.admin_email || <span className="text-slate-500 italic">System</span>}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-medium ${getActionColor(log.action)}`}>
                        {formatAction(log.action)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400">
                      {log.resource_type || '-'}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-500 font-data">
                      {log.resource_id ? (
                        <span className="truncate max-w-[150px] inline-block" title={log.resource_id}>
                          {log.resource_id.length > 20 ? log.resource_id.slice(0, 20) + '...' : log.resource_id}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
                  {expandedRows.has(log.id) && log.metadata_json && (
                    <tr className="bg-slate-900/50">
                      <td colSpan={6} className="py-3 px-8">
                        <div className="text-xs text-slate-400 mb-1">Metadata:</div>
                        <pre className="text-xs text-slate-300 bg-slate-800/50 p-3 rounded-lg overflow-x-auto font-mono">
                          {formatMetadata(log.metadata_json)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {logs.length === 0 && (
          <div className="flex items-center justify-center py-12 text-slate-500">
            No audit logs found
          </div>
        )}
      </div>
    </div>
  );
}
