import { useEffect, useState, useCallback } from 'react';
import { Mic, RefreshCw, AlertTriangle, Save, Info } from 'lucide-react';
import { useApi } from '../../../hooks/useApi';
import { DropdownSelector } from '../../../components/settings/DropdownSelector';

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
  { id: 'tiny', name: 'Tiny', detail: '~40MB, fastest, good accuracy' },
  { id: 'small', name: 'Small', detail: '~250MB, fast, better accuracy' },
  { id: 'medium', name: 'Medium', detail: '~750MB, moderate, best accuracy' },
  { id: 'large', name: 'Large', detail: '~1.5GB, slowest, highest accuracy' },
];

export function STTConfigTab() {
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

  const getProviderStatusBadge = (providerId: string) => {
    const status = config.provider_status[`stt_${providerId}`];
    if (!status) return null;

    const colors: Record<string, string> = {
      active: 'bg-emerald-500/20 text-emerald-400',
      paused: 'bg-amber-500/20 text-amber-400',
      disabled: 'bg-rose-500/20 text-rose-400',
    };

    return (
      <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || colors.disabled}`}>
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
      {/* Tab Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">Configure STT providers for voice input</p>
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
      <DropdownSelector
        label="Primary Provider"
        description="Used first for speech-to-text processing"
        value={config.primary_provider}
        options={PROVIDERS.map(p => ({ id: p.id, name: p.name, detail: `${p.description}, WER: ${p.wer}` }))}
        onChange={(value) => {
          setConfig(prev => {
            const next = { ...prev, primary_provider: value };
            // If primary matches fallback, auto-switch fallback
            if (value === prev.fallback_provider) {
              const alt = PROVIDERS.find(p => p.id !== value);
              if (alt) next.fallback_provider = alt.id;
            }
            return next;
          });
          setHasChanges(true);
        }}
        badge={getProviderStatusBadge(config.primary_provider)}
      />

      {/* Fallback Provider */}
      <DropdownSelector
        label="Fallback Provider"
        description="Used when primary provider fails or is unavailable"
        value={config.fallback_provider}
        options={PROVIDERS.filter(p => p.id !== config.primary_provider).map(p => ({ id: p.id, name: p.name, detail: p.description }))}
        onChange={(value) => {
          setConfig(prev => ({ ...prev, fallback_provider: value }));
          setHasChanges(true);
        }}
        badge={getProviderStatusBadge(config.fallback_provider)}
      />

      {/* WhisperKit Model */}
      <DropdownSelector
        label="WhisperKit Model"
        description="Larger models are more accurate but require more storage and are slower to process"
        value={config.whisperkit_model}
        options={WHISPERKIT_MODELS}
        onChange={(value) => {
          setConfig(prev => ({ ...prev, whisperkit_model: value }));
          setHasChanges(true);
        }}
        badge={
          <span className="flex items-center gap-1">
            <Mic className="w-3 h-3 text-slate-400" />
            <span className="text-[10px] text-slate-400">On-device</span>
          </span>
        }
      />

      {/* Provider Status Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Provider Status</h2>
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
                        <span className="text-xs text-slate-500">{'\u2014'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {hasChanges && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-sm text-amber-300">You have unsaved changes. Click "Save Changes" to apply.</span>
        </div>
      )}
    </div>
  );
}
