interface ProgressBarProps {
  percentage: number;
  color?: string;
  height?: 'sm' | 'md';
  ariaLabel?: string;
}

const heightClasses = {
  sm: 'h-2',
  md: 'h-3',
};

export function ProgressBar({
  percentage,
  color = 'bg-sky-500',
  height = 'sm',
  ariaLabel,
}: ProgressBarProps): React.ReactElement {
  const clampedPercentage = Math.min(100, Math.max(0, percentage));

  return (
    <div
      className={`${heightClasses[height]} bg-slate-800 rounded-full overflow-hidden`}
      role="progressbar"
      aria-valuenow={Math.round(clampedPercentage)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div
        className={`h-full ${color} transition-all duration-500`}
        style={{ width: `${clampedPercentage}%` }}
      />
    </div>
  );
}
