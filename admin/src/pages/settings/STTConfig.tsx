import { useEffect, useState, useCallback } from 'react';
import { Mic, RefreshCw, AlertTriangle, Save, Info } from 'lucide-react';
import { useApi } from '../../hooks/useApi';

interface STTConfigData {
  primary_provider: string;
  fallback_provider: string;
  whisperkit_model: string;
  provider_status: Record<string, string>;
}

const defaultConfig: STTConfigData = {
  primary_provider: 'whisperkit',
  fallback_provider: 'openai',
  whisperkit_model: 'small',
  provider_status: {},
};

const PROVIDERS = [
  { id: 'apple', name: 'Apple SpeechAnalyzer', description: 'iOS 26+, on-device, free', wer: '~9%' },
  { id: 'whisperkit', name: 'WhisperKit', description: 'On-device, requires model download', wer: '~2.2%' },
  { id: 'openai', name: 'OpenAI Whisper', description: 'Cloud, $0.006/min', wer: '~3%' },
];

const WHISPERKIT_MODELS = [
  { id: 'tiny', name: 'Tiny', size: '~40MB', speed: 'Fastest', accuracy: 'Good' },
  { id: 'small', name: 'Small', size: '~250MB', speed: 'Fast', accuracy: 'Better' },
  { id: 'medium', name: 'Medium', size: '~750MB', speed: 'Moderate', accuracy: 'Best' },
  { id: 'large', name: 'Large', size: '~1.5GB', speed: 'Slowest', accuracy: 'Highest' },
];

export function STTConfig() {
  const { get, put, loading, error } = useApi();
  const [config, setConfig] = useState<STTConfigData>(defaultConfig);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await get<STTConfigData>('/stt/config');
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
      await put('/stt/config', {
        primary_provider: config.primary_provider,
        fallback_provider: config.fallback_provider,
        whisperkit_model: config.whisperkit_model,
      });
      setSaveSuccess(true);
      setHasChanges(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = <K extends keyof STTConfigData>(
    key: K,
    value: STTConfigData[K]
  ) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const getProviderStatusBadge = (providerId: string) => {
    const status = config.provider_status[`stt_${providerId}`];
    if (!status) return null;

    const colors = {
      active: 'bg-emerald-500/20 text-emerald-400',
      paused: 'bg-amber-500/20 text-amber-400',
      disabled: 'bg-rose-500/20 text-rose-400',
    };

    return (
      <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status as keyof typeof colors] || colors.disabled}`}>
        {status}
      </span>
    );
  };

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading STT config...
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
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <Mic className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Speech-to-Text Config</h1>
            <p className="text-sm text-slate-400">Configure STT providers for voice input</p>
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
          <span className="text-sm text-emerald-300">STT configuration saved. iOS apps will pick up changes on next launch.</span>
        </div>
      )}

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-200">
          <p className="font-medium mb-1">Multi-Provider STT System</p>
          <p className="text-blue-300/80">
            iOS apps fetch this config at launch. The primary provider is used first; if it fails, the fallback is used.
            WhisperKit offers highest accuracy (~2.2% WER) for diverse accents. OpenAI Whisper is the cloud fallback.
          </p>
        </div>
      </div>

      {/* Primary Provider */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center font-bold">1</span>
          Primary Provider
        </h2>
        <div className="space-y-3">
          {PROVIDERS.map(provider => (
            <label
              key={provider.id}
              className={`flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-colors ${
                config.primary_provider === provider.id
                  ? 'bg-cyan-500/10 border-cyan-500/50'
                  : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="primary_provider"
                  value={provider.id}
                  checked={config.primary_provider === provider.id}
                  onChange={(e) => updateConfig('primary_provider', e.target.value)}
                  className="w-4 h-4 text-cyan-500 bg-slate-800 border-slate-600 focus:ring-cyan-500/50"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{provider.name}</span>
                    {getProviderStatusBadge(provider.id)}
                  </div>
                  <p className="text-xs text-slate-400">{provider.description}</p>
                </div>
              </div>
              <span className="text-xs text-slate-500 font-mono">WER: {provider.wer}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Fallback Provider */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center font-bold">2</span>
          Fallback Provider
        </h2>
        <p className="text-sm text-slate-400 mb-4">Used when primary provider fails or is unavailable.</p>
        <select
          value={config.fallback_provider}
          onChange={(e) => updateConfig('fallback_provider', e.target.value)}
          className="w-full max-w-md bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
        >
          {PROVIDERS.filter(p => p.id !== config.primary_provider).map(provider => (
            <option key={provider.id} value={provider.id}>
              {provider.name} ({provider.description})
            </option>
          ))}
        </select>
      </div>

      {/* WhisperKit Model Selection */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Mic className="w-5 h-5 text-slate-400" />
          WhisperKit Model
        </h2>
        <p className="text-sm text-slate-400 mb-4">
          Larger models are more accurate but require more storage and are slower to process.
        </p>
        <div className="grid grid-cols-2 gap-3 max-w-2xl">
          {WHISPERKIT_MODELS.map(model => (
            <label
              key={model.id}
              className={`flex flex-col p-4 rounded-lg border cursor-pointer transition-colors ${
                config.whisperkit_model === model.id
                  ? 'bg-cyan-500/10 border-cyan-500/50'
                  : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="radio"
                  name="whisperkit_model"
                  value={model.id}
                  checked={config.whisperkit_model === model.id}
                  onChange={(e) => updateConfig('whisperkit_model', e.target.value)}
                  className="w-4 h-4 text-cyan-500 bg-slate-800 border-slate-600 focus:ring-cyan-500/50"
                />
                <span className="text-sm font-medium text-white">{model.name}</span>
                {model.id === 'small' && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 rounded font-medium">
                    RECOMMENDED
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 space-y-1 ml-6">
                <p>Size: {model.size}</p>
                <p>Speed: {model.speed}</p>
                <p>Accuracy: {model.accuracy}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Provider Status Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Provider Status</h2>
        <p className="text-sm text-slate-400 mb-4">
          Manage provider availability from the Providers page. Disabled providers will be skipped.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Provider</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {PROVIDERS.map(provider => {
                const status = config.provider_status[`stt_${provider.id}`] || 'unknown';
                const isPrimary = config.primary_provider === provider.id;
                const isFallback = config.fallback_provider === provider.id;
                return (
                  <tr key={provider.id} className="hover:bg-slate-800/30">
                    <td className="py-3 px-4 text-sm text-slate-200">{provider.name}</td>
                    <td className="py-3 px-4">
                      {getProviderStatusBadge(provider.id) || (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">unknown</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {isPrimary && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Primary</span>
                      )}
                      {isFallback && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">Fallback</span>
                      )}
                      {!isPrimary && !isFallback && (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
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
