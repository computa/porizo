export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m4 16-.8 4 4-.8L18.5 7.9l-3.2-3.2L4 16Z" />
      <path d="m13.8 6.2 3.2 3.2" />
    </svg>
  );
}

export function PlayIcon({ paused = false }: { paused?: boolean }) {
  return paused ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="m8 5 11 7-11 7V5Z" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}
