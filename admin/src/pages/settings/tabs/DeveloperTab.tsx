import { Info } from 'lucide-react';
import { FlagRenderer } from '../../../components/settings/FlagRenderer';
import type { FlagMetadata } from '../../../components/settings/FlagRenderer';

interface DeveloperTabProps {
  flags: FlagMetadata[];
  changes: Record<string, number | string | boolean>;
  updateFlag: (flagId: string, value: number | string | boolean) => void;
  resetToDefault: (flag: FlagMetadata) => void;
  getCurrentValue: (flag: FlagMetadata) => number | string | boolean;
  isModified: (flagId: string) => boolean;
}

export function DeveloperTab({ flags, updateFlag, resetToDefault, getCurrentValue, isModified }: DeveloperTabProps) {
  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
        <Info className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-200">
          <p className="font-medium mb-1">Developer Settings</p>
          <p className="text-amber-300/80">
            These flags control developer-only features. Design screens are only visible on TestFlight and debug
            builds — they are never shown to App Store users regardless of this toggle.
          </p>
        </div>
      </div>

      {/* Developer Flags */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-6">Developer Features</h2>
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
