import { useEffect, useState, useCallback, type KeyboardEvent, type ChangeEvent } from 'react';
import { Users as UsersIcon, Search, Shield, Lock, ChevronRight, X, Clock, TrendingUp, Trash2, Pencil, Save, Mic, Monitor } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getTimeSince, formatFullDate } from '../utils/date';
import { getAdminUser } from '../utils/auth';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';

interface User {
  id: string;
  email: string;
  display_name: string | null;
  risk_level: string;
  locked_until: string | null;
  created_at: string;
  tier: string;
  track_count: number;
  voice_status: string;
  credits_used: number;
  last_active: string;
}

interface UserStats {
  totalUsers: number;
  paidUsers: number;
  trialUsers: number;
  freeUsers: number;
  conversionRate: string;
}

interface UsersResponse {
  users: User[];
}

interface BulkActionResponse {
  succeeded: string[];
  failed: Array<{ userId: string | null; error: string }>;
}

const riskColors: Record<string, { bg: string; text: string }> = {
  low: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  high: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
};

const tierColors: Record<string, { bg: string; text: string }> = {
  free: { bg: 'bg-slate-500/10', text: 'text-slate-400' },
  trial: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  pro: { bg: 'bg-sky-500/10', text: 'text-sky-400' },
  plus: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
};

