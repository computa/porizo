import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Save, Info, AlertTriangle } from 'lucide-react';
import { useApi } from '../../../hooks/useApi';
import { DropdownSelector } from '../../../components/settings/DropdownSelector';
import { LoadingState } from '../../../components/LoadingState';
import { ErrorState } from '../../../components/ErrorState';
import { useSaveToast } from '../../../hooks/useSaveToast';

interface MusicConfigData {
  default_provider: string;
  auto_style_routing: boolean;
  elevenlabs_generation_mode: 'composition_plan' | 'compose_detailed';
  auto_reroll_enabled: boolean;
  quality_threshold: number;
  max_rerolls: number;
  style_overrides: Record<string, Record<string, unknown>>;
  available_providers: Record<string, boolean>;
  available_generation_modes?: string[];
  updated_at?: string;
  updated_by?: string;
}

const defaultConfig: MusicConfigData = {
  default_provider: 'elevenlabs',
  auto_style_routing: true,
  elevenlabs_generation_mode: 'composition_plan',
  auto_reroll_enabled: true,
  quality_threshold: 72,
  max_rerolls: 1,
  style_overrides: {},
  available_providers: {},
  available_generation_modes: ['composition_plan', 'compose_detailed'],
};

const PROVIDERS = [
  { id: 'elevenlabs', name: 'ElevenLabs', description: 'High-quality TTS + voice cloning, low latency', cost: '~$0.01/render' },
  { id: 'suno', name: 'Suno', description: 'AI music generation with vocals, broader style range', cost: '~$0.03/render' },
];

