import { useEffect, useState, useCallback } from 'react';
import { Music, RefreshCw, AlertTriangle, Save, Info } from 'lucide-react';
import { useApi } from '../../hooks/useApi';

interface MusicConfigData {
  default_provider: string;
  auto_style_routing: boolean;
  available_providers: Record<string, boolean>;
  updated_at?: string;
  updated_by?: string;
}

const defaultConfig: MusicConfigData = {
  default_provider: 'elevenlabs',
  auto_style_routing: true,
  available_providers: {},
};

const PROVIDERS = [
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    description: 'High-quality TTS + voice cloning, low latency',
    cost: '~$0.01/render',
  },
  {
    id: 'suno',
    name: 'Suno',
    description: 'AI music generation with vocals, broader style range',
    cost: '~$0.03/render',
  },
];

export function MusicProviderConfig() {
  const { get, put, loading, error } = useApi();
  const [config, setConfig] = useState<MusicConfigData>(defaultConfig);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await get<MusicConfigData>('/music/config');
      setConfig(data);
      setHasChanges(false);
    } catch {
      setConfig(defaultConfig);
    }
  }, [get]);

  useEffect(() => {
    fetchConfig().catch(console.error);
  }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      await put('/music/config', {
        default_provider: config.default_provider,
        auto_style_routing: config.auto_style_routing,
      });
      await fetchConfig();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save music config:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !config.available_providers) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading music provider config...
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
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
            <Music className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Music Providers</h1>
            <p className="text-sm text-slate-400">Configure music generation and voice routing</p>
          </div>
        </div>
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

      {/* Success Message */}
      {saveSuccess && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <span className="text-sm text-emerald-300">Music provider configuration saved successfully.</span>
        </div>
      )}

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-200">
          <p className="font-medium mb-1">Music Provider Routing</p>
          <p className="text-blue-300/80">
            The default provider handles music generation for all renders. When auto style routing is enabled,
            Nigerian-specific styles (Afrobeats, Highlife, Jùjú) are automatically routed to Suno for better
            cultural accuracy, regardless of the default provider.
          </p>
        </div>
      </div>

      {/* Section 1: Default Provider */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center font-bold">1</span>
          Default Provider
        </h2>
        <div className="space-y-3">
          {PROVIDERS.map(provider => {
            const isAvailable = config.available_providers[provider.id];
            return (
              <label
                key={provider.id}
                className={`flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-colors ${
                  config.default_provider === provider.id
                    ? 'bg-amber-500/10 border-amber-500/50'
                    : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600'
                } ${!isAvailable ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="default_provider"
                    value={provider.id}
                    checked={config.default_provider === provider.id}
                    onChange={() => {
                      setConfig(prev => ({ ...prev, default_provider: provider.id }));
                      setHasChanges(true);
                    }}
                    className="w-4 h-4 text-amber-500 bg-slate-800 border-slate-600 focus:ring-amber-500/50"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{provider.name}</span>
                      {isAvailable ? (
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">
                          Available
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 bg-rose-500/20 text-rose-400 rounded">
                          Unavailable
                        </span>
                      )}
                      {provider.id === 'suno' && isAvailable && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded font-medium">
                          RECOMMENDED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">{provider.description}</p>
                  </div>
                </div>
                <span className="text-xs text-slate-500 font-mono">{provider.cost}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Section 2: Auto Style Routing */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center font-bold">2</span>
          Auto Style Routing
        </h2>
        <label className={`flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-colors ${
          config.auto_style_routing
            ? 'bg-amber-500/10 border-amber-500/50'
            : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600'
        }`}>
          <div>
            <span className="text-sm font-medium text-white">Smart provider switching for regional styles</span>
            <p className="text-xs text-slate-400 mt-1">
              When enabled, Nigerian music styles (Afrobeats, Highlife, Jùjú) are automatically
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
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
              config.auto_style_routing ? 'bg-amber-500' : 'bg-slate-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              config.auto_style_routing ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </label>
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
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Last Updated */}
      {config.updated_at && (
        <div className="text-xs text-slate-500 text-right">
          Last updated {new Date(config.updated_at).toLocaleString()}{config.updated_by ? ` by ${config.updated_by}` : ''}
        </div>
      )}

      {/* Unsaved Changes Warning */}
      {hasChanges && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span className="text-sm text-amber-300">You have unsaved changes.</span>
        </div>
      )}
    </div>
  );
}
