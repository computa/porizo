/**
 * Shared date formatting utilities for the admin dashboard.
 */

/**
 * Format a date string as relative time (e.g., "5m ago", "2h ago", "3d ago")
 */
export function getTimeSince(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatShortDate(dateStr);
}

/**
 * Format date as short format (e.g., "Jan 15")
 */
export function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format date with time (e.g., "Jan 15, 2:30 PM")
 */
export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format date with time including seconds (e.g., "Jan 15, 02:30:45 PM")
 */
export function formatDateTimeSec(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Format date with year (e.g., "Jan 15, 2024")
 */
export function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Calculate conversion rate as a formatted percentage string
 */
export function formatConversionRate(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.0';
  return ((numerator / denominator) * 100).toFixed(1);
}

/**
 * Format currency value
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '$0.00';
  return `$${value.toFixed(2)}`;
}

export function formatMoney(value: number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined) return '—';
  const normalizedCurrency = currency || 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency,
    }).format(value);
  } catch {
    return `${normalizedCurrency} ${value.toFixed(2)}`;
  }
}
