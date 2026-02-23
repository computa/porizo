import { useEffect, useState, useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { AlertCircle, Package, Edit3, ChevronDown, ChevronUp, Plus, X, Trash2, AlertTriangle, Check, Link } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  tier: string;
  songs_per_month: number;
  poems_per_month: number;
  previews_per_day: number;
  price_monthly_cents: number;
  price_annual_cents: number;
  description: string | null;
  features: string[];
  features_json?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface TrialConfig {
  songs_allowed: number;
  duration_days: number;
  is_active: boolean;
  updated_at?: string;
}

interface PlansResponse {
  plans: Plan[];
  trialConfig: TrialConfig;
}

function formatPrice(cents: number): string {
  return cents != null ? `$${(cents / 100).toFixed(2)}` : '—';
}

function formFromPlan(plan: Plan) {
  return {
    name: plan.name,
    songs_per_month: plan.songs_per_month,
    poems_per_month: plan.poems_per_month,
    previews_per_day: plan.previews_per_day,
    price_monthly_cents: plan.price_monthly_cents,
    price_annual_cents: plan.price_annual_cents,
    description: plan.description || '',
    features: plan.features.join('\n'),
    is_active: plan.is_active,
    sort_order: plan.sort_order,
  };
}

export function PlansTab() {
  const { get, loading, error } = useApi('/admin');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [trialConfig, setTrialConfig] = useState<TrialConfig | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchPlans = useCallback(async () => {
    try {
      const data = await get<PlansResponse>('/plans');
      setPlans(data.plans);
      setTrialConfig(data.trialConfig);
    } catch {
      // Error handled by useApi
    }
  }, [get]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  if (loading && plans.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading plans...
        </div>
      </div>
    );
  }

  if (error && plans.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-rose-400 bg-rose-500/10 px-4 py-3 rounded-lg">
          <AlertCircle className="w-5 h-5" />
          Error loading plans: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">Manage subscription plan entitlements, pricing, and App Store product mappings.</p>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-sm rounded-lg">
          <Plus className="w-4 h-4" /> Create Plan
        </button>
      </div>

      {showCreate && (
        <CreatePlanModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchPlans(); }} />
      )}

      {plans.length === 0 ? (
        <div className="card rounded-xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-700/50 flex items-center justify-center mx-auto mb-4">
            <Package className="w-8 h-8 text-slate-500" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">No Plans</h2>
          <p className="text-slate-400">No subscription plans configured yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onUpdate={fetchPlans} />
          ))}
        </div>
      )}

      {trialConfig && (
        <TrialConfigSection config={trialConfig} onUpdate={fetchPlans} />
      )}
    </div>
  );
}

