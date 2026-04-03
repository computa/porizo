import { useEffect, useState, useCallback } from 'react';
import { Plus, RefreshCw, Pencil, Trash2, Power, X, Check } from 'lucide-react';
import { useApi } from '../../../hooks/useApi';
import { LoadingState } from '../../../components/LoadingState';
import { ErrorState } from '../../../components/ErrorState';

interface OnboardingSample {
  id: string;
  label: string;
  audio_url: string;
  is_active: boolean | number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface SamplesResponse {
  samples: OnboardingSample[];
}

interface EditingState {
  id: string;
  label: string;
  audio_url: string;
}

export function OnboardingTab() {
  const { get, post, put, del, loading, error } = useApi();
  const [samples, setSamples] = useState<OnboardingSample[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchSamples = useCallback(async () => {
    try {
      const data = await get<SamplesResponse>('/onboarding-samples');
      setSamples(data.samples);
      setActionError(null);
    } catch {
      // Error handled by useApi
    }
  }, [get]);

  useEffect(() => {
    fetchSamples().catch(console.error);
  }, [fetchSamples]);

  const handleAdd = async () => {
    if (!addLabel.trim() || !addUrl.trim()) return;
    setAdding(true);
    setActionError(null);
    try {
      await post('/onboarding-samples', { label: addLabel.trim(), audio_url: addUrl.trim() });
      setAddLabel('');
      setAddUrl('');
      setShowAddForm(false);
      await fetchSamples();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to add sample');
    } finally {
      setAdding(false);
    }
  };

  const handleEdit = async () => {
    if (!editing || !editing.label.trim() || !editing.audio_url.trim()) return;
    setSaving(true);
    setActionError(null);
    try {
      await put(`/onboarding-samples/${editing.id}`, {
        label: editing.label.trim(),
        audio_url: editing.audio_url.trim(),
      });
      setEditing(null);
      await fetchSamples();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update sample');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setActionError(null);
    try {
      await del(`/onboarding-samples/${id}`);
      setConfirmDeleteId(null);
      await fetchSamples();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete sample');
    } finally {
      setDeletingId(null);
    }
  };

  const handleActivate = async (id: string) => {
    setActivatingId(id);
    setActionError(null);
    try {
      await put(`/onboarding-samples/${id}/activate`, {});
      await fetchSamples();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to activate sample');
    } finally {
      setActivatingId(null);
    }
  };

  const isActive = (sample: OnboardingSample) =>
    sample.is_active === true || sample.is_active === 1;

  if (loading && samples.length === 0) {
    return <LoadingState message="Loading onboarding samples..." />;
  }

  if (error && samples.length === 0) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-white">Onboarding Audio Samples</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchSamples().catch(console.error)}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={() => { setShowAddForm(true); setActionError(null); }}
              disabled={showAddForm}
              className="flex items-center gap-2 px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Sample
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-400 mb-6">
          Manage audio samples shown on the onboarding screen. Only one sample can be active at a time.
        </p>

        {actionError && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
            <p className="text-sm text-rose-300">{actionError}</p>
          </div>
        )}

        {/* Add Form */}
        {showAddForm && (
          <div className="mb-4 p-4 bg-slate-700/50 border border-slate-600/50 rounded-lg">
            <h3 className="text-sm font-medium text-white mb-3">New Sample</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Label</label>
                <input
                  type="text"
                  value={addLabel}
                  onChange={e => setAddLabel(e.target.value)}
                  placeholder="e.g. Cafeteria Light (Drive Home Ad)"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Audio URL</label>
                <input
                  type="text"
                  value={addUrl}
                  onChange={e => setAddUrl(e.target.value)}
                  placeholder="e.g. /audio/cafeteria-light-trimmed.mp3"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleAdd}
                  disabled={adding || !addLabel.trim() || !addUrl.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  {adding ? 'Adding...' : 'Add'}
                </button>
                <button
                  onClick={() => { setShowAddForm(false); setAddLabel(''); setAddUrl(''); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-slate-300 rounded-lg text-sm transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        {samples.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <p className="text-sm text-slate-400">No onboarding samples configured.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left py-3 px-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Label</th>
                  <th className="text-left py-3 px-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Audio URL</th>
                  <th className="text-left py-3 px-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Active</th>
                  <th className="text-right py-3 px-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {samples.map(sample => (
                  <tr key={sample.id} className="hover:bg-slate-700/20">
                    {editing?.id === sample.id ? (
                      <>
                        <td className="py-3 px-3">
                          <input
                            type="text"
                            value={editing.label}
                            onChange={e => setEditing({ ...editing, label: e.target.value })}
                            className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-rose-500"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <input
                            type="text"
                            value={editing.audio_url}
                            onChange={e => setEditing({ ...editing, audio_url: e.target.value })}
                            className="w-full px-2 py-1 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-rose-500"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            isActive(sample) ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600/50 text-slate-400'
                          }`}>
                            {isActive(sample) ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={handleEdit}
                              disabled={saving || !editing.label.trim() || !editing.audio_url.trim()}
                              className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors disabled:opacity-50"
                              title="Save"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setEditing(null)}
                              className="p-1.5 text-slate-400 hover:bg-slate-600/50 rounded transition-colors"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-3 px-3 text-white">{sample.label}</td>
                        <td className="py-3 px-3 text-slate-300 font-mono text-xs">{sample.audio_url}</td>
                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            isActive(sample) ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600/50 text-slate-400'
                          }`}>
                            {isActive(sample) ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {!isActive(sample) && (
                              <button
                                onClick={() => handleActivate(sample.id)}
                                disabled={activatingId === sample.id}
                                className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors disabled:opacity-50"
                                title="Activate"
                              >
                                <Power className={`w-3.5 h-3.5 ${activatingId === sample.id ? 'animate-pulse' : ''}`} />
                              </button>
                            )}
                            <button
                              onClick={() => setEditing({ id: sample.id, label: sample.label, audio_url: sample.audio_url })}
                              className="p-1.5 text-slate-400 hover:bg-slate-600/50 rounded transition-colors"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {confirmDeleteId === sample.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleDelete(sample.id)}
                                  disabled={deletingId === sample.id}
                                  className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded transition-colors disabled:opacity-50"
                                  title="Confirm delete"
                                >
                                  <Check className={`w-3.5 h-3.5 ${deletingId === sample.id ? 'animate-pulse' : ''}`} />
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="p-1.5 text-slate-400 hover:bg-slate-600/50 rounded transition-colors"
                                  title="Cancel delete"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(sample.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
