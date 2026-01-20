import { useEffect, useState, useCallback, type KeyboardEvent } from 'react';
import { Users as UsersIcon, Search, AlertCircle, Shield, Lock, ChevronRight, X, Clock, TrendingUp } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getTimeSince, formatFullDate } from '../utils/date';

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
  const { get, loading, error } = useApi();
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('email');
  const [riskFilter, setRiskFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

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
    fetchStats().catch(console.error);
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

  if (error && users.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-rose-400 bg-rose-500/10 px-4 py-3 rounded-lg">
          <AlertCircle className="w-5 h-5" />
          Error loading users: {error}
        </div>
      </div>
    );
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

      {/* Users List */}
      <div className="card rounded-xl overflow-hidden overflow-x-auto">
        <table>
          <thead>
            <tr className="bg-slate-800/50">
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
                <td colSpan={9} className="text-center py-8">
                  <div className="flex items-center justify-center gap-3 text-slate-400">
                    <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
                    Loading users...
                  </div>
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-slate-500">
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
        <UserDetailPanel userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
      )}
    </div>
  );
}

interface UserDetailPanelProps {
  userId: string;
  onClose: () => void;
}

interface UserDetail {
  user: {
    id: string;
    email: string;
    display_name: string | null;
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

function UserDetailPanel({ userId, onClose }: UserDetailPanelProps) {
  const { get, post, put, loading, error } = useApi();
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [lockReason, setLockReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    get<UserDetail>(`/users/${userId}`).then(setDetail).catch(console.error);
  }, [get, userId]);

  const handleLockToggle = async () => {
    if (!detail) return;
    setSubmitting(true);
    try {
      const isLocked = detail.user.locked_until && new Date(detail.user.locked_until) > new Date();
      await post(`/users/${userId}/lock`, { locked: !isLocked, reason: lockReason || 'Admin action' });
      const updated = await get<UserDetail>(`/users/${userId}`);
      setDetail(updated);
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
      const updated = await get<UserDetail>(`/users/${userId}`);
      setDetail(updated);
    } catch (err) {
      console.error('Failed to update risk:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="card rounded-xl p-6">
        <div className="flex items-center justify-center py-8">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="card rounded-xl p-6">
        <div className="text-rose-400 text-center py-8">Failed to load user details</div>
      </div>
    );
  }

  const isLocked = detail.user.locked_until && new Date(detail.user.locked_until) > new Date();

  return (
    <div className="card rounded-xl p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">
            {detail.user.display_name || detail.user.email}
          </h2>
          <p className="text-slate-400 text-sm">{detail.user.email}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close user details"
          className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 rounded-lg transition-colors"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

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
    </div>
  );
}
