export type AppState = 'idle' | 'create' | 'countdown' | 'active' | 'summary';

export interface ActiveTimer {
  title: string;
  targetSeconds: number;
  elapsedSeconds: number;
  isPaused: boolean;
  startTimeIso: string;
  lastResumeTimestamp?: number;
}

export interface CompletedSession {
  id: string;
  title: string;
  elapsedSeconds: number;
  targetSeconds: number;
  timestampIso: string;
}

export interface DayProductivity {
  dateIso: string;
  dayTitle: string;
  totalElapsed: number;
  dayPctInt: number;
  sessions: CompletedSession[];
}
