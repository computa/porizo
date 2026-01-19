import { useEffect, useState, useCallback } from 'react';
import { Shield, RefreshCw, AlertTriangle, CheckCircle, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { formatDateTime } from '../utils/date';

interface ModerationItem {
  id: string;
  track_id: string;
  moderation_status: string;
  moderation_reason: string;
  moderation_details_json: string | null;
  title: string;
  occasion: string;
  recipient_name: string;
  user_id: string;
  created_at: string;
}

interface ModerationResponse {
  items: ModerationItem[];
}

export function Moderation() {
  const { get, post, loading, error } = useApi();
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [overrideReason, setOverrideReason] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    const data = await get<ModerationResponse>('/moderation/queue?limit=100');
    setItems(data.items);
  }, [get]);

  useEffect(() => {
    fetchItems().catch(console.error);
  }, [fetchItems]);

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

  const handleOverride = async (versionId: string) => {
    const reason = overrideReason[versionId]?.trim();
    if (!reason) {
      return;
    }

    setProcessing(versionId);
    try {
      await post(`/moderation/${versionId}/override`, { reason });
      await fetchItems();
      setOverrideReason(prev => {
        const next = { ...prev };
        delete next[versionId];
        return next;
      });
    } catch (err) {
      console.error('Failed to override moderation:', err);
    } finally {
      setProcessing(null);
    }
  };

  const parseDetails = (detailsJson: string | null) => {
    if (!detailsJson) return null;
    try {
      return JSON.parse(detailsJson);
    } catch {
      return null;
    }
  };

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading moderation queue...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-rose-400 bg-rose-500/10 px-4 py-3 rounded-lg">
          <AlertTriangle className="w-5 h-5" />
          Error loading moderation queue: {error}
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
            <Shield className="w-7 h-7 text-rose-400" />
            Moderation Queue
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Content blocked by automated moderation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
            items.length > 0 ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
          }`}>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
          <button
            onClick={() => fetchItems()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Empty State */}
      {items.length === 0 ? (
        <div className="card rounded-xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Queue is Clear</h2>
          <p className="text-slate-400">No content awaiting moderation review</p>
        </div>
      ) : (
        /* Items List */
        <div className="space-y-3">
          {items.map((item) => {
            const isExpanded = expandedIds.has(item.id);
            const details = parseDetails(item.moderation_details_json);

            return (
              <div key={item.id} className="card rounded-xl overflow-hidden">
                {/* Header Row */}
                <div
                  className="p-4 flex items-center gap-4 cursor-pointer hover:bg-slate-800/30"
                  onClick={() => toggleExpand(item.id)}
                >
                  <button className="text-slate-500 hover:text-slate-300">
                    {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                  </button>

                  <div className="w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center">
                    <X className="w-5 h-5 text-rose-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="text-white font-medium">{item.title}</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-400 text-sm">{item.occasion}</span>
                    </div>
                    <p className="text-slate-500 text-sm mt-0.5">
                      For: {item.recipient_name}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-rose-400 text-sm font-medium">{item.moderation_reason}</p>
                    <p className="text-slate-500 text-xs">{formatDateTime(item.created_at)}</p>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-slate-700/50 p-4 bg-slate-900/50">
                    <div className="grid grid-cols-2 gap-6 mb-4">
                      <div>
                        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                          Track Info
                        </h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-slate-500">Track ID</span>
                            <span className="font-data text-slate-300">{item.track_id}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Version ID</span>
                            <span className="font-data text-slate-300">{item.id}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">User ID</span>
                            <span className="font-data text-slate-300">{item.user_id}</span>
                          </div>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                          Block Reason
                        </h4>
                        <p className="text-sm text-rose-300 bg-rose-500/5 p-3 rounded-lg border border-rose-500/10">
                          {item.moderation_reason}
                        </p>
                      </div>
                    </div>

                    {details && (
                      <div className="mb-4">
                        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                          Detection Details
                        </h4>
                        <pre className="text-xs font-data text-slate-400 bg-slate-800/50 p-3 rounded-lg overflow-x-auto">
                          {JSON.stringify(details, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Override Action */}
                    <div className="border-t border-slate-700/50 pt-4">
                      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                        Admin Override
                      </h4>
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          value={overrideReason[item.id] || ''}
                          onChange={(e) => setOverrideReason(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Reason for override (required)..."
                          className="flex-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOverride(item.id);
                          }}
                          disabled={processing === item.id || !overrideReason[item.id]?.trim()}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <CheckCircle className={`w-4 h-4 ${processing === item.id ? 'animate-pulse' : ''}`} />
                          Approve
                        </button>
                      </div>
                      <p className="text-slate-500 text-xs mt-2">
                        Override will mark content as approved and create an audit log entry.
                      </p>
                    </div>
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
