interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Loading...' }: LoadingStateProps) {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex items-center gap-3 text-slate-400">
        <span
          className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin"
          role="status"
          aria-label="Loading"
        />
        {message}
      </div>
    </div>
  );
}
