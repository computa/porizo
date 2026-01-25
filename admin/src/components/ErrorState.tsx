import { AlertCircle } from 'lucide-react';

interface ErrorStateProps {
  message: string;
}

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex items-center gap-3 text-rose-400 bg-rose-500/10 px-4 py-3 rounded-lg">
        <AlertCircle className="w-5 h-5" aria-hidden="true" />
        {message}
      </div>
    </div>
  );
}