export function MusicProviderTab() {
  const { get, put, loading, error } = useApi();
  const [config, setConfig] = useState<MusicConfigData>(defaultConfig);
  const [saving, setSaving] = useState(false);
  const { saveSuccess, showSaveToast } = useSaveToast();
  const [hasChanges, setHasChanges] = useState(false);
  const [styleOverridesDraft, setStyleOverridesDraft] = useState('{}');
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await get<MusicConfigData>('/music/config');
      const merged = {
        ...defaultConfig,
        ...data,
        style_overrides: data?.style_overrides || {},
        available_generation_modes: data?.available_generation_modes || defaultConfig.available_generation_modes,
      };
      setConfig(merged);
      setStyleOverridesDraft(JSON.stringify(merged.style_overrides, null, 2));
      setHasChanges(false);
      setSaveError(null);
    } catch {
      setConfig(defaultConfig);
      setStyleOverridesDraft('{}');
    }
  }, [get]);

  useEffect(() => {
    fetchConfig().catch(console.error);
  }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      let parsedOverrides: Record<string, unknown> = {};
      try {
        parsedOverrides = styleOverridesDraft.trim()
          ? JSON.parse(styleOverridesDraft)
          : {};
      } catch {
        setSaveError('Style overrides must be valid JSON.');
        setSaving(false);
        return;
      }

      await put('/music/config', {
        default_provider: config.default_provider,
        auto_style_routing: config.auto_style_routing,
        elevenlabs_generation_mode: config.elevenlabs_generation_mode,
        auto_reroll_enabled: config.auto_reroll_enabled,
        quality_threshold: Number(config.quality_threshold),
        max_rerolls: Number(config.max_rerolls),
        style_overrides: parsedOverrides,
      });
      await fetchConfig();
      showSaveToast();
    } catch (err) {
      console.error('Failed to save music config:', err);
      setSaveError('Failed to save music configuration.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !config.available_providers) {
    return <LoadingState message="Loading music provider config..." />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      {/* Tab Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">Configure music generation and voice routing</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchConfig().catch(console.error)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Reset
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

      {saveSuccess && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <span className="text-sm text-emerald-300">Music provider configuration saved successfully.</span>
        </div>
      )}

      {saveError && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span className="text-sm text-rose-300">{saveError}</span>
        </div>
      )}

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-200">
          <p className="font-medium mb-1">Music Provider Routing</p>
          <p className="text-blue-300/80">
            The default provider handles music generation for all renders. When auto style routing is enabled,
            Nigerian-specific styles (Afrobeats, Highlife, Juju) are automatically routed to Suno for better
            cultural accuracy, regardless of the default provider.
          </p>
        </div>
      </div>

      {/* Default Provider */}
      <DropdownSelector
        label="Default Provider"
        description="Primary music generation provider for all renders"
        value={config.default_provider}
        options={PROVIDERS.map(p => ({ id: p.id, name: p.name, detail: p.cost }))}
        onChange={(value) => {
          setConfig(prev => ({ ...prev, default_provider: value }));
          setHasChanges(true);
        }}
        badge={
          config.available_providers[config.default_provider] ? (
            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">Available</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 bg-rose-500/20 text-rose-400 rounded">Unavailable</span>
          )
        }
      />

      {/* Auto Style Routing Toggle */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-white">Auto Style Routing</span>
            <p className="text-xs text-slate-400 mt-1">
              When enabled, Nigerian music styles (Afrobeats, Highlife, Juju) are automatically
              routed to Suno for better cultural authenticity, even if ElevenLabs is the default.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.auto_style_routing}
            onClick={() => {
              setConfig(prev => ({ ...prev, auto_style_routing: !prev.auto_style_routing }));
              setHasChanges(true);
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${
              config.auto_style_routing ? 'bg-amber-500' : 'bg-slate-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.auto_style_routing ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      <DropdownSelector
        label="ElevenLabs Generation Mode"
        description="Choose composition strictness for ElevenLabs renders"
        value={config.elevenlabs_generation_mode}
        options={(config.available_generation_modes || ['composition_plan', 'compose_detailed']).map((mode) => ({
          id: mode,
          name: mode === 'compose_detailed' ? 'Compose Detailed' : 'Composition Plan',
          detail: mode === 'compose_detailed' ? 'Higher style lock, stricter sections' : 'Balanced plan-first mode',
        }))}
        onChange={(value) => {
          setConfig(prev => ({ ...prev, elevenlabs_generation_mode: value as 'composition_plan' | 'compose_detailed' }));
          setHasChanges(true);
        }}
      />

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-white">Auto Reroll on Low Quality</span>
            <p className="text-xs text-slate-400 mt-1">
              If render quality is below threshold, rerun once with tightened style constraints.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.auto_reroll_enabled}
            onClick={() => {
              setConfig(prev => ({ ...prev, auto_reroll_enabled: !prev.auto_reroll_enabled }));
              setHasChanges(true);
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${
              config.auto_reroll_enabled ? 'bg-amber-500' : 'bg-slate-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.auto_reroll_enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Quality Threshold (0-100)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={config.quality_threshold}
              onChange={(e) => {
                const value = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                setConfig(prev => ({ ...prev, quality_threshold: value }));
                setHasChanges(true);
              }}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Max Rerolls (0-3)</label>
            <input
              type="number"
              min={0}
              max={3}
              value={config.max_rerolls}
              onChange={(e) => {
                const value = Math.max(0, Math.min(3, Number(e.target.value) || 0));
                setConfig(prev => ({ ...prev, max_rerolls: value }));
                setHasChanges(true);
              }}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white"
            />
          </div>
        </div>
      </div>

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
        <label className="block text-sm font-medium text-white mb-2">Style Overrides (JSON)</label>
        <p className="text-xs text-slate-400 mb-3">
          Optional per-style/per-provider constraints. Example: {'{'} "ogene": {'{'} "elevenlabs": {'{'} "instruction_override": "...", "negative_constraints": ["..."] {'}'} {'}'} {'}'}
        </p>
        <textarea
          value={styleOverridesDraft}
          onChange={(e) => {
            setStyleOverridesDraft(e.target.value);
            setHasChanges(true);
          }}
          rows={10}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono"
        />
      </div>

      {/* Provider Status Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Provider Status</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Provider</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Available</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {PROVIDERS.map(provider => {
                const isAvailable = config.available_providers[provider.id];
                const isDefault = config.default_provider === provider.id;
                return (
                  <tr key={provider.id} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4 text-sm text-white">{provider.name}</td>
                    <td className="py-3 px-4">
                      {isAvailable ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">active</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400">no API key</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400">
                      {isDefault ? (
                        <span className="text-amber-400 font-medium">Default</span>
                      ) : '\u2014'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {config.updated_at && (
        <div className="text-xs text-slate-500 text-right">
          Last updated {new Date(config.updated_at).toLocaleString()}{config.updated_by ? ` by ${config.updated_by}` : ''}
        </div>
      )}

      {hasChanges && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span className="text-sm text-amber-300">You have unsaved changes.</span>
        </div>
      )}
    </div>
  );
}
