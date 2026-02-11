import { FlagRenderer } from '../../../components/settings/FlagRenderer';
import type { FlagMetadata } from '../../../components/settings/FlagRenderer';

interface VoiceEnrollmentTabProps {
  flags: FlagMetadata[];
  changes: Record<string, number | string | boolean>;
  updateFlag: (flagId: string, value: number | string | boolean) => void;
  resetToDefault: (flag: FlagMetadata) => void;
  getCurrentValue: (flag: FlagMetadata) => number | string | boolean;
  isModified: (flagId: string) => boolean;
}

export function VoiceEnrollmentTab({ flags, updateFlag, resetToDefault, getCurrentValue, isModified }: VoiceEnrollmentTabProps) {
  if (flags.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-slate-400">No voice enrollment flags configured.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-2">Enrollment Settings</h2>
        <p className="text-sm text-slate-400 mb-6">
          Configure voice enrollment quality checks and iOS recording settings.
        </p>
        <div className="space-y-8">
          {flags.map(flag => (
            <FlagRenderer
              key={flag.id}
              flag={flag}
              currentValue={getCurrentValue(flag)}
              isModified={isModified(flag.id)}
              onUpdate={updateFlag}
              onReset={resetToDefault}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
