import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Save, AlertTriangle, Gift } from 'lucide-react';
import { useApi } from '../../../hooks/useApi';
import { LoadingState } from '../../../components/LoadingState';
import { ErrorState } from '../../../components/ErrorState';
import { useSaveToast } from '../../../hooks/useSaveToast';
import { getAdminUser } from '../../../utils/auth';

interface GiftBundle {
  id: string;
  product_id: string;
  display_name: string;
  token_count: number;
  price_cents: number;
  is_active: boolean;
  sort_order: number;
  description: string | null;
}

interface GiftBundlesResponse {
  bundles: GiftBundle[];
}

interface BundleEdits {
  display_name: string;
  token_count: number;
  is_active: boolean;
  sort_order: number;
  description: string;
}

function formatPrice(cents: number): string {
  return cents != null ? `$${(cents / 100).toFixed(2)}` : '\u2014';
}

export function GiftBundlesTab() {
  const { get, put, loading, error } = useApi('/admin');
  const [bundles, setBundles] = useState<GiftBundle[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<BundleEdits>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { saveSuccess, showSaveToast } = useSaveToast();

  const isSuperadmin = getAdminUser()?.role === 'superadmin';

  const fetchBundles = useCallback(async () => {
    try {
      const data = await get<GiftBundlesResponse>('/billing/gift-bundles');
      setBundles(data.bundles);
      setEdits({});
      setSaveError(null);
    } catch {
      // Error handled by useApi
    }
  }, [get]);

  useEffect(() => {
    fetchBundles().catch(console.error);
  }, [fetchBundles]);

  const getEditValue = <K extends keyof BundleEdits>(bundle: GiftBundle, field: K): BundleEdits[K] => {
    const edit = edits[bundle.id];
    if (edit && field in edit) return edit[field] as BundleEdits[K];
    if (field === 'description') return (bundle.description ?? '') as BundleEdits[K];
    return bundle[field] as BundleEdits[K];
  };

  const updateEdit = (bundleId: string, field: keyof BundleEdits, value: string | number | boolean) => {
    setEdits(prev => ({
      ...prev,
      [bundleId]: { ...prev[bundleId], [field]: value },
    }));
  };

  const hasEdits = (bundleId: string) => {
    const edit = edits[bundleId];
    return edit && Object.keys(edit).length > 0;
  };

  const handleSave = async (bundle: GiftBundle) => {
    const edit = edits[bundle.id];
    if (!edit) return;

    setSaving(bundle.id);
    setSaveError(null);
    try {
      await put(`/billing/gift-bundles/${bundle.id}`, {
        display_name: getEditValue(bundle, 'display_name'),
        token_count: Number(getEditValue(bundle, 'token_count')),
        is_active: getEditValue(bundle, 'is_active'),
        sort_order: Number(getEditValue(bundle, 'sort_order')),
        description: getEditValue(bundle, 'description') || null,
      });
      showSaveToast();
      setEdits(prev => {
        const next = { ...prev };
        delete next[bundle.id];
        return next;
      });
      await fetchBundles();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save bundle';
      setSaveError(message);
    } finally {
      setSaving(null);
    }
  };

  if (loading && bundles.length === 0) {
    return <LoadingState message="Loading gift bundles..." />;
  }

  if (error && bundles.length === 0) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      {/* Tab Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Manage gift bundle products for in-app purchase
        </p>
        <button
          onClick={() => fetchBundles().catch(console.error)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {saveSuccess && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <span className="text-sm text-emerald-300">Gift bundle saved successfully.</span>
        </div>
      )}

      {saveError && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span className="text-sm text-rose-300">{saveError}</span>
        </div>
      )}

      {!isSuperadmin && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span className="text-sm text-amber-300">Read-only view. Superadmin role required to edit gift bundles.</span>
        </div>
      )}

      {/* Bundles Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Gift className="w-5 h-5 text-rose-400" />
          <h2 className="text-lg font-semibold text-white">Gift Bundles</h2>
        </div>

        {bundles.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">
            No gift bundles configured. Create bundles via the API to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Product ID</th>
                  <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Display Name</th>
                  <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Tokens</th>
                  <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Price</th>
                  <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Active</th>
                  <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Sort</th>
                  <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Description</th>
                  {isSuperadmin && (
                    <th className="text-right py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {bundles.map(bundle => {
                  const modified = hasEdits(bundle.id);
                  const isSavingThis = saving === bundle.id;

                  return (
                    <tr key={bundle.id} className={`hover:bg-slate-800/30 ${modified ? 'bg-amber-500/5' : ''}`}>
                      {/* Product ID (read-only) */}
                      <td className="py-3 px-4">
                        <code className="text-xs text-slate-300 font-mono bg-slate-900/50 px-2 py-1 rounded">
                          {bundle.product_id}
                        </code>
                      </td>

                      {/* Display Name */}
                      <td className="py-3 px-4">
                        {isSuperadmin ? (
                          <input
                            type="text"
                            value={getEditValue(bundle, 'display_name')}
                            onChange={e => updateEdit(bundle.id, 'display_name', e.target.value)}
                            className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm text-white"
                          />
                        ) : (
                          <span className="text-sm text-white">{bundle.display_name}</span>
                        )}
                      </td>

                      {/* Token Count */}
                      <td className="py-3 px-4">
                        {isSuperadmin ? (
                          <input
                            type="number"
                            min={1}
                            max={10}
                            value={getEditValue(bundle, 'token_count')}
                            onChange={e => {
                              const v = Math.max(1, Math.min(10, Number(e.target.value) || 1));
                              updateEdit(bundle.id, 'token_count', v);
                            }}
                            className="w-20 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm text-white text-center"
                          />
                        ) : (
                          <span className="text-sm text-white">{bundle.token_count}</span>
                        )}
                      </td>

                      {/* Price (read-only) */}
                      <td className="py-3 px-4">
                        <span className="text-sm text-slate-300">{formatPrice(bundle.price_cents)}</span>
                      </td>

                      {/* Active Toggle */}
                      <td className="py-3 px-4">
                        {isSuperadmin ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={getEditValue(bundle, 'is_active')}
                            onClick={() => updateEdit(bundle.id, 'is_active', !getEditValue(bundle, 'is_active'))}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                              getEditValue(bundle, 'is_active') ? 'bg-emerald-500' : 'bg-slate-600'
                            }`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              getEditValue(bundle, 'is_active') ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                          </button>
                        ) : (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            bundle.is_active
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-slate-700 text-slate-400'
                          }`}>
                            {bundle.is_active ? 'active' : 'inactive'}
                          </span>
                        )}
                      </td>

                      {/* Sort Order */}
                      <td className="py-3 px-4">
                        {isSuperadmin ? (
                          <input
                            type="number"
                            min={0}
                            value={getEditValue(bundle, 'sort_order')}
                            onChange={e => updateEdit(bundle.id, 'sort_order', Math.max(0, Number(e.target.value) || 0))}
                            className="w-20 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm text-white text-center"
                          />
                        ) : (
                          <span className="text-sm text-slate-400">{bundle.sort_order}</span>
                        )}
                      </td>

                      {/* Description */}
                      <td className="py-3 px-4">
                        {isSuperadmin ? (
                          <input
                            type="text"
                            value={getEditValue(bundle, 'description')}
                            onChange={e => updateEdit(bundle.id, 'description', e.target.value)}
                            placeholder="Optional description"
                            className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm text-white placeholder:text-slate-600"
                          />
                        ) : (
                          <span className="text-sm text-slate-400">{bundle.description || '\u2014'}</span>
                        )}
                      </td>

                      {/* Save Button */}
                      {isSuperadmin && (
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleSave(bundle)}
                            disabled={!modified || isSavingThis}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ml-auto ${
                              modified
                                ? 'bg-rose-500 hover:bg-rose-600 text-white'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            <Save className={`w-3.5 h-3.5 ${isSavingThis ? 'animate-spin' : ''}`} />
                            {isSavingThis ? 'Saving...' : 'Save'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
