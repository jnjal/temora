/**
 * Formats seconds into HH:MM:SS or MM:SS
 */
export function formatHHMMSS(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  const hh = hours.toString().padStart(2, '0');
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');

  return hours > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatTime(seconds: number): string {
  return formatHHMMSS(seconds);
}

/**
 * Formats duration into human-readable compact hours and minutes (e.g. "2h 15m")
 */
export function formatHoursAndMinutes(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (hours === 0 && minutes === 0) {
    return '0m';
  }

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.join(' ');
}

/**
 * Formats an ISO string to a localized short English date
 */
export function formatDateEn(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    };
    return new Intl.DateTimeFormat('en-US', options).format(date);
  } catch {
    return isoString;
  }
}
