/** Human-readable labels and colors for track/version statuses */

export const trackStatusLabels: Record<string, string> = {
  draft: 'Draft',
  queued: 'Queued',
  preview_ready: 'Preview Ready',
  full_ready: 'Full Ready',
  completed: 'Completed',
  failed: 'Failed',
  deleted: 'Deleted',
};

export const trackStatusColors: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-slate-700', text: 'text-slate-400' },
  queued: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  preview_ready: { bg: 'bg-sky-500/10', text: 'text-sky-400' },
  full_ready: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  completed: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  failed: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
  deleted: { bg: 'bg-slate-700/50', text: 'text-slate-500' },
};

export function getTrackStatusLabel(status: string): string {
  return trackStatusLabels[status] || status;
}

export function getTrackStatusStyle(status: string): { bg: string; text: string } {
  return trackStatusColors[status] || { bg: 'bg-slate-700', text: 'text-slate-400' };
}
