interface ChoiceChipsProps {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}

export function ChoiceChips({ label, options, value, onChange }: ChoiceChipsProps) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          className="chip"
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          key={option}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
