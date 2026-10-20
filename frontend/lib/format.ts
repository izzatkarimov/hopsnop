const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const shortDateWithYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const fullDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Short feed-style timestamp: "now", "45s", "12m", "3h", "2d", "Sep 21". */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));

  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return (sameYear ? shortDate : shortDateWithYear).format(date);
}

/** Full date and time, e.g. for a tooltip. */
export function formatFullDate(iso: string): string {
  return fullDate.format(new Date(iso));
}

/** Compact counts: 940, 1.2K, 482.3K. */
export function formatCount(count: number): string {
  return compactNumber.format(count);
}
