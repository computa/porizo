import { useState } from 'react';
import { Monitor, Trash2 } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { getTimeSince } from '../../utils/date';
import { getTrackStatusLabel, getTrackStatusStyle } from '../../utils/status';
import type { UserDetail, UserSession } from './types';

interface SessionsSectionProps {
  userId: string;
  isSuperadmin: boolean;
}

export function SessionsSection({ userId, isSuperadmin }: SessionsSectionProps) {
  const { get, post } = useApi();
  const [sessions, setSessions] = useState<UserSession[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await get<{ sessions: UserSession[] }>(`/users/${userId}/sessions`);
      setSessions(data.sessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    try {
      await post(`/users/${userId}/sessions/${sessionId}/revoke`, { reason: 'Admin revocation' });
      await loadSessions();
    } catch (error) {
      console.error('Failed to revoke session:', error);
    }
  };

  const revokeAllSessions = async () => {
    if (!window.confirm('Revoke all sessions for this user?')) return;
    try {
      await post(`/users/${userId}/sessions/revoke-all`, { reason: 'Admin revocation' });
      await loadSessions();
    } catch (error) {
      console.error('Failed to revoke sessions:', error);
    }
  };

  return (
    <div className="border-t border-slate-700/50 pt-6 mt-6">
      <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Sessions</h3>
      {sessions === null ? (
        <button
          onClick={loadSessions}
          disabled={loading}
          className="flex items-center gap-2 text-sm text-sky-400 hover:text-sky-300 transition-colors disabled:opacity-50"
        >
          <Monitor className="w-4 h-4" />
          {loading ? 'Loading...' : 'Load Sessions'}
        </button>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-slate-500">No active sessions</p>
      ) : (
        <div className="space-y-2">
          {isSuperadmin && (
            <button
              onClick={revokeAllSessions}
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
                  onClick={() => revokeSession(session.id)}
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
  );
}

export function RecentTracksSection({ tracks }: { tracks: UserDetail['tracks'] }) {
  if (tracks.length === 0) return null;

  return (
    <div className="border-t border-slate-700/50 pt-6 mt-6">
      <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Recent Tracks</h3>
      <div className="space-y-2">
        {tracks.slice(0, 5).map((track) => (
          <div key={track.id} className="flex items-center justify-between py-2 px-3 bg-slate-800/30 rounded-lg">
            <div>
              <span className="text-white">{track.title}</span>
              <span className="text-slate-500 text-sm ml-2">{track.occasion}</span>
            </div>
            <span className={`text-xs px-2 py-1 rounded ${getTrackStatusStyle(track.status).bg} ${getTrackStatusStyle(track.status).text}`}>
              {getTrackStatusLabel(track.status)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DangerZoneProps {
  userId: string;
  email: string | null;
  onUserDeleted?: () => void;
}

export function DangerZone({ userId, email, onUserDeleted }: DangerZoneProps) {
  const { del } = useApi();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const confirmationValue = email || userId;

  const deleteUser = async () => {
    if (confirmation !== confirmationValue) return;
    setDeleting(true);
    try {
      await del(`/users/${userId}`, reason ? { reason } : undefined);
      onUserDeleted?.();
    } catch (error) {
      console.error('Failed to delete user:', error);
    } finally {
      setDeleting(false);
    }
  };

  const cancel = () => {
    setShowConfirmation(false);
    setConfirmation('');
    setReason('');
  };

  return (
    <div className="border-t border-rose-500/20 pt-6 mt-6">
      <h3 className="text-sm font-medium text-rose-400 uppercase tracking-wider mb-3">Danger Zone</h3>
      {!showConfirmation ? (
        <button
          onClick={() => setShowConfirmation(true)}
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
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason for deletion..."
              className="w-full bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
            />
          </div>
          <div>
            <label htmlFor="delete-confirm-email" className="block text-xs text-slate-400 mb-1">
              Type <span className="text-rose-400 font-mono">{confirmationValue}</span> to confirm
            </label>
            <input
              id="delete-confirm-email"
              type="text"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={confirmationValue}
              className="w-full bg-slate-800/50 border border-rose-500/30 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={deleteUser}
              disabled={deleting || confirmation !== confirmationValue}
              className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              {deleting ? 'Deleting...' : 'Delete User'}
            </button>
            <button
              onClick={cancel}
              className="px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
