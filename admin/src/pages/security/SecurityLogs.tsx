import { useEffect, useState, useCallback } from 'react';
import { Key, RefreshCw, AlertTriangle, Filter, CheckCircle, XCircle, Shield, LogOut } from 'lucide-react';
import { useApi } from '../../hooks/useApi';

interface AuthEvent {
  id: string;
  user_id: string | null;
  user_email: string | null;
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string | null;
  created_at: string;
}

interface AuthStats {
  byType: Array<{ event_type: string; count: number }>;
  loginSuccess: number;
  loginFailed: number;
}

const eventTypeConfig: Record<string, { color: string; bg: string; icon: typeof CheckCircle }> = {
  login_success: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: CheckCircle },
  login_failed: { color: 'text-rose-400', bg: 'bg-rose-500/10', icon: XCircle },
  logout: { color: 'text-slate-400', bg: 'bg-slate-500/10', icon: LogOut },
  token_refresh: { color: 'text-sky-400', bg: 'bg-sky-500/10', icon: Shield },
  token_revoked: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Shield },
  token_reuse_detected: { color: 'text-rose-400', bg: 'bg-rose-500/10', icon: AlertTriangle },
  password_changed: { color: 'text-violet-400', bg: 'bg-violet-500/10', icon: Key },
  password_reset_requested: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Key },
  password_reset_completed: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: Key },
  account_locked: { color: 'text-rose-400', bg: 'bg-rose-500/10', icon: AlertTriangle },
  account_unlocked: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: CheckCircle },
};

const eventTypes = [
  'login_success',
  'login_failed',
  'logout',
  'token_refresh',
  'token_revoked',
  'token_reuse_detected',
  'password_changed',
  'password_reset_requested',
  'password_reset_completed',
  'account_locked',
  'account_unlocked',
];

export function SecurityLogs() {
  const { get, loading, error } = useApi();
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [stats, setStats] = useState<AuthStats | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');

  const fetchEvents = useCallback(async () => {
    const params = new URLSearchParams();
    if (eventTypeFilter) params.append('eventType', eventTypeFilter);
    if (userIdFilter) params.append('userId', userIdFilter);
    params.append('limit', '50');

    const queryString = params.toString();
    const [eventsData, statsData] = await Promise.all([
      get<{ events: AuthEvent[] }>(`/security/auth-events${queryString ? `?${queryString}` : ''}`),
      get<AuthStats>('/security/auth-events/stats'),
    ]);
    setEvents(eventsData.events);
    setStats(statsData);
  }, [get, eventTypeFilter, userIdFilter]);

  useEffect(() => {
    fetchEvents().catch(console.error);
  }, [fetchEvents]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatEventType = (type: string) => {
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading security logs...
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
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
            <Key className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Security Logs</h1>
            <p className="text-sm text-slate-400">Authentication events and security activity</p>
          </div>
        </div>
        <button
          onClick={() => fetchEvents().catch(console.error)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Banner */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              Logins Today
            </div>
            <div className="text-2xl font-bold text-white font-data">{stats.loginSuccess}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <XCircle className="w-4 h-4 text-rose-400" />
              Failed Attempts
            </div>
            <div className="text-2xl font-bold text-white font-data">{stats.loginFailed}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <Shield className="w-4 h-4 text-sky-400" />
              Token Events
            </div>
            <div className="text-2xl font-bold text-white font-data">
              {stats.byType.filter(s => s.event_type.includes('token')).reduce((sum, s) => sum + s.count, 0)}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 p-4 bg-slate-800/30 rounded-xl border border-slate-700/50">
        <Filter className="w-5 h-5 text-slate-400" />
        <select
          value={eventTypeFilter}
          onChange={(e) => setEventTypeFilter(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
        >
          <option value="">All Event Types</option>
          {eventTypes.map(type => (
            <option key={type} value={type}>{formatEventType(type)}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter by user ID..."
          value={userIdFilter}
          onChange={(e) => setUserIdFilter(e.target.value)}
          className="flex-1 max-w-xs bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
        />
      </div>

      {/* Events Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50 bg-slate-900/30">
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Timestamp</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Event Type</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">User</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">IP Address</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">User Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {events.map((event) => {
                const config = eventTypeConfig[event.event_type] || { color: 'text-slate-400', bg: 'bg-slate-500/10', icon: Shield };
                const Icon = config.icon;
                return (
                  <tr key={event.id} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4 text-sm text-slate-400 font-data whitespace-nowrap">
                      {formatDate(event.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${config.bg} ${config.color}`}>
                        <Icon className="w-3 h-3" />
                        {formatEventType(event.event_type)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {event.user_email ? (
                        <span className="text-slate-200">{event.user_email}</span>
                      ) : (
                        <span className="text-slate-500 italic">Anonymous</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400 font-data">
                      {event.ip_address || '-'}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-500 max-w-xs truncate" title={event.user_agent || ''}>
                      {event.user_agent ? event.user_agent.substring(0, 50) + '...' : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {events.length === 0 && (
          <div className="flex items-center justify-center py-12 text-slate-500">
            No security events found
          </div>
        )}
      </div>
    </div>
  );
}
