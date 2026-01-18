import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, Trash2, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { useApi } from '../hooks/useApi';

interface DLQEntry {
  id: string;
  job_id: string;
  workflow_type: string;
  step: string;
  error_code: string;
  error_message: string;
  payload_json: string;
  created_at: string;
  reprocessed_at: string | null;
}

interface DLQResponse {
  entries: DLQEntry[];
}

export function DLQ() {
  const { get, post, loading, error } = useApi();
  const [entries, setEntries] = useState<DLQEntry[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [reprocessing, setReprocessing] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    const data = await get<DLQResponse>('/dlq?limit=100');
    setEntries(data.entries);
  }, [get]);

  useEffect(() => {
    fetchEntries().catch(console.error);
  }, [fetchEntries]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleReprocess = async (entryId: string) => {
    setReprocessing(entryId);
    try {
      await post(`/dlq/${entryId}/reprocess`, {});
      await fetchEntries();
    } catch (err) {
      console.error('Failed to reprocess DLQ entry:', err);
    } finally {
      setReprocessing(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getAgeSeverity = (dateStr: string) => {
    const age = Date.now() - new Date(dateStr).getTime();
    const hours = age / (1000 * 60 * 60);
    if (hours > 24) return 'text-rose-400';
    if (hours > 6) return 'text-amber-400';
    return 'text-slate-400';
  };

  const parsePayload = (payloadJson: string) => {
    try {
      return JSON.parse(payloadJson);
    } catch {
      return null;
    }
  };

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading DLQ entries...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-rose-400 bg-rose-500/10 px-4 py-3 rounded-lg">
          <AlertTriangle className="w-5 h-5" />
          Error loading DLQ: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <AlertTriangle className="w-7 h-7 text-amber-400" />
            Dead Letter Queue
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Failed jobs requiring manual intervention
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
            entries.length > 0 ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
          }`}>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
          <button
            onClick={() => fetchEntries()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Empty State */}
      {entries.length === 0 ? (
        <div className="card rounded-xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Queue is Empty</h2>
          <p className="text-slate-400">No failed jobs requiring attention</p>
        </div>
      ) : (
        /* Entries List */
        <div className="space-y-3">
          {entries.map((entry) => {
            const isExpanded = expandedIds.has(entry.id);
            const payload = parsePayload(entry.payload_json);

            return (
              <div key={entry.id} className="card rounded-xl overflow-hidden">
                {/* Header Row */}
                <div
                  className="p-4 flex items-center gap-4 cursor-pointer hover:bg-slate-800/30"
                  onClick={() => toggleExpand(entry.id)}
                >
                  <button className="text-slate-500 hover:text-slate-300">
                    {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="font-data text-rose-400 text-sm">{entry.error_code}</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-300">{entry.workflow_type}</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-400 text-sm">{entry.step}</span>
                    </div>
                    <p className="text-slate-400 text-sm mt-1 truncate">{entry.error_message}</p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className={`flex items-center gap-1.5 text-sm ${getAgeSeverity(entry.created_at)}`}>
                      <Clock className="w-4 h-4" />
                      {formatDate(entry.created_at)}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReprocess(entry.id);
                      }}
                      disabled={reprocessing === entry.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className={`w-4 h-4 ${reprocessing === entry.id ? 'animate-spin' : ''}`} />
                      Reprocess
                    </button>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-slate-700/50 p-4 bg-slate-900/50">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                          Error Details
                        </h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-slate-500">Job ID</span>
                            <span className="font-data text-slate-300">{entry.job_id}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Entry ID</span>
                            <span className="font-data text-slate-300">{entry.id}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Workflow</span>
                            <span className="text-slate-300">{entry.workflow_type}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Step</span>
                            <span className="text-slate-300">{entry.step}</span>
                          </div>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                          Error Message
                        </h4>
                        <p className="text-sm text-rose-300 bg-rose-500/5 p-3 rounded-lg border border-rose-500/10">
                          {entry.error_message}
                        </p>
                      </div>
                    </div>

                    {payload && (
                      <div className="mt-4">
                        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                          Payload
                        </h4>
                        <pre className="text-xs font-data text-slate-400 bg-slate-800/50 p-3 rounded-lg overflow-x-auto">
                          {JSON.stringify(payload, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