export function Users() {
  const { get, post, loading, error } = useApi();
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('email');
  const [riskFilter, setRiskFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const isSuperadmin = getAdminUser()?.role === 'superadmin';

  const fetchStats = useCallback(async () => {
    const data = await get<UserStats>('/users/stats');
    setStats(data);
  }, [get]);

  const fetchUsers = useCallback(async () => {
    const params = new URLSearchParams();
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      switch (searchType) {
        case 'userId':
          params.append('userId', trimmedQuery);
          break;
        case 'trackId':
          params.append('trackId', trimmedQuery);
          break;
        case 'shareId':
          params.append('shareId', trimmedQuery);
          break;
        case 'recipientName':
          params.append('recipientName', trimmedQuery);
          break;
        default:
          params.append('email', trimmedQuery);
      }
    }
    if (riskFilter) params.append('riskLevel', riskFilter);
    if (tierFilter) params.append('tier', tierFilter);
    params.append('limit', '50');

    const queryString = params.toString();
    const data = await get<UsersResponse>(`/users${queryString ? `?${queryString}` : ''}`);
    setUsers(data.users);
  }, [get, searchQuery, searchType, riskFilter, tierFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStats().catch(console.error);
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchStats]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchUsers().catch(console.error);
    }, 300);
    return () => clearTimeout(debounce);
  }, [fetchUsers]);

  const isLocked = (lockedUntil: string | null) => {
    if (!lockedUntil) return false;
    return new Date(lockedUntil) > new Date();
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === users.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(users.map(u => u.id)));
    }
  };

  const toggleSelect = (userId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleBulkAction = async (action: 'delete' | 'lock' | 'unlock') => {
    const ids = Array.from(selectedIds);
    const actionLabel = action === 'delete' ? `permanently delete ${ids.length} user(s)` : `${action} ${ids.length} user(s)`;
    if (!window.confirm(`Are you sure you want to ${actionLabel}? This cannot be undone.`)) return;

    setBulkSubmitting(true);
    try {
      const result = await post<BulkActionResponse>('/users/bulk-action', { action, userIds: ids });
      const failCount = result.failed?.length || 0;
      if (failCount > 0) {
        alert(`${result.succeeded.length} succeeded, ${failCount} failed.`);
      }
      setSelectedIds(new Set());
      fetchUsers().catch(console.error);
      fetchStats().catch(console.error);
    } catch (err) {
      console.error('Bulk action failed:', err);
    } finally {
      setBulkSubmitting(false);
    }
  };

  if (error && users.length === 0) {
    return <ErrorState message={`Error loading users: ${error}`} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <UsersIcon className="w-7 h-7 text-rose-400" />
          Users
        </h1>
        <p className="text-slate-400 text-sm mt-1">Manage user accounts and adoption metrics</p>
      </div>

      {/* Stats Banner */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <UsersIcon className="w-4 h-4 text-slate-500" />
              <p className="text-slate-400 text-xs uppercase tracking-wider">Total Users</p>
            </div>
            <p className="text-2xl font-bold text-white font-data">{stats.totalUsers}</p>
          </div>
          <div className="card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <p className="text-slate-400 text-xs uppercase tracking-wider">Paid</p>
            </div>
            <p className="text-2xl font-bold text-emerald-400 font-data">{stats.paidUsers}</p>
            <p className="text-xs text-slate-500">{stats.conversionRate}% conversion</p>
          </div>
          <div className="card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-500" />
              <p className="text-slate-400 text-xs uppercase tracking-wider">Trial</p>
            </div>
            <p className="text-2xl font-bold text-amber-400 font-data">{stats.trialUsers}</p>
          </div>
          <div className="card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <UsersIcon className="w-4 h-4 text-slate-500" />
              <p className="text-slate-400 text-xs uppercase tracking-wider">Free</p>
            </div>
            <p className="text-2xl font-bold text-slate-400 font-data">{stats.freeUsers}</p>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="card rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                searchType === 'email'
                  ? 'Search by email...'
                  : searchType === 'userId'
                    ? 'Search by user ID...'
                    : searchType === 'trackId'
                      ? 'Search by track ID...'
                      : searchType === 'shareId'
                        ? 'Search by share ID...'
                        : 'Search by recipient name...'
              }
              aria-label="Search users"
              className="w-full pl-11 pr-4 py-2.5 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white placeholder-slate-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
            />
          </div>
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
            aria-label="Search type"
            className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-sm text-slate-300 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          >
            <option value="email">Email</option>
            <option value="userId">User ID</option>
            <option value="trackId">Track ID</option>
            <option value="shareId">Share ID</option>
            <option value="recipientName">Recipient Name</option>
          </select>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            aria-label="Filter by subscription tier"
            className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-sm text-slate-300 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          >
            <option value="">All Tiers</option>
            <option value="free">Free</option>
            <option value="trial">Trial</option>
            <option value="pro">Pro</option>
            <option value="plus">Plus</option>
          </select>
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            aria-label="Filter by risk level"
            className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-sm text-slate-300 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
          >
            <option value="">All Risk Levels</option>
            <option value="low">Low Risk</option>
            <option value="medium">Medium Risk</option>
            <option value="high">High Risk</option>
          </select>
          <span className="text-sm text-slate-500 font-data">{users.length} users</span>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && isSuperadmin && (
        <div className="card rounded-xl p-4 border border-rose-500/20 bg-rose-500/5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white font-medium">{selectedIds.size} user(s) selected</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleBulkAction('lock')}
                disabled={bulkSubmitting}
                className="px-3 py-1.5 text-sm bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 transition-colors disabled:opacity-50"
              >
                Lock Selected
              </button>
              <button
                onClick={() => handleBulkAction('unlock')}
                disabled={bulkSubmitting}
                className="px-3 py-1.5 text-sm bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                Unlock Selected
              </button>
              <button
                onClick={() => handleBulkAction('delete')}
                disabled={bulkSubmitting}
                className="px-3 py-1.5 text-sm bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 transition-colors disabled:opacity-50"
              >
                Delete Selected
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Users List */}
      <div className="card rounded-xl overflow-hidden overflow-x-auto">
        <table>
          <thead>
            <tr className="bg-slate-800/50">
              {isSuperadmin && (
                <th scope="col" className="w-10">
                  <input
                    type="checkbox"
                    checked={users.length > 0 && selectedIds.size === users.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all users"
                    className="rounded border-slate-600 bg-slate-800 text-rose-500 focus:ring-rose-500/20"
                  />
                </th>
              )}
              <th scope="col">User</th>
              <th scope="col">Tier</th>
              <th scope="col">Songs</th>
              <th scope="col">Credits</th>
              <th scope="col">Active</th>
              <th scope="col">Risk</th>
              <th scope="col">Status</th>
              <th scope="col">Joined</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 ? (
              <tr>
                <td colSpan={isSuperadmin ? 10 : 9} className="text-center py-8">
                  <div className="flex items-center justify-center gap-3 text-slate-400">
                    <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
                    Loading users...
                  </div>
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={isSuperadmin ? 10 : 9} className="text-center py-8 text-slate-500">
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const riskStyle = riskColors[user.risk_level] || riskColors.low;
                const tierStyle = tierColors[user.tier] || tierColors.free;
                const locked = isLocked(user.locked_until);
                const toggleUser = () => setSelectedUserId(selectedUserId === user.id ? null : user.id);
                const handleKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleUser();
                  }
                };

                return (
                  <tr
                    key={user.id}
                    role="button"
                    tabIndex={0}
                    aria-expanded={selectedUserId === user.id}
                    className={`group cursor-pointer focus:outline-none focus:ring-2 focus:ring-rose-500/50 ${selectedUserId === user.id ? 'bg-slate-800/50' : ''}`}
                    onClick={toggleUser}
                    onKeyDown={handleKeyDown}
                  >
                    {isSuperadmin && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(user.id)}
                          onChange={() => toggleSelect(user.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${user.display_name || user.email}`}
                          className="rounded border-slate-600 bg-slate-800 text-rose-500 focus:ring-rose-500/20"
                        />
                      </td>
                    )}
                    <td>
                      <div>
                        <p className="text-white font-medium">
                          {user.display_name || 'No name'}
                        </p>
                        <p className="text-slate-400 text-sm truncate max-w-[200px]">{user.email}</p>
                      </div>
                    </td>
                    <td>
                      <div className={`inline-flex items-center px-2.5 py-1 rounded-full ${tierStyle.bg}`}>
                        <span className={`text-xs font-medium capitalize ${tierStyle.text}`}>
                          {user.tier}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="text-white font-data">{user.track_count}</span>
                    </td>
                    <td>
                      <span className="text-white font-data">{user.credits_used}</span>
                    </td>
                    <td>
                      <span className="text-slate-400 text-sm">{getTimeSince(user.last_active)}</span>
                    </td>
                    <td>
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${riskStyle.bg}`}>
                        <Shield className={`w-3.5 h-3.5 ${riskStyle.text}`} />
                        <span className={`text-xs font-medium capitalize ${riskStyle.text}`}>
                          {user.risk_level}
                        </span>
                      </div>
                    </td>
                    <td>
                      {locked ? (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400">
                          <Lock className="w-3.5 h-3.5" />
                          <span className="text-xs font-medium">Locked</span>
                        </div>
                      ) : (
                        <span className="text-emerald-400 text-sm">Active</span>
                      )}
                    </td>
                    <td>
                      <span className="text-slate-400 text-sm">{formatFullDate(user.created_at)}</span>
                    </td>
                    <td>
                      <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-slate-300 transition-colors" />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* User Detail Panel */}
      {selectedUserId && (
        <UserDetailPanel
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onUserDeleted={() => { setSelectedUserId(null); fetchUsers(); fetchStats(); }}
        />
      )}
    </div>
  );
}

interface UserDetailPanelProps {
  userId: string;
  onClose: () => void;
  onUserDeleted?: () => void;
}

interface UserDetail {
  user: {
    id: string;
    email: string;
    display_name: string | null;
    phone_number: string | null;
    risk_level: string;
    locked_until: string | null;
    created_at: string;
  };
  voiceProfile: {
    id: string;
    status: string;
    quality_score: number;
    created_at: string;
  } | null;
  entitlements: {
    tier: string;
    credits_balance: number;
    preview_count_today: number;
  } | null;
  tracks: Array<{
    id: string;
    title: string;
    occasion: string;
    status: string;
    created_at: string;
  }>;
}

interface UserSession {
  id: string;
  device_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_active_at: string | null;
}

function UserDetailPanel({ userId, onClose, onUserDeleted }: UserDetailPanelProps) {
  const { get, post, put, del, loading, error } = useApi();
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [lockReason, setLockReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Edit profile state
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState({ display_name: '', email: '', phone_number: '' });

  // Edit entitlements state
  const [editingEntitlements, setEditingEntitlements] = useState(false);
  const [entitlementFields, setEntitlementFields] = useState({ tier: 'free', credits_balance: 0 });

  // Sessions state
  const [sessions, setSessions] = useState<UserSession[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const isSuperadmin = getAdminUser()?.role === 'superadmin';

  const refreshDetail = useCallback(async () => {
    const data = await get<UserDetail>(`/users/${userId}`);
    setDetail(data);
    return data;
  }, [get, userId]);

  useEffect(() => {
    refreshDetail().catch(console.error);
  }, [refreshDetail]);

  const handleLockToggle = async () => {
    if (!detail) return;
    setSubmitting(true);
    try {
      const locked = detail.user.locked_until && new Date(detail.user.locked_until) > new Date();
      await post(`/users/${userId}/lock`, { locked: !locked, reason: lockReason || 'Admin action' });
      await refreshDetail();
      setLockReason('');
    } catch (err) {
      console.error('Failed to toggle lock:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRiskUpdate = async (newRisk: string) => {
    setSubmitting(true);
    try {
      await put(`/users/${userId}/risk`, { riskLevel: newRisk, reason: 'Admin adjustment' });
      await refreshDetail();
    } catch (err) {
      console.error('Failed to update risk:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!detail || deleteConfirmEmail !== detail.user.email) return;
    setDeleting(true);
    try {
      await del(`/users/${userId}`, deleteReason ? { reason: deleteReason } : undefined);
      onUserDeleted?.();
    } catch (err) {
      console.error('Failed to delete user:', err);
    } finally {
      setDeleting(false);
    }
  };

  // Edit profile handlers
  const startEditing = () => {
    if (!detail) return;
    setEditFields({
      display_name: detail.user.display_name || '',
      email: detail.user.email || '',
      phone_number: detail.user.phone_number || '',
    });
    setEditing(true);
  };

  const handleSaveProfile = async () => {
    setSubmitting(true);
    try {
      await put(`/users/${userId}/profile`, editFields);
      await refreshDetail();
      setEditing(false);
    } catch (err) {
      console.error('Failed to save profile:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Edit entitlements handlers
  const startEditingEntitlements = () => {
    if (!detail) return;
    setEntitlementFields({
      tier: detail.entitlements?.tier || 'free',
      credits_balance: detail.entitlements?.credits_balance ?? 0,
    });
    setEditingEntitlements(true);
  };

  const handleSaveEntitlements = async () => {
    setSubmitting(true);
    try {
      await put(`/users/${userId}/entitlements`, entitlementFields);
      await refreshDetail();
      setEditingEntitlements(false);
    } catch (err) {
      console.error('Failed to save entitlements:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Sessions handlers
  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const data = await get<{ sessions: UserSession[] }>(`/users/${userId}/sessions`);
      setSessions(data.sessions);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await post(`/users/${userId}/sessions/${sessionId}/revoke`, { reason: 'Admin revocation' });
      loadSessions();
    } catch (err) {
      console.error('Failed to revoke session:', err);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!window.confirm('Revoke all sessions for this user?')) return;
    try {
      await post(`/users/${userId}/sessions/revoke-all`, { reason: 'Admin revocation' });
      loadSessions();
    } catch (err) {
      console.error('Failed to revoke sessions:', err);
    }
  };

  // Voice reverify
  const handleVoiceReverify = async () => {
    if (!window.confirm('Force voice profile re-verification?')) return;
    setSubmitting(true);
    try {
      await post(`/users/${userId}/voice/force-reverify`, { reason: 'Admin-initiated' });
      await refreshDetail();
    } catch (err) {
      console.error('Failed to force reverify:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="card rounded-xl p-6">
        <LoadingState message="Loading user details..." />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="card rounded-xl p-6">
        <ErrorState message="Failed to load user details" />
      </div>
    );
  }

  const isLocked = detail.user.locked_until && new Date(detail.user.locked_until) > new Date();

  return (
    <div className="card rounded-xl p-6">
      {/* Header with edit button */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1">
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Display Name</label>
                <input
                  type="text"
                  value={editFields.display_name}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setEditFields(f => ({ ...f, display_name: e.target.value }))}
                  className="w-full bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Email</label>
                <input
                  type="email"
                  value={editFields.email}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setEditFields(f => ({ ...f, email: e.target.value }))}
                  className="w-full bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Phone</label>
                <input
                  type="tel"
                  value={editFields.phone_number}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setEditFields(f => ({ ...f, phone_number: e.target.value }))}
                  className="w-full bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveProfile}
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-sky-500/10 text-sky-400 rounded-lg hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <h2 className="text-xl font-semibold text-white">
                {detail.user.display_name || detail.user.email}
              </h2>
              <p className="text-slate-400 text-sm">{detail.user.email}</p>
              {detail.user.phone_number && (
                <p className="text-slate-500 text-xs mt-0.5">{detail.user.phone_number}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!editing && isSuperadmin && (
            <button
              onClick={startEditing}
              aria-label="Edit user profile"
              className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              <Pencil className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close user details"
            className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-800/50 rounded-lg p-4">
          <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Tier</p>
          <p className="text-white font-medium capitalize">{detail.entitlements?.tier || 'free'}</p>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-4">
          <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Credits</p>
          <p className="text-white font-medium font-data">{detail.entitlements?.credits_balance || 0}</p>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-4">
          <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Voice Profile</p>
          <p className="text-white font-medium capitalize">{detail.voiceProfile?.status || 'None'}</p>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-4">
          <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Tracks</p>
          <p className="text-white font-medium font-data">{detail.tracks.length}</p>
        </div>
      </div>

      {/* Edit Entitlements */}
      {isSuperadmin && (
        <div className="mb-6">
          {editingEntitlements ? (
            <div className="bg-slate-800/30 rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-medium text-slate-400">Edit Entitlements</h4>
              <div className="flex items-center gap-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Tier</label>
                  <select
                    value={entitlementFields.tier}
                    onChange={(e) => setEntitlementFields(f => ({ ...f, tier: e.target.value }))}
                    className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-300"
                  >
                    <option value="free">Free</option>
                    <option value="trial">Trial</option>
                    <option value="pro">Pro</option>
                    <option value="plus">Plus</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Credits</label>
                  <input
                    type="number"
                    min={0}
                    value={entitlementFields.credits_balance}
                    onChange={(e) => setEntitlementFields(f => ({ ...f, credits_balance: parseInt(e.target.value) || 0 }))}
                    className="w-28 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveEntitlements}
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-sky-500/10 text-sky-400 rounded-lg hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save
                </button>
                <button
                  onClick={() => setEditingEntitlements(false)}
                  className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={startEditingEntitlements}
              className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
            >
              Edit Entitlements
            </button>
          )}
        </div>
      )}

      {/* Admin Actions */}
      <div className="border-t border-slate-700/50 pt-6 space-y-4">
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Admin Actions</h3>

        <div className="flex items-center gap-4">
          <label htmlFor="risk-level" className="text-sm text-slate-400">Risk Level:</label>
          <select
            id="risk-level"
            value={detail.user.risk_level}
            onChange={(e) => handleRiskUpdate(e.target.value)}
            disabled={submitting}
            className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-300"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <div className="flex items-center gap-4">
          <input
            type="text"
            value={lockReason}
            onChange={(e) => setLockReason(e.target.value)}
            placeholder="Reason for lock/unlock..."
            aria-label="Reason for locking or unlocking user"
            className="flex-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
          />
          <button
            onClick={handleLockToggle}
            disabled={submitting}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
              isLocked
                ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20'
            }`}
          >
            {isLocked ? 'Unlock User' : 'Lock User'}
          </button>
        </div>

        {/* Voice Reverify */}
        {isSuperadmin && detail.voiceProfile && (
          <button
            onClick={handleVoiceReverify}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors disabled:opacity-50"
          >
            <Mic className="w-4 h-4" />
            Force Voice Re-verification
          </button>
        )}
      </div>

      {/* Sessions */}
      <div className="border-t border-slate-700/50 pt-6 mt-6">
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Sessions</h3>
        {sessions === null ? (
          <button
            onClick={loadSessions}
            disabled={sessionsLoading}
            className="flex items-center gap-2 text-sm text-sky-400 hover:text-sky-300 transition-colors disabled:opacity-50"
          >
            <Monitor className="w-4 h-4" />
            {sessionsLoading ? 'Loading...' : 'Load Sessions'}
          </button>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-slate-500">No active sessions</p>
        ) : (
          <div className="space-y-2">
            {isSuperadmin && (
              <button
                onClick={handleRevokeAllSessions}
                className="text-xs text-rose-400 hover:text-rose-300 mb-2 transition-colors"
              >
                Revoke All
              </button>
            )}
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between py-2 px-3 bg-slate-800/30 rounded-lg">
                <div>
                  <span className="text-white text-sm">{session.device_name || 'Unknown device'}</span>
                  {session.ip_address && (
                    <span className="text-slate-500 text-xs ml-2">{session.ip_address}</span>
                  )}
                  {session.last_active_at && (
                    <span className="text-slate-500 text-xs ml-2">{getTimeSince(session.last_active_at)}</span>
                  )}
                </div>
                {isSuperadmin && (
                  <button
                    onClick={() => handleRevokeSession(session.id)}
                    className="text-xs text-rose-400 hover:text-rose-300 transition-colors"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Tracks */}
      {detail.tracks.length > 0 && (
        <div className="border-t border-slate-700/50 pt-6 mt-6">
          <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Recent Tracks</h3>
          <div className="space-y-2">
            {detail.tracks.slice(0, 5).map((track) => (
              <div key={track.id} className="flex items-center justify-between py-2 px-3 bg-slate-800/30 rounded-lg">
                <div>
                  <span className="text-white">{track.title}</span>
                  <span className="text-slate-500 text-sm ml-2">{track.occasion}</span>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${
                  track.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-400'
                }`}>
                  {track.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Danger Zone */}
      {isSuperadmin && (
        <div className="border-t border-rose-500/20 pt-6 mt-6">
          <h3 className="text-sm font-medium text-rose-400 uppercase tracking-wider mb-3">Danger Zone</h3>
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg hover:bg-rose-500/20 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete User Permanently
            </button>
          ) : (
            <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-4 space-y-4">
              <p className="text-sm text-rose-300">
                This will permanently delete this user and all associated data including tracks,
                voice profiles, entitlements, and billing records. This action cannot be undone.
              </p>
              <div>
                <label htmlFor="delete-reason" className="block text-xs text-slate-400 mb-1">Reason (optional)</label>
                <input
                  id="delete-reason"
                  type="text"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Reason for deletion..."
                  className="w-full bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
                />
              </div>
              <div>
                <label htmlFor="delete-confirm-email" className="block text-xs text-slate-400 mb-1">
                  Type <span className="text-rose-400 font-mono">{detail.user.email}</span> to confirm
                </label>
                <input
                  id="delete-confirm-email"
                  type="text"
                  value={deleteConfirmEmail}
                  onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                  placeholder={detail.user.email}
                  className="w-full bg-slate-800/50 border border-rose-500/30 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleDeleteUser}
                  disabled={deleting || deleteConfirmEmail !== detail.user.email}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  {deleting ? 'Deleting...' : 'Delete User'}
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmEmail(''); setDeleteReason(''); }}
                  className="px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
