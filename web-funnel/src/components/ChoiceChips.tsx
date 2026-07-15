import { useEffect, useRef } from "react";

interface ChoiceChipsProps {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  labelledByParent?: boolean;
}

export function ChoiceChips({
  label,
  options,
  value,
  onChange,
  className,
  labelledByParent = false,
}: ChoiceChipsProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!className?.includes("choice-rail")) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    selectedRef.current?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [className, value]);

  return (
    <div
      className={className ? `chips ${className}` : "chips"}
      role={labelledByParent ? undefined : "group"}
      aria-label={labelledByParent ? undefined : label}
    >
      {options.map((option) => (
        <button
          className="chip"
          type="button"
          aria-pressed={value === option}
          ref={value === option ? selectedRef : undefined}
          onClick={() => onChange(option)}
          key={option}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
