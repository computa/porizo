import { Info } from 'lucide-react';
import { FlagRenderer } from '../../../components/settings/FlagRenderer';
import type { FlagMetadata } from '../../../components/settings/FlagRenderer';

interface VoiceConversionTabProps {
  flags: FlagMetadata[];
  changes: Record<string, number | string | boolean>;
  updateFlag: (flagId: string, value: number | string | boolean) => void;
  resetToDefault: (flag: FlagMetadata) => void;
  getCurrentValue: (flag: FlagMetadata) => number | string | boolean;
  isModified: (flagId: string) => boolean;
}

export function VoiceConversionTab({ flags, updateFlag, resetToDefault, getCurrentValue, isModified }: VoiceConversionTabProps) {
  return (
    <div className="space-y-6">
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
        <h2 className="text-lg font-semibold text-white mb-6">Parameters</h2>
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

      {/* Parameter Guide */}
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
    </div>
  );
}
