import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Settings, Music, Mic, AudioWaveform, UserCheck, Code2, Gift, RefreshCw, Save, RotateCcw, AlertTriangle } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import type { FlagMetadata } from '../../components/settings/FlagRenderer';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { useSaveToast } from '../../hooks/useSaveToast';
import { MusicProviderTab } from './tabs/MusicProviderTab';
import { STTConfigTab } from './tabs/STTConfigTab';
import { VoiceConversionTab } from './tabs/VoiceConversionTab';
import { VoiceEnrollmentTab } from './tabs/VoiceEnrollmentTab';
import { DeveloperTab } from './tabs/DeveloperTab';
import { GiftBundlesTab } from './tabs/GiftBundlesTab';

interface FeatureFlagsResponse {
  flags: Record<string, FlagMetadata[]>;
}

interface UpdateResult {
  success: boolean;
  updated?: { flagId: string; value: unknown }[];
  errors?: { flagId: string; error: string }[];
}

const TABS = [
  { id: 'music', label: 'Music Providers', icon: Music },
  { id: 'stt', label: 'STT Config', icon: Mic },
  { id: 'voice-conversion', label: 'Voice Conversion', icon: AudioWaveform },
  { id: 'voice-enrollment', label: 'Voice Enrollment', icon: UserCheck },
  { id: 'developer', label: 'Developer', icon: Code2 },
  { id: 'gift-bundles', label: 'Gift Bundles', icon: Gift },
] as const;

type TabId = typeof TABS[number]['id'];

/** Tabs that use the shared feature-flags save/reset/banner UI */
const FLAG_TABS: ReadonlySet<TabId> = new Set(['voice-conversion', 'voice-enrollment', 'developer']);

/** Wrapper for flag-bearing tabs: shows loading spinner, error, or the tab content */
function FlagTabContent({ loading, error, children }: { loading: boolean; error: string | null; children: React.ReactNode }) {
  if (loading) {
    return <LoadingState message="Loading feature flags..." />;
  }
  if (error) {
    return <ErrorState message={error} />;
  }
  return <>{children}</>;
}

export function FeatureSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabId) || 'music';

  // Feature flags state (shared across all flag-bearing tabs)
  const { get, put, loading: flagsLoading, error: flagsError } = useApi();
  const [flags, setFlags] = useState<Record<string, FlagMetadata[]>>({});
  const [changes, setChanges] = useState<Record<string, number | string | boolean>>({});
  const [saving, setSaving] = useState(false);
  const { saveSuccess, showSaveToast } = useSaveToast();
  const [saveErrors, setSaveErrors] = useState<{ flagId: string; error: string }[]>([]);

  const hasChanges = Object.keys(changes).length > 0;
  const isFlagTab = FLAG_TABS.has(activeTab);

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

  const handleFlagSave = async () => {
    setSaving(true);
    setSaveErrors([]);
    try {
      const result = await put<UpdateResult>('/feature-flags', changes);
      if (result.success) {
        showSaveToast();
        setChanges({});
        await fetchFlags();
      } else if (result.errors) {
        setSaveErrors(result.errors);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred';
      setSaveErrors([{ flagId: 'general', error: message }]);
    } finally {
      setSaving(false);
    }
  };

  const handleFlagReset = () => {
    setChanges({});
    setSaveErrors([]);
  };

  const updateFlag = (flagId: string, value: number | string | boolean) => {
    setChanges(prev => {
      const allFlags = Object.values(flags).flat();
      const flag = allFlags.find(f => f.id === flagId);
      if (flag && flag.value === value) {
        const rest = { ...prev };
        delete rest[flagId];
        return rest;
      }
      return { ...prev, [flagId]: value };
    });
  };

  const resetToDefault = (flag: FlagMetadata) => {
    updateFlag(flag.id, flag.defaultValue);
  };

  const getCurrentValue = (flag: FlagMetadata): number | string | boolean => {
    if (flag.id in changes) return changes[flag.id];
    return flag.value;
  };

  const isModified = (flagId: string): boolean => flagId in changes;

  const setTab = (tab: TabId) => {
    setSearchParams({ tab });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center">
            <Settings className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Feature Settings</h1>
            <p className="text-sm text-slate-400">Configure providers, models, and feature flags</p>
          </div>
        </div>

        {/* Flag tab actions (save/reset) — only show on flag-bearing tabs */}
        {isFlagTab && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleFlagReset}
              disabled={!hasChanges || saving}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-4 h-4" />
              Discard
            </button>
            <button
              onClick={() => fetchFlags().catch(console.error)}
              disabled={flagsLoading}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${flagsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleFlagSave}
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
        )}
      </div>

      {/* Flag tab banners */}
      {isFlagTab && saveSuccess && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <span className="text-sm text-emerald-300">Feature flags saved. Changes take effect on next render.</span>
        </div>
      )}
      {isFlagTab && saveErrors.length > 0 && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
          <p className="text-sm font-medium text-rose-300 mb-2">Some flags failed to save:</p>
          <ul className="text-sm text-rose-400 space-y-1">
            {saveErrors.map(({ flagId, error }) => (
              <li key={flagId}>{flagId}: {error}</li>
            ))}
          </ul>
        </div>
      )}
      {isFlagTab && hasChanges && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-sm text-amber-300">You have unsaved changes. Click &quot;Save Changes&quot; to apply.</span>
        </div>
      )}

      {/* Tab Bar */}
      <div className="border-b border-slate-700/50">
        <nav className="flex gap-6" aria-label="Settings tabs">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === id
                  ? 'text-rose-400 border-rose-500'
                  : 'text-slate-400 hover:text-slate-200 border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content — all stay mounted, inactive hidden via CSS */}
      <div className={activeTab === 'music' ? '' : 'hidden'}>
        <MusicProviderTab />
      </div>
      <div className={activeTab === 'stt' ? '' : 'hidden'}>
        <STTConfigTab />
      </div>
      <div className={activeTab === 'voice-conversion' ? '' : 'hidden'}>
        <FlagTabContent loading={flagsLoading && Object.keys(flags).length === 0} error={flagsError}>
          <VoiceConversionTab
            flags={flags['voice_conversion'] || []}
            changes={changes}
            updateFlag={updateFlag}
            resetToDefault={resetToDefault}
            getCurrentValue={getCurrentValue}
            isModified={isModified}
          />
        </FlagTabContent>
      </div>
      <div className={activeTab === 'voice-enrollment' ? '' : 'hidden'}>
        <FlagTabContent loading={flagsLoading && Object.keys(flags).length === 0} error={flagsError}>
          <VoiceEnrollmentTab
            flags={flags['voice_enrollment'] || []}
            changes={changes}
            updateFlag={updateFlag}
            resetToDefault={resetToDefault}
            getCurrentValue={getCurrentValue}
            isModified={isModified}
          />
        </FlagTabContent>
      </div>
      <div className={activeTab === 'developer' ? '' : 'hidden'}>
        <FlagTabContent loading={flagsLoading && Object.keys(flags).length === 0} error={flagsError}>
          <DeveloperTab
            flags={flags['developer'] || []}
            changes={changes}
            updateFlag={updateFlag}
            resetToDefault={resetToDefault}
            getCurrentValue={getCurrentValue}
            isModified={isModified}
          />
        </FlagTabContent>
      </div>
      <div className={activeTab === 'gift-bundles' ? '' : 'hidden'}>
        <GiftBundlesTab />
      </div>
    </div>
  );
}
