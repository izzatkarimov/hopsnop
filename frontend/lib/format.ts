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

const timeOfDay = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "now", "45s", "12m", "3h", "2d", "Sep 21". */
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

export function formatFullDate(iso: string): string {
  return fullDate.format(new Date(iso));
}

/** 940, 1.2K, 482.3K. */
export function formatCount(count: number): string {
  return compactNumber.format(count);
}

/** "9:41 AM · Nov 16, 2026", in this device's time zone. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return `${timeOfDay.format(date)} · ${shortDateWithYear.format(date)}`;
}

/** The first word of the display name, or the username when it has none. */
export function firstName(user: { displayName: string; username: string }): string {
  return user.displayName.trim().split(/\s+/)[0] || user.username;
}

/** By this device's clock: morning from 5, afternoon from 12, evening from 18. */
export function greeting(name: string, date: Date): string {
  const hour = date.getHours();
  const part = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";
  return `Good ${part}, ${name}`;
}
