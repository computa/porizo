import { Fragment, useEffect, useState, useCallback } from 'react';
import { Plus, Edit2, BarChart3, Upload, ChevronDown, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useApi } from '../../hooks/useApi';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';

interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  template_id: string | null;
  sent_at: string | null;
  recipient_count: number;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
  unsubscribes: number;
  notes: string | null;
  created_at: string;
}

interface Engagement {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  contact_status: string;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
}

interface ImportResult {
  matched: number;
  skipped: number;
  bounced: number;
  unsubscribed: number;
  total: number;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const TYPES = ['email', 'push', 'social', 'partnership'] as const;
const STATUSES = ['draft', 'scheduled', 'sent', 'completed'] as const;

const statusColors: Record<string, string> = {
  draft: 'bg-slate-600/50 text-slate-300',
  scheduled: 'bg-blue-500/20 text-blue-400',
  sent: 'bg-green-500/20 text-green-400',
  completed: 'bg-emerald-500/20 text-emerald-400',
};

interface CampaignForm { name: string; type: string; status: string; recipient_count: number; notes: string }
const emptyForm: CampaignForm = { name: '', type: 'email', status: 'draft', recipient_count: 0, notes: '' };

export function CampaignTrackerTab() {
  const { get, post, put, loading, error } = useApi();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [statsForm, setStatsForm] = useState<{ id: string; opens: number; clicks: number; replies: number; bounces: number; unsubscribes: number } | null>(null);

  // Import state
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Engagement detail state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [engagementsLoading, setEngagementsLoading] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    const data = await get<{ campaigns: Campaign[] }>('/marketing/campaigns');
    setCampaigns(data.campaigns);
  }, [get]);

  useEffect(() => {
    fetchCampaigns().catch(console.error);
  }, [fetchCampaigns]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    await post('/marketing/campaigns', {
      name: form.name,
      type: form.type,
      status: form.status,
      recipient_count: form.recipient_count,
      notes: form.notes || null,
    });
    setForm(emptyForm);
    setShowForm(false);
    fetchCampaigns();
  };

  const handleUpdateStats = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statsForm) return;
    await put(`/marketing/campaigns/${statsForm.id}`, {
      opens: statsForm.opens,
      clicks: statsForm.clicks,
      replies: statsForm.replies,
      bounces: statsForm.bounces,
      unsubscribes: statsForm.unsubscribes,
    });
    setStatsForm(null);
    fetchCampaigns();
  };

  const handleStatusChange = async (id: string, status: string) => {
    await put(`/marketing/campaigns/${id}`, {
      status,
      ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
    });
    fetchCampaigns();
  };

  const handleImport = async (campaignId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingId(campaignId);
    setImportResult(null);
    setImportError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('adminToken') || '';
      const res = await fetch(`/admin/dashboard/marketing/campaigns/${campaignId}/import-results`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error?.message || 'Import failed');
      } else {
        setImportResult(data);
        fetchCampaigns(); // Refresh stats
      }
    } catch (err: unknown) {
      setImportError(getErrorMessage(err, 'Import failed'));
    } finally {
      setImportingId(null);
      e.target.value = '';
    }
  };

  const toggleEngagements = async (campaignId: string) => {
    if (expandedId === campaignId) {
      setExpandedId(null);
      setEngagements([]);
      return;
    }
    setExpandedId(campaignId);
    setEngagementsLoading(true);
    try {
      const data = await get<{ engagements: Engagement[] }>(`/marketing/campaigns/${campaignId}/engagements?limit=100`);
      setEngagements(data.engagements);
    } catch {
      setEngagements([]);
    } finally {
      setEngagementsLoading(false);
    }
  };

  // Chart data
  const chartData = campaigns
    .filter((c) => c.recipient_count > 0)
    .map((c) => ({
      name: c.name.length > 20 ? c.name.slice(0, 20) + '...' : c.name,
      Opens: c.opens,
      Clicks: c.clicks,
      Replies: c.replies,
      Bounces: c.bounces,
    }));

  if (loading && campaigns.length === 0) return <LoadingState message="Loading campaigns..." />;
  if (error && campaigns.length === 0) return <ErrorState message={`Error: ${error}`} />;

  return (
    <div className="space-y-6">
      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
          <h3 className="text-white font-medium mb-4">Campaign Performance</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                labelStyle={{ color: '#e2e8f0' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend />
              <Bar dataKey="Opens" fill="#f472b6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Clicks" fill="#60a5fa" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Replies" fill="#34d399" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Bounces" fill="#f87171" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Create button */}
      <div className="flex items-center justify-between">
        <h3 className="text-white font-medium">Campaigns</h3>
        <button
          onClick={() => { setShowForm(!showForm); setForm(emptyForm); }}
          className="flex items-center gap-2 px-4 py-2 bg-rose-500/20 text-rose-400 rounded-lg text-sm font-medium hover:bg-rose-500/30 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Campaign
        </button>
      </div>

      {/* Import feedback */}
      {importResult && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-sm text-green-400">
          Matched {importResult.matched} of {importResult.total} rows.
          {importResult.bounced > 0 && ` Bounced: ${importResult.bounced}.`}
          {importResult.unsubscribed > 0 && ` Unsubscribed: ${importResult.unsubscribed}.`}
          {importResult.skipped > 0 && ` Skipped (unknown email): ${importResult.skipped}.`}
        </div>
      )}
      {importError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-sm text-red-400">
          {importError}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-rose-500/50"
                placeholder="Q1 Cold Outreach..."
                required
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-sm text-slate-300"
              >
                {TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-sm text-slate-300"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Recipient Count</label>
              <input
                type="number"
                value={form.recipient_count}
                onChange={(e) => setForm({ ...form, recipient_count: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-rose-500/50"
                min={0}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-rose-500/50"
              rows={2}
              placeholder="Optional notes..."
            />
          </div>
          <div className="flex gap-3">
            <button type="submit" className="px-4 py-2 bg-rose-500 text-white rounded-lg text-sm font-medium hover:bg-rose-600 transition-colors">
              Create Campaign
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Stats edit modal */}
      {statsForm && (
        <form onSubmit={handleUpdateStats} className="bg-slate-800/50 border border-rose-500/30 rounded-xl p-5 space-y-4">
          <h4 className="text-white font-medium">Update Stats</h4>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {(['opens', 'clicks', 'replies', 'bounces', 'unsubscribes'] as const).map((field) => (
              <div key={field}>
                <label className="block text-xs text-slate-400 mb-1 capitalize">{field}</label>
                <input
                  type="number"
                  value={statsForm[field]}
                  onChange={(e) => setStatsForm({ ...statsForm, [field]: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-rose-500/50"
                  min={0}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button type="submit" className="px-4 py-2 bg-rose-500 text-white rounded-lg text-sm font-medium hover:bg-rose-600 transition-colors">
              Save Stats
            </button>
            <button type="button" onClick={() => setStatsForm(null)} className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Campaign list */}
      {campaigns.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <BarChart3 className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>No campaigns logged yet — create one above</p>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900/30">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider w-8"></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Recipients</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Opens</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Clicks</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Replies</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {campaigns.map((c) => (
                  <Fragment key={c.id}>
                    <tr className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 text-sm">
                        {c.recipient_count > 0 && (
                          <button onClick={() => toggleEngagements(c.id)} className="text-slate-400 hover:text-white transition-colors">
                            {expandedId === c.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-white font-medium">{c.name}</td>
                      <td className="px-4 py-3 text-sm text-slate-300 capitalize">{c.type}</td>
                      <td className="px-4 py-3 text-sm">
                        <select
                          value={c.status}
                          onChange={(e) => handleStatusChange(c.id, e.target.value)}
                          className={`text-xs px-2 py-1 rounded border-0 cursor-pointer ${statusColors[c.status] || 'bg-slate-600/50 text-slate-300'}`}
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300 font-mono">{c.recipient_count.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-slate-300 font-mono">{c.opens.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-slate-300 font-mono">{c.clicks.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-slate-300 font-mono">{c.replies.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setStatsForm({ id: c.id, opens: c.opens, clicks: c.clicks, replies: c.replies, bounces: c.bounces, unsubscribes: c.unsubscribes })}
                            className="text-slate-400 hover:text-rose-400 transition-colors"
                            title="Edit stats"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {(c.status === 'sent' || c.status === 'completed') && (
                            <label
                              className="flex items-center gap-1 text-slate-400 hover:text-blue-400 transition-colors cursor-pointer"
                              title="Import GMass results"
                            >
                              <Upload className="w-4 h-4" />
                              <input
                                type="file"
                                accept=".csv"
                                onChange={(e) => handleImport(c.id, e)}
                                className="hidden"
                                disabled={importingId === c.id}
                              />
                            </label>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Engagement detail row */}
                    {expandedId === c.id && (
                      <tr>
                        <td colSpan={9} className="px-8 py-4 bg-slate-900/30">
                          {engagementsLoading ? (
                            <div className="text-slate-400 text-sm py-2">Loading engagements...</div>
                          ) : engagements.length === 0 ? (
                            <div className="text-slate-500 text-sm py-2">No engagement data — import a GMass report first</div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full">
                                <thead>
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase">Name</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase">Email</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 uppercase">Opened</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 uppercase">Clicked</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 uppercase">Replied</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 uppercase">Bounced</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-slate-500 uppercase">Unsub</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/20">
                                  {engagements.map((eng) => (
                                    <tr key={eng.id} className="text-sm">
                                      <td className="px-3 py-2 text-slate-300">
                                        {[eng.first_name, eng.last_name].filter(Boolean).join(' ') || '—'}
                                      </td>
                                      <td className="px-3 py-2 text-slate-400">{eng.email || '—'}</td>
                                      <td className="px-3 py-2 text-center">{eng.opened ? '✓' : ''}</td>
                                      <td className="px-3 py-2 text-center">{eng.clicked ? '✓' : ''}</td>
                                      <td className="px-3 py-2 text-center">{eng.replied ? '✓' : ''}</td>
                                      <td className="px-3 py-2 text-center">{eng.bounced ? '✓' : ''}</td>
                                      <td className="px-3 py-2 text-center">{eng.unsubscribed ? '✓' : ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
