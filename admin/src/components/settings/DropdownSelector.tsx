interface DropdownOption {
  id: string;
  name: string;
  detail?: string;
}

interface DropdownSelectorProps {
  label: string;
  description: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  badge?: React.ReactNode;
}

export function DropdownSelector({ label, description, value, options, onChange, badge }: DropdownSelectorProps) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-white">{label}</span>
        {badge}
      </div>
      <p className="text-xs text-slate-400 mb-3">{description}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full max-w-md bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.name}{opt.detail ? ` (${opt.detail})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