function PlanCard({ plan, onUpdate }: { plan: Plan; onUpdate: () => void }) {
  const { put, loading } = useApi('/admin');
  const [editing, setEditing] = useState(false);
  const [showMappings, setShowMappings] = useState(false);
  const [form, setForm] = useState(() => formFromPlan(plan));
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const entitlementFields = ['songs_per_month', 'poems_per_month', 'previews_per_day'] as const;
  const hasEntitlementChange = entitlementFields.some(f => form[f] !== plan[f]);

  const handleSave = async () => {
    setSaveMsg(null);
    try {
      const { features, description, ...rest } = form;
      await put(`/plans/${plan.id}`, {
        ...rest,
        description: description || null,
        features_json: features.split('\n').filter(Boolean),
      });
      setSaveMsg({ type: 'success', text: 'Saved' });
      setEditing(false);
      onUpdate();
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (err) {
      setSaveMsg({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  const handleCancel = () => {
    setForm(formFromPlan(plan));
    setEditing(false);
    setSaveMsg(null);
  };

  return (
    <div className="card rounded-xl p-5 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            plan.is_active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600/30 text-slate-400'
          }`}>
            {plan.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <span className="text-xs text-slate-500 uppercase tracking-wider">{plan.tier}</span>
      </div>

      {editing ? (
        /* Edit Mode */
        <div className="space-y-3 flex-1">
          <label className="block">
            <span className="text-xs text-slate-400">Name</span>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full mt-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400">Songs/month</span>
              <input type="number" min={0} value={form.songs_per_month}
                onChange={e => setForm(f => ({ ...f, songs_per_month: parseInt(e.target.value) || 0 }))}
                className="w-full mt-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Poems/month</span>
              <input type="number" min={0} value={form.poems_per_month}
                onChange={e => setForm(f => ({ ...f, poems_per_month: parseInt(e.target.value) || 0 }))}
                className="w-full mt-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Previews/day (-1=∞)</span>
              <input type="number" min={-1} value={form.previews_per_day}
                onChange={e => setForm(f => ({ ...f, previews_per_day: parseInt(e.target.value) || 0 }))}
                className="w-full mt-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400">Monthly ($)</span>
              <input type="number" min={0} step="0.01"
                value={form.price_monthly_cents != null ? (form.price_monthly_cents / 100).toFixed(2) : ''}
                onChange={e => setForm(f => ({ ...f, price_monthly_cents: Math.round(parseFloat(e.target.value || '0') * 100) }))}
                className="w-full mt-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Annual ($)</span>
              <input type="number" min={0} step="0.01"
                value={form.price_annual_cents != null ? (form.price_annual_cents / 100).toFixed(2) : ''}
                onChange={e => setForm(f => ({ ...f, price_annual_cents: Math.round(parseFloat(e.target.value || '0') * 100) }))}
                className="w-full mt-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-slate-400">Description</span>
            <input type="text" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full mt-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Features (one per line)</span>
            <textarea rows={3} value={form.features}
              onChange={e => setForm(f => ({ ...f, features: e.target.value }))}
              className="w-full mt-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white resize-none" />
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="rounded border-slate-600" />
              Active
            </label>
            <label className="block">
              <span className="text-xs text-slate-400 mr-2">Sort</span>
              <input type="number" min={0} value={form.sort_order}
                onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-16 bg-slate-800/50 border border-slate-600/50 rounded-lg px-2 py-1 text-sm text-white" />
            </label>
          </div>

          {hasEntitlementChange && (
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-sm text-amber-300">
                Changes to entitlements affect new renewals only. Existing subscribers keep their current allowance until next billing cycle.
              </span>
            </div>
          )}

          {saveMsg && (
            <div className={`text-sm px-3 py-2 rounded-lg ${
              saveMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
            }`}>{saveMsg.text}</div>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-sm rounded-lg disabled:opacity-50">
              <Check className="w-3.5 h-3.5" /> Save
            </button>
            <button onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Display Mode */
        <>
          <div className="space-y-2 text-sm flex-1">
            <div className="flex justify-between">
              <span className="text-slate-400">Songs/month</span>
              <span className="text-white font-data">{plan.songs_per_month}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Poems/month</span>
              <span className="text-white font-data">{plan.poems_per_month}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Previews/day</span>
              <span className="text-white font-data">{plan.previews_per_day === -1 ? 'Unlimited' : plan.previews_per_day}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Monthly</span>
              <span className="text-white font-data">{formatPrice(plan.price_monthly_cents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Annual</span>
              <span className="text-white font-data">{formatPrice(plan.price_annual_cents)}</span>
            </div>
            {plan.description && (
              <p className="text-slate-500 text-xs pt-1">{plan.description}</p>
            )}
            {plan.features.length > 0 && (
              <ul className="text-xs text-slate-400 pt-1 space-y-0.5">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <span className="text-emerald-400">+</span> {f}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {saveMsg && (
            <div className={`text-sm px-3 py-2 rounded-lg mt-3 ${
              saveMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
            }`}>{saveMsg.text}</div>
          )}

          <div className="flex gap-2 mt-4 pt-3 border-t border-slate-700/50">
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg">
              <Edit3 className="w-3.5 h-3.5" /> Edit
            </button>
            <button onClick={() => setShowMappings(!showMappings)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg">
              <Link className="w-3.5 h-3.5" /> Mappings
              {showMappings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          {showMappings && (
            <ProductMappings planId={plan.id} />
          )}
        </>
      )}
    </div>
  );
}

function ProductMappings({ planId }: { planId: string }) {
  const { get, post, del, loading, error } = useApi('/admin');
  const [mappings, setMappings] = useState<Array<{ id: string; platform: string; product_id: string; billing_period: string }>>([]);
  const [adding, setAdding] = useState(false);
  const [newMapping, setNewMapping] = useState({ platform: 'apple', product_id: '', billing_period: 'monthly' });
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchMappings = useCallback(async () => {
    try {
      const data = await get<{ products: typeof mappings }>(`/plans/${planId}/products`);
      setMappings(data.products);
    } catch {
      // handled by useApi
    }
  }, [get, planId]);

  useEffect(() => {
    fetchMappings();
  }, [fetchMappings]);

  const handleAdd = async () => {
    if (!newMapping.product_id.trim()) return;
    setMsg(null);
    try {
      await post(`/plans/${planId}/products`, newMapping);
      setNewMapping({ platform: 'apple', product_id: '', billing_period: 'monthly' });
      setAdding(false);
      setMsg({ type: 'success', text: 'Mapping added' });
      fetchMappings();
      setTimeout(() => setMsg(null), 2000);
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed' });
    }
  };

  const handleDelete = async (platform: string, productId: string) => {
    setMsg(null);
    try {
      await del(`/products/${platform}/${productId}`);
      setMsg({ type: 'success', text: 'Removed' });
      fetchMappings();
      setTimeout(() => setMsg(null), 2000);
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed' });
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-700/30 space-y-2">
      {loading && mappings.length === 0 && (
        <p className="text-slate-500 text-xs">Loading mappings...</p>
      )}
      {error && <p className="text-rose-400 text-xs">{error}</p>}

      {mappings.length === 0 && !loading && (
        <p className="text-slate-500 text-xs">No product mappings.</p>
      )}

      {mappings.map((m) => (
        <div key={m.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              m.platform === 'apple' ? 'bg-sky-500/20 text-sky-400' : 'bg-emerald-500/20 text-emerald-400'
            }`}>
              {m.platform === 'apple' ? 'Apple' : 'Google'}
            </span>
            <code className="text-xs text-slate-300">{m.product_id}</code>
            <span className="text-xs text-slate-500">{m.billing_period}</span>
          </div>
          <button onClick={() => handleDelete(m.platform, m.product_id)}
            className="text-slate-500 hover:text-rose-400 p-1">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {msg && (
        <div className={`text-xs px-2 py-1 rounded ${
          msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
        }`}>{msg.text}</div>
      )}

      {adding ? (
        <div className="space-y-2 bg-slate-800/30 rounded-lg p-3">
          <div className="grid grid-cols-3 gap-2">
            <select value={newMapping.platform} onChange={e => setNewMapping(m => ({ ...m, platform: e.target.value }))}
              className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="apple">Apple</option>
              <option value="google">Google</option>
            </select>
            <input type="text" placeholder="Product ID" value={newMapping.product_id}
              onChange={e => setNewMapping(m => ({ ...m, product_id: e.target.value }))}
              className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-2 py-1.5 text-xs text-white" />
            <select value={newMapping.billing_period} onChange={e => setNewMapping(m => ({ ...m, billing_period: e.target.value }))}
              className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={loading || !newMapping.product_id.trim()}
              className="flex items-center gap-1 px-2 py-1 bg-rose-500 hover:bg-rose-600 text-white text-xs rounded-lg disabled:opacity-50">
              <Check className="w-3 h-3" /> Add
            </button>
            <button onClick={() => setAdding(false)}
              className="flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
          <Plus className="w-3 h-3" /> Add mapping
        </button>
      )}
    </div>
  );
}

function TrialConfigSection({ config, onUpdate }: { config: TrialConfig; onUpdate: () => void }) {
  const { put, loading } = useApi('/admin');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    songs_allowed: config.songs_allowed,
    duration_days: config.duration_days,
    is_active: config.is_active,
  });
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSave = async () => {
    setMsg(null);
    try {
      await put('/trial/config', {
        songs_allowed: Math.max(1, Math.min(10, form.songs_allowed)),
        duration_days: Math.max(1, Math.min(30, form.duration_days)),
        is_active: form.is_active,
      });
      setMsg({ type: 'success', text: 'Trial config saved' });
      setEditing(false);
      onUpdate();
      setTimeout(() => setMsg(null), 2000);
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  const handleCancel = () => {
    setForm({ songs_allowed: config.songs_allowed, duration_days: config.duration_days, is_active: config.is_active });
    setEditing(false);
    setMsg(null);
  };

  return (
    <div className="card rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Trial Configuration</h2>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg">
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-slate-400">Songs allowed (1-10)</span>
              <input type="number" min={1} max={10} value={form.songs_allowed}
                onChange={e => setForm(f => ({ ...f, songs_allowed: parseInt(e.target.value) || 1 }))}
                className="w-full mt-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Duration (days, 1-30)</span>
              <input type="number" min={1} max={30} value={form.duration_days}
                onChange={e => setForm(f => ({ ...f, duration_days: parseInt(e.target.value) || 1 }))}
                className="w-full mt-1 bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.is_active}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              className="rounded border-slate-600" />
            Trial active
          </label>

          {msg && (
            <div className={`text-sm px-3 py-2 rounded-lg ${
              msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
            }`}>{msg.text}</div>
          )}

          <div className="flex gap-2">
            <button onClick={handleSave} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-sm rounded-lg disabled:opacity-50">
              <Check className="w-3.5 h-3.5" /> Save
            </button>
            <button onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Songs allowed</span>
            <span className="text-white font-data">{config.songs_allowed}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Duration</span>
            <span className="text-white font-data">{config.duration_days} days</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Status</span>
            <span className={config.is_active ? 'text-emerald-400' : 'text-slate-400'}>
              {config.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          {msg && (
            <div className={`text-sm px-3 py-2 rounded-lg ${
              msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
            }`}>{msg.text}</div>
          )}
        </div>
      )}
    </div>
  );
}

function CreatePlanModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { post, loading } = useApi('/admin');
  const [form, setForm] = useState({
    id: '',
    name: '',
    tier: 'plus',
    songs_per_month: 4,
    poems_per_month: 0,
    previews_per_day: -1,
    price_monthly_cents: 0,
    price_annual_cents: 0,
    description: '',
    features: '',
    sort_order: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);
    try {
      await post('/plans', {
        ...(form.id.trim() ? { id: form.id.trim() } : {}),
        name: form.name,
        tier: form.tier,
        songs_per_month: form.songs_per_month,
        poems_per_month: form.poems_per_month,
        previews_per_day: form.previews_per_day,
        price_monthly_cents: form.price_monthly_cents,
        price_annual_cents: form.price_annual_cents,
        description: form.description || null,
        features_json: form.features.split('\n').filter(Boolean),
        sort_order: form.sort_order,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Create Plan</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400">Plan ID (optional)</span>
              <input type="text" placeholder="Auto-generated" value={form.id}
                onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
                className="w-full mt-1 bg-slate-900/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Tier *</span>
              <select value={form.tier} onChange={e => setForm(f => ({ ...f, tier: e.target.value }))}
                className="w-full mt-1 bg-slate-900/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white">
                <option value="free">free</option>
                <option value="trial">trial</option>
                <option value="plus">plus</option>
                <option value="pro">pro</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-slate-400">Name *</span>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full mt-1 bg-slate-900/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400">Songs/month *</span>
              <input type="number" min={0} value={form.songs_per_month}
                onChange={e => setForm(f => ({ ...f, songs_per_month: parseInt(e.target.value) || 0 }))}
                className="w-full mt-1 bg-slate-900/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Poems/month</span>
              <input type="number" min={0} value={form.poems_per_month}
                onChange={e => setForm(f => ({ ...f, poems_per_month: parseInt(e.target.value) || 0 }))}
                className="w-full mt-1 bg-slate-900/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Previews/day (-1=∞)</span>
              <input type="number" min={-1} value={form.previews_per_day}
                onChange={e => setForm(f => ({ ...f, previews_per_day: parseInt(e.target.value) || 0 }))}
                className="w-full mt-1 bg-slate-900/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400">Monthly price ($)</span>
              <input type="number" min={0} step="0.01"
                value={(form.price_monthly_cents / 100).toFixed(2)}
                onChange={e => setForm(f => ({ ...f, price_monthly_cents: Math.round(parseFloat(e.target.value || '0') * 100) }))}
                className="w-full mt-1 bg-slate-900/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">Annual price ($)</span>
              <input type="number" min={0} step="0.01"
                value={(form.price_annual_cents / 100).toFixed(2)}
                onChange={e => setForm(f => ({ ...f, price_annual_cents: Math.round(parseFloat(e.target.value || '0') * 100) }))}
                className="w-full mt-1 bg-slate-900/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-slate-400">Description</span>
            <input type="text" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full mt-1 bg-slate-900/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Features (one per line)</span>
            <textarea rows={3} value={form.features}
              onChange={e => setForm(f => ({ ...f, features: e.target.value }))}
              className="w-full mt-1 bg-slate-900/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white resize-none" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Sort order</span>
            <input type="number" min={0} value={form.sort_order}
              onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
              className="w-full mt-1 bg-slate-900/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white" />
          </label>

          {error && (
            <div className="text-sm px-3 py-2 rounded-lg bg-rose-500/10 text-rose-400">{error}</div>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={handleCreate} disabled={loading || !form.name.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm rounded-lg disabled:opacity-50">
              <Plus className="w-4 h-4" /> Create
            </button>
            <button onClick={onClose}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
