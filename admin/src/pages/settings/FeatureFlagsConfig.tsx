import { useEffect, useState, useCallback } from 'react';
import { Settings, RefreshCw, AlertTriangle, Save, Info, RotateCcw } from 'lucide-react';
import { useApi } from '../../hooks/useApi';

interface FlagMetadata {
  id: string;
  value: number | string | boolean;
  defaultValue: number | string | boolean;
  label: string;
  description: string;
  type: 'number' | 'string' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  category: string;
}

interface FeatureFlagsResponse {
  flags: Record<string, FlagMetadata[]>;
}

interface UpdateResult {
  success: boolean;
  updated?: { flagId: string; value: unknown }[];
  errors?: { flagId: string; error: string }[];
}

export function FeatureFlagsConfig() {
  const { get, put, loading, error } = useApi();
  const [flags, setFlags] = useState<Record<string, FlagMetadata[]>>({});
  const [changes, setChanges] = useState<Record<string, number | string | boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveErrors, setSaveErrors] = useState<{ flagId: string; error: string }[]>([]);

  const hasChanges = Object.keys(changes).length > 0;

  const fetchFlags = useCallback(async () => {
    try {
      const data = await get<FeatureFlagsResponse>('/feature-flags');
      setFlags(data.flags);
      setChanges({});
      setSaveErrors([]);
    } catch {
      // Error handled by useApi
    }
  }, [get]);

  useEffect(() => {
    fetchFlags().catch(console.error);
  }, [fetchFlags]);

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setSaveErrors([]);
    try {
      const result = await put<UpdateResult>('/feature-flags', changes);
      if (result.success) {
        setSaveSuccess(true);
        setChanges({});
        setTimeout(() => setSaveSuccess(false), 3000);
        // Refresh to get updated values
        await fetchFlags();
      } else if (result.errors) {
        setSaveErrors(result.errors);
      }
    } catch (err) {
      // Show error in UI instead of just logging
      const message = err instanceof Error ? err.message : 'Unknown error occurred';
      setSaveErrors([{ flagId: 'general', error: message }]);
      console.error('Failed to save flags:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setChanges({});
    setSaveErrors([]);
  };

  const updateFlag = (flagId: string, value: number | string | boolean) => {
    setChanges(prev => {
      // Find the original value
      const allFlags = Object.values(flags).flat();
      const flag = allFlags.find(f => f.id === flagId);
      if (flag && flag.value === value) {
        // Remove from changes if reverting to original
        const { [flagId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [flagId]: value };
    });
  };

  const resetToDefault = (flag: FlagMetadata) => {
    updateFlag(flag.id, flag.defaultValue);
  };

  const getCurrentValue = (flag: FlagMetadata): number | string | boolean => {
    if (flag.id in changes) {
      return changes[flag.id];
    }
    return flag.value;
  };

  const isModified = (flagId: string): boolean => {
    return flagId in changes;
  };

  if (loading && Object.keys(flags).length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading feature flags...
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

  const voiceConversionFlags = flags['voice_conversion'] || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
            <Settings className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Feature Flags</h1>
            <p className="text-sm text-slate-400">Runtime configuration for voice conversion</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReset}
            disabled={!hasChanges || saving}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-4 h-4" />
            Discard
          </button>
          <button
            onClick={() => fetchFlags().catch(console.error)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              hasChanges
                ? 'bg-rose-500 hover:bg-rose-600 text-white'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Save className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
            {saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Success Message */}
      {saveSuccess && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <span className="text-sm text-emerald-300">Feature flags saved. Changes take effect on next render.</span>
        </div>
      )}

      {/* Error Messages */}
      {saveErrors.length > 0 && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
          <p className="text-sm font-medium text-rose-300 mb-2">Some flags failed to save:</p>
          <ul className="text-sm text-rose-400 space-y-1">
            {saveErrors.map(({ flagId, error }) => (
              <li key={flagId}>{flagId}: {error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-200">
          <p className="font-medium mb-1">Voice Conversion Parameters</p>
          <p className="text-blue-300/80">
            These settings control the Seed-VC voice conversion quality. CFG Rate balances voice similarity vs natural singing.
            Diffusion steps control quality (higher = better but slower). Changes apply to new renders only.
          </p>
        </div>
      </div>

      {/* Voice Conversion Flags */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-6">Voice Conversion</h2>
        <div className="space-y-8">
          {voiceConversionFlags.map(flag => (
            <div key={flag.id} className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{flag.label}</span>
                    {isModified(flag.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded font-medium">
                        MODIFIED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{flag.description}</p>
                </div>
                <button
                  onClick={() => resetToDefault(flag)}
                  disabled={getCurrentValue(flag) === flag.defaultValue}
                  className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={`Reset to default (${flag.defaultValue})`}
                >
                  Reset
                </button>
              </div>

              {flag.type === 'number' && flag.id === 'seedvc_cfg_rate' ? (
                // Special slider for CFG Rate
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={flag.min ?? 0}
                      max={flag.max ?? 1}
                      step={flag.step ?? 0.05}
                      value={getCurrentValue(flag) as number}
                      onChange={(e) => updateFlag(flag.id, parseFloat(e.target.value))}
                      className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                    />
                    <span className="w-16 text-right font-mono text-sm text-violet-400">
                      {(getCurrentValue(flag) as number).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 px-1">
                    <span>Natural singing</span>
                    <span>Voice similarity</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-600 px-1">
                    <span>{flag.min}</span>
                    <span>0.4 (rec)</span>
                    <span>{flag.max}</span>
                  </div>
                </div>
              ) : flag.type === 'number' ? (
                // Number input for diffusion steps
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    min={flag.min}
                    max={flag.max}
                    step={flag.step ?? 1}
                    value={getCurrentValue(flag) as number}
                    onChange={(e) => updateFlag(flag.id, parseInt(e.target.value) || flag.defaultValue as number)}
                    className="w-32 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                  />
                  <span className="text-xs text-slate-500">
                    Range: {flag.min} - {flag.max} (default: {flag.defaultValue})
                  </span>
                </div>
              ) : (
                // Fallback for other types
                <input
                  type="text"
                  value={String(getCurrentValue(flag))}
                  onChange={(e) => updateFlag(flag.id, e.target.value)}
                  className="w-full max-w-md bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Quick Reference */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Parameter Guide</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Parameter</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Low Value</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">High Value</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Recommended</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              <tr className="hover:bg-slate-800/30">
                <td className="py-3 px-4 text-sm text-slate-200">CFG Rate</td>
                <td className="py-3 px-4 text-sm text-slate-400">Natural singing, less voice match</td>
                <td className="py-3 px-4 text-sm text-slate-400">Strong voice match, may sound robotic</td>
                <td className="py-3 px-4">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 font-mono">0.4</span>
                </td>
              </tr>
              <tr className="hover:bg-slate-800/30">
                <td className="py-3 px-4 text-sm text-slate-200">Diffusion Steps (Preview)</td>
                <td className="py-3 px-4 text-sm text-slate-400">Faster, lower quality</td>
                <td className="py-3 px-4 text-sm text-slate-400">Slower, higher quality</td>
                <td className="py-3 px-4">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 font-mono">50</span>
                </td>
              </tr>
              <tr className="hover:bg-slate-800/30">
                <td className="py-3 px-4 text-sm text-slate-200">Diffusion Steps (Full)</td>
                <td className="py-3 px-4 text-sm text-slate-400">Faster, lower quality</td>
                <td className="py-3 px-4 text-sm text-slate-400">Slower, higher quality</td>
                <td className="py-3 px-4">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 font-mono">100</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Unsaved Changes Warning */}
      {hasChanges && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-sm text-amber-300">You have unsaved changes. Click "Save Changes" to apply.</span>
        </div>
      )}
    </div>
  );
}
