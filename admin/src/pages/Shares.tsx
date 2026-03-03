import { useEffect, useState, useCallback } from 'react';
import { Share2, RefreshCw, Link2, Eye, Clock, Smartphone, BookOpen, ShieldAlert, RotateCcw, Ban } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getTimeSince } from '../utils/date';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';

interface ShareToken {
  id: string;
  track_id: string;
  track_title: string;
  status: string;
  access_count: number;
  bound_device_id: string | null;
  stream_key: string;
  created_at: string;
  expires_at: string | null;
}

interface PoemShareToken {
  id: string;
  poem_id: string;
  poem_title: string;
  recipient_name: string;
  creator_id: string;
  status: string;
  claim_pin: string | null;
  claim_attempts: number;
  access_count: number;
  bound_user_id: string | null;
  allow_save: boolean;
  claim_policy: string | null;
  created_at: string;
  expires_at: string | null;
}

interface SharesResponse {
  shares: ShareToken[];
}

const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  expired: { bg: 'bg-slate-700/50', text: 'text-slate-400' },
  revoked: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
};

export function Shares() {
  const { get, post, loading, error } = useApi();
  const [shares, setShares] = useState<ShareToken[]>([]);
  const [poemShares, setPoemShares] = useState<PoemShareToken[]>([]);
  const [rebindData, setRebindData] = useState<Record<string, { deviceId: string; reason: string }>>({});
  const [rebinding, setRebinding] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    try {
      const data = await get<SharesResponse>('/shares?limit=100');
      setShares(data.shares || []);
    } catch (err) {
      console.error('Failed to fetch shares:', err);
    }
  }, [get]);

  const fetchPoemShares = useCallback(async () => {
    try {
      const data = await get<{ shares: PoemShareToken[] }>('/poem-shares?limit=100');
      setPoemShares(data.shares || []);
    } catch (err) {
      console.error('Failed to fetch poem shares:', err);
    }
  }, [get]);

  useEffect(() => {
    fetchShares().catch(console.error);
    fetchPoemShares().catch(console.error);
  }, [fetchShares, fetchPoemShares]);

  const handleResetAttempts = async (shareId: string) => {
    setActionLoading(shareId);
    try {
      await post(`/poem-share/${shareId}/reset-attempts`, { reason: 'Admin reset via dashboard' });
      await fetchPoemShares();
    } catch (err) {
      console.error('Failed to reset attempts:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevokePoemShare = async (shareId: string) => {
    if (!confirm('Revoke this poem share? The recipient will no longer be able to access it.')) return;
    setActionLoading(shareId);
    try {
      await post(`/poem-share/${shareId}/revoke`, { reason: 'Admin revoked via dashboard' });
      await fetchPoemShares();
    } catch (err) {
      console.error('Failed to revoke poem share:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRebind = async (shareId: string) => {
    const data = rebindData[shareId];
    if (!data?.deviceId?.trim() || !data?.reason?.trim()) return;

    setRebinding(shareId);
    try {
      await post(`/share/${shareId}/rebind`, {
        newDeviceId: data.deviceId,
        reason: data.reason,
      });
      await fetchShares();
      setRebindData(prev => {
        const next = { ...prev };
        delete next[shareId];
        return next;
      });
    } catch (err) {
      console.error('Failed to rebind share:', err);
    } finally {
      setRebinding(null);
    }
  };

  const updateRebindData = (shareId: string, field: 'deviceId' | 'reason', value: string) => {
    setRebindData(prev => ({
      ...prev,
      [shareId]: {
        ...prev[shareId],
        [field]: value,
      },
    }));
  };

  if (loading && shares.length === 0) {
    return <LoadingState message="Loading shares..." />;
  }

  if (error) {
    return <ErrorState message={`Error loading shares: ${error}`} />;
  }

  const activeShares = shares.filter(s => s.status === 'active');
  const totalViews = shares.reduce((sum, s) => sum + s.access_count, 0);
  const boundShares = shares.filter(s => s.bound_device_id).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Share2 className="w-7 h-7 text-sky-400" />
            Share Links
          </h1>
          <p className="text-slate-400 text-sm mt-1">Track sharing and access analytics</p>
        </div>
        <button
          onClick={() => fetchShares()}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="card rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">Active Shares</p>
              <p className="text-3xl font-bold text-white font-data">{activeShares.length}</p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-500/10">
              <Link2 className="w-6 h-6 text-emerald-400" />
            </div>
          </div>
        </div>

        <div className="card rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">Total Views</p>
              <p className="text-3xl font-bold text-white font-data">{totalViews.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-sky-500/10">
              <Eye className="w-6 h-6 text-sky-400" />
            </div>
          </div>
        </div>

        <div className="card rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">Device Bound</p>
              <p className="text-3xl font-bold text-white font-data">{boundShares}</p>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/10">
              <Smartphone className="w-6 h-6 text-amber-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Shares Table */}
      {shares.length === 0 ? (
        <div className="card rounded-xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-700/50 flex items-center justify-center mx-auto mb-4">
            <Share2 className="w-8 h-8 text-slate-500" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">No Share Links</h2>
          <p className="text-slate-400">No share links have been created yet</p>
        </div>
      ) : (
        <div className="card rounded-xl overflow-hidden">
          <table>
            <thead>
              <tr className="bg-slate-800/50">
                <th>Track</th>
                <th>Status</th>
                <th>Views</th>
                <th>Device</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((share) => {
                const status = statusColors[share.status] || statusColors.active;
                const data = rebindData[share.id] || { deviceId: '', reason: '' };

                return (
                  <tr key={share.id} className="group">
                    <td>
                      <div>
                        <p className="text-white font-medium">{share.track_title || 'Untitled'}</p>
                        <p className="text-slate-500 text-xs font-data">{share.id.slice(0, 12)}...</p>
                      </div>
                    </td>
                    <td>
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
                        {share.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <Eye className="w-4 h-4 text-slate-500" />
                        <span className="font-data text-white">{share.access_count}</span>
                      </div>
                    </td>
                    <td>
                      {share.bound_device_id ? (
                        <span className="font-data text-xs text-slate-400" title={share.bound_device_id}>
                          {share.bound_device_id.slice(0, 8)}...
                        </span>
                      ) : (
                        <span className="text-slate-500 text-sm">Not bound</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5 text-slate-400 text-sm">
                        <Clock className="w-4 h-4" />
                        {getTimeSince(share.created_at)}
                      </div>
                    </td>
                    <td>
                      {share.bound_device_id && share.status === 'active' && (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={data.deviceId}
                            onChange={(e) => updateRebindData(share.id, 'deviceId', e.target.value)}
                            placeholder="New device ID"
                            className="w-24 bg-slate-800/50 border border-slate-600/50 rounded px-2 py-1 text-xs text-white placeholder-slate-500"
                          />
                          <input
                            type="text"
                            value={data.reason}
                            onChange={(e) => updateRebindData(share.id, 'reason', e.target.value)}
                            placeholder="Reason"
                            className="w-24 bg-slate-800/50 border border-slate-600/50 rounded px-2 py-1 text-xs text-white placeholder-slate-500"
                          />
                          <button
                            onClick={() => handleRebind(share.id)}
                            disabled={rebinding === share.id || !data.deviceId || !data.reason}
                            className="px-2 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 rounded text-xs font-medium disabled:opacity-50"
                          >
                            {rebinding === share.id ? '...' : 'Rebind'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Poem Shares Section */}
      <div className="flex items-center justify-between mt-8">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-amber-400" />
            Poem Shares
          </h2>
          <p className="text-slate-400 text-sm mt-1">Poem sharing, PIN claims, and access management</p>
        </div>
        <button
          onClick={() => fetchPoemShares()}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Poem Shares Summary */}
      {(() => {
        const activePoemShares = poemShares.filter(s => s.status === 'active' || s.status === 'claimed');
        const lockedShares = poemShares.filter(s => s.claim_attempts >= 5);
        const claimedShares = poemShares.filter(s => s.bound_user_id);
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="card rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-400 mb-1">Active Poem Shares</p>
                  <p className="text-3xl font-bold text-white font-data">{activePoemShares.length}</p>
                </div>
                <div className="p-3 rounded-lg bg-amber-500/10">
                  <BookOpen className="w-6 h-6 text-amber-400" />
                </div>
              </div>
            </div>
            <div className="card rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-400 mb-1">Claimed</p>
                  <p className="text-3xl font-bold text-white font-data">{claimedShares.length}</p>
                </div>
                <div className="p-3 rounded-lg bg-emerald-500/10">
                  <Eye className="w-6 h-6 text-emerald-400" />
                </div>
              </div>
            </div>
            <div className="card rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-400 mb-1">Locked Out</p>
                  <p className="text-3xl font-bold text-white font-data">{lockedShares.length}</p>
                </div>
                <div className={`p-3 rounded-lg ${lockedShares.length > 0 ? 'bg-rose-500/10' : 'bg-slate-700/50'}`}>
                  <ShieldAlert className={`w-6 h-6 ${lockedShares.length > 0 ? 'text-rose-400' : 'text-slate-500'}`} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Poem Shares Table */}
      {poemShares.length === 0 ? (
        <div className="card rounded-xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-700/50 flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8 text-slate-500" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">No Poem Shares</h2>
          <p className="text-slate-400">No poem share links have been created yet</p>
        </div>
      ) : (
        <div className="card rounded-xl overflow-hidden">
          <table>
            <thead>
              <tr className="bg-slate-800/50">
                <th>Poem</th>
                <th>Status</th>
                <th>PIN</th>
                <th>Attempts</th>
                <th>Views</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {poemShares.map((share) => {
                const isLocked = share.claim_attempts >= 5;
                const status = statusColors[share.status] || statusColors.active;

                return (
                  <tr key={share.id} className={`group ${isLocked ? 'bg-rose-500/5' : ''}`}>
                    <td>
                      <div>
                        <p className="text-white font-medium">{share.poem_title || 'Untitled'}</p>
                        <p className="text-slate-500 text-xs">
                          For {share.recipient_name} &middot; <span className="font-data">{share.id.slice(0, 12)}...</span>
                        </p>
                      </div>
                    </td>
                    <td>
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
                        {share.status}
                      </span>
                    </td>
                    <td>
                      {share.claim_pin ? (
                        <span className="font-data text-xs text-slate-400">{share.claim_pin}</span>
                      ) : (
                        <span className="text-slate-500 text-sm">None</span>
                      )}
                    </td>
                    <td>
                      <span className={`font-data ${isLocked ? 'text-rose-400 font-semibold' : 'text-white'}`}>
                        {share.claim_attempts}/5
                        {isLocked && <span className="ml-1 text-xs">LOCKED</span>}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <Eye className="w-4 h-4 text-slate-500" />
                        <span className="font-data text-white">{share.access_count}</span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5 text-slate-400 text-sm">
                        <Clock className="w-4 h-4" />
                        {getTimeSince(share.created_at)}
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        {share.claim_attempts > 0 && share.status !== 'revoked' && (
                          <button
                            onClick={() => handleResetAttempts(share.id)}
                            disabled={actionLoading === share.id}
                            className="flex items-center gap-1 px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded text-xs font-medium disabled:opacity-50"
                            title="Reset PIN attempts"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Reset
                          </button>
                        )}
                        {share.status === 'active' && (
                          <button
                            onClick={() => handleRevokePoemShare(share.id)}
                            disabled={actionLoading === share.id}
                            className="flex items-center gap-1 px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded text-xs font-medium disabled:opacity-50"
                            title="Revoke share"
                          >
                            <Ban className="w-3 h-3" />
                            Revoke
                          </button>
                        )}
                        {actionLoading === share.id && (
                          <RefreshCw className="w-3 h-3 text-slate-400 animate-spin" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
