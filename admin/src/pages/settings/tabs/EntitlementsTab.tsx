import { FlagRenderer } from '../../../components/settings/FlagRenderer';
import type { FlagMetadata } from '../../../components/settings/FlagRenderer';

interface EntitlementsTabProps {
  flags: FlagMetadata[];
  updateFlag: (flagId: string, value: number | string | boolean) => void;
  resetToDefault: (flag: FlagMetadata) => void;
  getCurrentValue: (flag: FlagMetadata) => number | string | boolean;
  isModified: (flagId: string) => boolean;
}

export function EntitlementsTab({ flags, updateFlag, resetToDefault, getCurrentValue, isModified }: EntitlementsTabProps) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-6">Signup Grants</h2>
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
