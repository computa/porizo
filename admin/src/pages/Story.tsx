import { useEffect, useState, useCallback } from 'react';
import { BookOpen, AlertCircle } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { formatDateTime } from '../utils/date';

interface StorySession {
  id: string;
  user_id: string;
  user_email: string | null;
  status: string;
  engine_version: string;
  recipient_name: string;
  occasion: string | null;
  question_count: number;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
}

interface StoryTurn {
  id: string;
  turn_number: number;
  question: string;
  answer: string | null;
  element_target: string | null;
  is_follow_up: number;
  anchor_word: string | null;
  asked_at: string;
  answered_at: string | null;
}

interface StorySessionDetail {
  session: Record<string, unknown>;
  turns: StoryTurn[];
}

interface SessionsResponse {
  sessions: StorySession[];
}

export function Story() {
  const { get, loading, error } = useApi();
  const [sessions, setSessions] = useState<StorySession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StorySessionDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [engineFilter, setEngineFilter] = useState('');

  const fetchSessions = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.append('status', statusFilter);
    if (engineFilter) params.append('engineVersion', engineFilter);
    params.append('limit', '50');
    const query = params.toString();
    const data = await get<SessionsResponse>(`/story/sessions${query ? `?${query}` : ''}`);
    setSessions(data.sessions);
  }, [get, statusFilter, engineFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSessions().catch(console.error);
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchSessions]);

  useEffect(() => {
    if (!selectedId) {
      const timer = setTimeout(() => setDetail(null), 0);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      get<StorySessionDetail>(`/story/sessions/${selectedId}`)
        .then(setDetail)
        .catch(console.error);
    }, 0);
    return () => clearTimeout(timer);
  }, [get, selectedId]);

  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading story sessions...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-rose-400 bg-rose-500/10 px-4 py-3 rounded-lg">
          <AlertCircle className="w-5 h-5" />
          Error loading story sessions: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-rose-400" />
          Story Sessions
        </h1>
        <p className="text-slate-400 text-sm mt-1">Monitor story collection quality and completion</p>
      </div>

      <div className="card rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={engineFilter}
            onChange={(e) => setEngineFilter(e.target.value)}
            className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-sm text-slate-300"
          >
            <option value="">All Engines</option>
            <option value="v1">V1</option>
            <option value="v2">V2</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-sm text-slate-300"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="ready_for_confirm">Ready for Confirm</option>
            <option value="confirmed">Confirmed</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <span className="text-sm text-slate-500 font-data">{sessions.length} sessions</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card rounded-xl overflow-hidden lg:col-span-2">
          <table>
            <thead>
              <tr className="bg-slate-800/50">
                <th>Recipient</th>
                <th>Status</th>
                <th>Engine</th>
                <th>Turns</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-500">
                    No story sessions found
                  </td>
                </tr>
              ) : (
                sessions.map((session) => (
                  <tr
                    key={session.id}
                    className={`cursor-pointer ${selectedId === session.id ? 'bg-slate-800/50' : ''}`}
                    onClick={() => setSelectedId(session.id)}
                  >
                    <td>
                      <div>
                        <p className="text-white font-medium">{session.recipient_name || 'Unknown'}</p>
                        <p className="text-slate-500 text-xs font-data">{session.user_email || session.user_id}</p>
                      </div>
                    </td>
                    <td className="text-slate-300 capitalize">{session.status.replace(/_/g, ' ')}</td>
                    <td className="text-slate-400 font-data">{session.engine_version}</td>
                    <td className="text-slate-400 font-data">{session.question_count}</td>
                    <td className="text-slate-400 text-sm">{formatDateTime(session.updated_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="card rounded-xl p-4">
          <h2 className="text-lg font-semibold text-white mb-3">Session Detail</h2>
          {!detail ? (
            <p className="text-slate-500 text-sm">Select a session to inspect details.</p>
          ) : (
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-slate-400">Session ID</p>
                <p className="text-slate-200 font-data break-all">{String(detail.session.id)}</p>
              </div>
              <div>
                <p className="text-slate-400">Current Question</p>
                <pre className="text-slate-200 whitespace-pre-wrap text-xs bg-slate-900/50 p-2 rounded">
                  {detail.session.current_question_json ? String(detail.session.current_question_json) : 'None'}
                </pre>
              </div>
              <div>
                <p className="text-slate-400">Elements</p>
                <pre className="text-slate-200 whitespace-pre-wrap text-xs bg-slate-900/50 p-2 rounded">
                  {detail.session.elements_json ? String(detail.session.elements_json) : '{}'}
                </pre>
              </div>
              <div>
                <p className="text-slate-400">Summary</p>
                <pre className="text-slate-200 whitespace-pre-wrap text-xs bg-slate-900/50 p-2 rounded">
                  {detail.session.summary_json ? String(detail.session.summary_json) : 'None'}
                </pre>
              </div>
              {detail.session.v2_state_json != null && (
                <div>
                  <p className="text-slate-400">V2 State</p>
                  <pre className="text-slate-200 whitespace-pre-wrap text-xs bg-slate-900/50 p-2 rounded">
                    {String(detail.session.v2_state_json)}
                  </pre>
                </div>
              )}
              <div>
                <p className="text-slate-400">Turns</p>
                <div className="space-y-2">
                  {detail.turns.length === 0 ? (
                    <p className="text-slate-500 text-xs">No turns recorded.</p>
                  ) : (
                    detail.turns.map((turn) => (
                      <div key={turn.id} className="bg-slate-900/50 p-2 rounded">
                        <p className="text-slate-300 text-xs">Q{turn.turn_number}: {turn.question}</p>
                        <p className="text-slate-400 text-xs mt-1">A: {turn.answer || '—'}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
