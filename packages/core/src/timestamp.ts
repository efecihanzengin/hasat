/**
 * Time components parsed from fractional or integer seconds.
 */
export type TimeComponents = {
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
};

/**
 * Decomposes a duration in seconds into hours, minutes, seconds, and milliseconds.
 * Clamps negative or non-finite inputs to 0.
 * Rounds to nearest millisecond to avoid IEEE-754 floating point imprecision.
 */
export function decomposeSeconds(seconds: number): TimeComponents {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };
  }

  const totalMs = Math.round(seconds * 1000);
  const milliseconds = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return {
    hours,
    minutes,
    seconds: secs,
    milliseconds,
  };
}

/**
 * Formats seconds into SRT timestamp: HH:MM:SS,mmm
 * Hours are 2+ digits, minutes and seconds are 2 digits, milliseconds are 3 digits.
 */
export function formatSrtTimestamp(seconds: number): string {
  const {
    hours,
    minutes,
    seconds: secs,
    milliseconds,
  } = decomposeSeconds(seconds);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  const mmm = String(milliseconds).padStart(3, "0");
  return `${hh}:${mm}:${ss},${mmm}`;
}

/**
 * Formats seconds into VTT timestamp: HH:MM:SS.mmm
 * Same timing as SRT but with dot separator for milliseconds.
 */
export function formatVttTimestamp(seconds: number): string {
  const {
    hours,
    minutes,
    seconds: secs,
    milliseconds,
  } = decomposeSeconds(seconds);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  const mmm = String(milliseconds).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * Formats seconds into human-readable clock time mm:ss (or hh:mm:ss if >= 1 hour).
 */
export function formatClockTime(seconds: number): string {
  const { hours, minutes, seconds: secs } = decomposeSeconds(seconds);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");

  if (hours > 0) {
    const hh = String(hours).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  return `${mm}:${ss}`;
}

/**
 * Formats seconds into TXT timestamp prefix: [mm:ss] (or [hh:mm:ss] if >= 1 hour).
 */
export function formatTxtTimestamp(seconds: number): string {
  return `[${formatClockTime(seconds)}]`;
}
