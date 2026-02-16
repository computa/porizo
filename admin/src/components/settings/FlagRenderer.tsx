interface FlagOption {
  value: string;
  label: string;
}

export interface FlagMetadata {
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
  options?: FlagOption[];
}

interface FlagRendererProps {
  flag: FlagMetadata;
  currentValue: number | string | boolean;
  isModified: boolean;
  onUpdate: (flagId: string, value: number | string | boolean) => void;
  onReset: (flag: FlagMetadata) => void;
  accentColor?: string;
}

export function FlagRenderer({ flag, currentValue, isModified, onUpdate, onReset, accentColor = 'violet' }: FlagRendererProps) {
  const accentClasses = {
    violet: { accent: 'accent-violet-500', ring: 'focus:ring-violet-500/50', text: 'text-violet-400', bg: 'bg-violet-500', badge: 'bg-violet-500/20 text-violet-400' },
    rose: { accent: 'accent-rose-500', ring: 'focus:ring-rose-500/50', text: 'text-rose-400', bg: 'bg-rose-500', badge: 'bg-rose-500/20 text-rose-400' },
  }[accentColor] || { accent: 'accent-violet-500', ring: 'focus:ring-violet-500/50', text: 'text-violet-400', bg: 'bg-violet-500', badge: 'bg-violet-500/20 text-violet-400' };

  const renderInput = () => {
    if (flag.type === 'boolean') {
      const checked = currentValue as boolean;
      return (
        <button
          onClick={() => onUpdate(flag.id, !checked)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            checked ? accentClasses.bg : 'bg-slate-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              checked ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      );
    }

    if (flag.type === 'number' && flag.id === 'seedvc_cfg_rate') {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={flag.min ?? 0}
              max={flag.max ?? 1}
              step={flag.step ?? 0.05}
              value={currentValue as number}
              onChange={(e) => onUpdate(flag.id, parseFloat(e.target.value))}
              className={`flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer ${accentClasses.accent}`}
            />
            <span className={`w-16 text-right font-mono text-sm ${accentClasses.text}`}>
              {(currentValue as number).toFixed(2)}
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
      );
    }

    if (flag.type === 'number') {
      const isWeight = flag.max !== undefined && flag.max <= 1;
      if (isWeight) {
        return (
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={flag.min ?? 0}
              max={flag.max ?? 1}
              step={flag.step ?? 0.1}
              value={currentValue as number}
              onChange={(e) => onUpdate(flag.id, parseFloat(e.target.value))}
              className={`flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer ${accentClasses.accent} max-w-xs`}
            />
            <span className={`w-12 text-right font-mono text-sm ${accentClasses.text}`}>
              {(currentValue as number).toFixed(1)}
            </span>
            <span className="text-xs text-slate-500">
              (default: {flag.defaultValue})
            </span>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-4">
          <input
            type="number"
            min={flag.min}
            max={flag.max}
            step={flag.step ?? 1}
            value={currentValue as number}
            onChange={(e) => onUpdate(flag.id, parseInt(e.target.value) || flag.defaultValue as number)}
            className={`w-32 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:ring-2 ${accentClasses.ring}`}
          />
          <span className="text-xs text-slate-500">
            Range: {flag.min} - {flag.max} (default: {flag.defaultValue})
          </span>
        </div>
      );
    }

    if (flag.options && flag.options.length > 0) {
      return (
        <select
          value={String(currentValue)}
          onChange={(e) => onUpdate(flag.id, e.target.value)}
          className={`w-full max-w-md border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${accentClasses.ring}`}
          style={{ 
            colorScheme: 'dark',
            backgroundColor: '#1e293b',
            color: '#e2e8f0',
          }}
        >
          {flag.options.map((option) => (
            <option 
              key={option.value} 
              value={option.value}
              style={{ backgroundColor: '#1e293b', color: '#e2e8f0' }}
            >
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        type="text"
        value={String(currentValue)}
        onChange={(e) => onUpdate(flag.id, e.target.value)}
        className={`w-full max-w-md bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 ${accentClasses.ring}`}
      />
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">{flag.label}</span>
            {isModified && (
              <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded font-medium">
                MODIFIED
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{flag.description}</p>
        </div>
        <button
          onClick={() => onReset(flag)}
          disabled={currentValue === flag.defaultValue}
          className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
          title={`Reset to default (${flag.defaultValue})`}
        >
          Reset
        </button>
      </div>
      {renderInput()}
    </div>
  );
}
