import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Play, Pause, Square, Check, Music, X, Headphones, History, Trash2, RotateCcw, RotateCw, Settings } from 'lucide-react';
import { formatHHMMSS, formatHoursAndMinutes, formatDateEn } from './utils/formatters';
import { playCountdownTick, playNotificationSound } from './utils/audio';
import { AppState, ActiveTimer, CompletedSession, DayProductivity } from './types';
import confetti from 'canvas-confetti';

const STORAGE_KEYS = {
  ACTIVE: 'temora_active_timer_v1',
  HISTORY: 'temora_weekly_history_v1',
  YT_ID: 'temora_yt_id_v1',
  VIDEO_HISTORY: 'temora_video_history_v1',
  SETTINGS: 'temora_settings_v1',
  RECENT_ACTIVITIES: 'temora_recent_activities_v1',
  // Backwards compatibility keys
  LEGACY_ACTIVE: 'black_timer_active_v1',
  LEGACY_HISTORY: 'black_timer_weekly_history_v2',
  LEGACY_YT: 'black_timer_yt_id',
};

const MAX_VIDEO_HISTORY = 3;
const MAX_RECENT_ACTIVITIES = 6;

const DEFAULT_SETTINGS = {
  notificationsEnabled: false,
  countdownSoundEnabled: true,
  completionSoundEnabled: true,
  completionSound: 'chime',
  confettiEnabled: true,
  musicVolume: 80,
} as const;

interface AppSettings {
  notificationsEnabled: boolean;
  countdownSoundEnabled: boolean;
  completionSoundEnabled: boolean;
  completionSound: 'chime' | 'bell' | 'digital';
  confettiEnabled: boolean;
  musicVolume: number;
}

interface RecentActivity {
  title: string;
  hours: number;
  minutes: number;
}

interface VideoHistoryEntry {
  id: string;
  title: string;
}

// Local calendar-date key (YYYY-MM-DD) so day bucketing is timezone-safe
function formatLocalDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Formats seconds as M:SS / MM:SS (minutes and seconds)
function formatMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Robust YouTube Video ID extractor (supports watch, live, shorts, youtu.be, embed, raw ID)
function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/|shorts\/))([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(regExp);
  return match ? match[1] : null;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-black border border-zinc-800 transition-colors hover:border-zinc-700"
    >
      <span className="text-[11px] font-medium text-zinc-300">{label}</span>
      <span className={`inline-block w-9 h-5 rounded-full transition-colors ${checked ? 'bg-white' : 'bg-zinc-700'}`}>
        <span
          className={`block w-3.5 h-3.5 rounded-full mt-[3px] ml-[3px] transition-all ${
            checked ? 'bg-black translate-x-[18px]' : 'bg-zinc-400'
          }`}
        />
      </span>
    </button>
  );
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle');

  // New timer creation state
  const [titleInput, setTitleInput] = useState('');
  const [hoursInput, setHoursInput] = useState<number>(2);
  const [minutesInput, setMinutesInput] = useState<number>(0);

  // Countdown state (3, 2, 1)
  const [countdownValue, setCountdownValue] = useState<number>(3);

  // Active Timer state (accurate timestamp-based tracking to avoid background tab throttling)
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(() => {
    try {
      const saved =
        localStorage.getItem(STORAGE_KEYS.ACTIVE) ||
        localStorage.getItem(STORAGE_KEYS.LEGACY_ACTIVE);
      if (!saved) return null;

      const parsed: ActiveTimer = JSON.parse(saved);
      // Re-synchronize elapsed seconds if timer was running when page unloaded
      if (!parsed.isPaused && parsed.lastResumeTimestamp) {
        const deltaSeconds = Math.max(0, Math.floor((Date.now() - parsed.lastResumeTimestamp) / 1000));
        return {
          ...parsed,
          elapsedSeconds: parsed.elapsedSeconds + deltaSeconds,
          lastResumeTimestamp: Date.now(),
        };
      }
      return parsed;
    } catch {
      return null;
    }
  });

  // Weekly Completed Sessions History (auto-prunes older than 7 days)
  const [completedSessions, setCompletedSessions] = useState<CompletedSession[]>(() => {
    try {
      const saved =
        localStorage.getItem(STORAGE_KEYS.HISTORY) ||
        localStorage.getItem(STORAGE_KEYS.LEGACY_HISTORY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
        return Array.isArray(parsed)
          ? parsed.filter((s) => {
              const t = new Date(s.timestampIso).getTime();
              return !isNaN(t) && t >= sevenDaysAgo;
            })
          : [];
      }
      return [];
    } catch {
      return [];
    }
  });

  // Background Audio / YouTube State
  const [isMusicModalOpen, setIsMusicModalOpen] = useState(false);
  const [youtubeInput, setYoutubeInput] = useState('');
  const [videoHistory, setVideoHistory] = useState<VideoHistoryEntry[]>(() => {
    try {
      const savedHist = localStorage.getItem(STORAGE_KEYS.VIDEO_HISTORY);
      if (savedHist) {
        const parsed = JSON.parse(savedHist);
        if (Array.isArray(parsed)) {
          const seen = new Set<string>();
          const entries: VideoHistoryEntry[] = parsed
            .map((x): VideoHistoryEntry | null => {
              if (x && typeof x === 'object' && typeof (x as any).id === 'string') {
                return { id: x.id, title: typeof x.title === 'string' ? x.title : '' };
              }
              if (typeof x === 'string' && x.length > 0) return { id: x, title: '' };
              return null;
            })
            .filter((e): e is VideoHistoryEntry => e !== null)
            .filter((e) => e.id.length > 0 && !seen.has(e.id) && (seen.add(e.id), true));
          if (entries.length > 0) return entries.slice(0, MAX_VIDEO_HISTORY);
        }
      }
    } catch {
      // fall through to legacy migration
    }
    try {
      const legacy =
        localStorage.getItem(STORAGE_KEYS.YT_ID) ||
        localStorage.getItem(STORAGE_KEYS.LEGACY_YT);
      return legacy ? [{ id: legacy, title: '' }] : [];
    } catch {
      return [];
    }
  });
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [ytApiReady, setYtApiReady] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [playerPos, setPlayerPos] = useState(0);
  const [playerDur, setPlayerDur] = useState(0);
  const playerRef = useRef<any>(null);
  const loadedVideoRef = useRef<string | null>(null);
  const currentVideoId = videoHistory[currentIndex]?.id ?? null;

  // Weekly History Modal State
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // Recent activities memory (name + duration for quick start)
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.RECENT_ACTIVITIES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((a) => a && typeof a === 'object' && typeof a.title === 'string' && a.title)
            .slice(0, MAX_RECENT_ACTIVITIES);
        }
      }
    } catch {
      // ignore
    }
    return [];
  });

  // App settings
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_SETTINGS };
  });

  // Settings Modal State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Refs for tracking active session timestamps cleanly
  const lastTickRef = useRef<number>(Date.now());
  const countdownRef = useRef<number>(3);
  const settingsRef = useRef(settings);
  const targetNotifySentRef = useRef<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Persist app settings
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }, [settings]);

  // Persist recent activities
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.RECENT_ACTIVITIES, JSON.stringify(recentActivities));
  }, [recentActivities]);

  // Request notification permission when the user enables notifications
  useEffect(() => {
    if (settings.notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [settings.notificationsEnabled]);

  // Notify once when the count-up reaches the target duration
  useEffect(() => {
    if (!activeTimer) return;
    if (targetNotifySentRef.current === activeTimer.startTimeIso) return;
    if (activeTimer.elapsedSeconds < activeTimer.targetSeconds) return;

    targetNotifySentRef.current = activeTimer.startTimeIso;
    if (
      settings.notificationsEnabled &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification('TEMORA — Time is up', {
          body: `${activeTimer.title} — ${formatHHMMSS(activeTimer.elapsedSeconds)}`,
        });
      } catch {
        // ignore notification errors
      }
    }
  }, [
    activeTimer?.startTimeIso,
    activeTimer?.targetSeconds,
    activeTimer?.elapsedSeconds,
    activeTimer?.title,
    settings.notificationsEnabled,
  ]);

  // Apply music volume to the hidden player
  useEffect(() => {
    const p = playerRef.current;
    if (!isPlayerReady || !p || typeof p.setVolume !== 'function') return;
    p.setVolume(Math.max(0, Math.min(100, Math.round(settings.musicVolume))));
  }, [isPlayerReady, settings.musicVolume]);

  // Persist video history (recent 5) + current id for backwards compatibility
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.VIDEO_HISTORY, JSON.stringify(videoHistory));
    if (currentVideoId) {
      localStorage.setItem(STORAGE_KEYS.YT_ID, currentVideoId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.YT_ID);
    }
  }, [videoHistory, currentIndex, currentVideoId]);

  // Load the YouTube IFrame API script once
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    if ((w as any).YT?.Player) {
      setYtApiReady(true);
      return;
    }
    if (typeof (w as any).onYouTubeIframeAPIReady === 'function') return;
    (w as any).onYouTubeIframeAPIReady = () => setYtApiReady(true);
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }, []);

  // Create the hidden player once the API is ready
  useEffect(() => {
    if (!ytApiReady || playerRef.current) return;
    const startId = currentVideoId ?? '';
    const created = new (window as any).YT.Player('temora-youtube-player', {
      videoId: startId || undefined,
      width: '1',
      height: '1',
      playerVars: {
        autoplay: 0,
        controls: 0,
        loop: 1,
        playlist: startId || undefined,
        playsinline: 1,
      },
      events: {
        onReady: () => {
          setIsPlayerReady(true);
          window.setTimeout(syncTitle, 1000);
        },
        onStateChange: () => syncTitle(),
      },
    });
    playerRef.current = created;
  }, [ytApiReady]);

  // Sync video + play/pause state to the hidden player
  useEffect(() => {
    const p = playerRef.current;
    if (!isPlayerReady || !p || !currentVideoId) return;
    if (loadedVideoRef.current !== currentVideoId) {
      loadedVideoRef.current = currentVideoId;
      p.loadVideoById(currentVideoId);
      window.setTimeout(syncTitle, 1500);
    }
    syncTitle();
    if (isMusicPlaying) p.playVideo();
    else p.pauseVideo();
  }, [currentVideoId, isMusicPlaying, isPlayerReady]);

  // Reset position/duration when switching videos
  useEffect(() => {
    setPlayerPos(0);
    setPlayerDur(0);
  }, [currentVideoId]);

  // Poll current position + duration while a video is loaded
  useEffect(() => {
    if (!isPlayerReady || !currentVideoId) return;
    const tick = () => {
      const p = playerRef.current;
      if (!p) return;
      const t = typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : 0;
      const d = typeof p.getDuration === 'function' ? p.getDuration() : 0;
      setPlayerPos(Number.isFinite(t) ? Math.round(t) : 0);
      if (Number.isFinite(d) && d > 0) setPlayerDur(Math.max(0, Math.round(d)));
    };
    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [isPlayerReady, currentVideoId]);

  // Sync video + play/pause state to the hidden player
  useEffect(() => {
    const p = playerRef.current;
    if (!isPlayerReady || !p || !currentVideoId) return;
    if (loadedVideoRef.current !== currentVideoId) {
      loadedVideoRef.current = currentVideoId;
      p.loadVideoById(currentVideoId);
    }
    if (isMusicPlaying) p.playVideo();
    else p.pauseVideo();
  }, [currentVideoId, isMusicPlaying, isPlayerReady]);

  // Persist Active Timer
  useEffect(() => {
    if (activeTimer) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE, JSON.stringify(activeTimer));
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE);
      localStorage.removeItem(STORAGE_KEYS.LEGACY_ACTIVE);
    }
  }, [activeTimer]);

  // Persist Weekly History (7-day retention)
  useEffect(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const pruned = completedSessions.filter((s) => {
      const t = new Date(s.timestampIso).getTime();
      return !isNaN(t) && t >= sevenDaysAgo;
    });

    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(pruned));
  }, [completedSessions]);

  // Resume active timer on mount if present
  useEffect(() => {
    if (activeTimer && appState === 'idle') {
      setAppState('active');
    }
  }, []);

  // Update document title dynamically with focus time
  useEffect(() => {
    if (appState === 'active' && activeTimer) {
      const timeStr = formatHHMMSS(activeTimer.elapsedSeconds);
      document.title = activeTimer.isPaused
        ? `(Paused) ${timeStr} • ${activeTimer.title} - TEMORA`
        : `${timeStr} • ${activeTimer.title} - TEMORA`;
    } else if (appState === 'countdown') {
      document.title = `${countdownValue}... - TEMORA`;
    } else {
      document.title = 'TEMORA';
    }
  }, [appState, activeTimer?.elapsedSeconds, activeTimer?.isPaused, activeTimer?.title, countdownValue]);

  // 1. Countdown Handler (3-2-1)
  useEffect(() => {
    if (appState !== 'countdown') return;

    countdownRef.current = 3;
    setCountdownValue(3);
    if (settingsRef.current.countdownSoundEnabled) playCountdownTick(false);

    const timer = setInterval(() => {
      countdownRef.current -= 1;
      setCountdownValue(countdownRef.current);
      if (countdownRef.current > 0) {
        if (settingsRef.current.countdownSoundEnabled) playCountdownTick(false);
      } else {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [appState]);

  useEffect(() => {
    if (appState === 'countdown' && countdownValue === 0 && countdownRef.current === 0) {
      if (settingsRef.current.countdownSoundEnabled) playCountdownTick(true);
      setAppState('active');
    }
  }, [appState, countdownValue]);

  // 2. High-precision Timer with Tab Drift Correction
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    if (appState === 'active' && activeTimer && !activeTimer.isPaused) {
      lastTickRef.current = Date.now();

      interval = setInterval(() => {
        const now = Date.now();
        const deltaSec = Math.max(1, Math.round((now - lastTickRef.current) / 1000));
        lastTickRef.current = now;

        setActiveTimer((prev) => {
          if (!prev || prev.isPaused) return prev;
          return {
            ...prev,
            elapsedSeconds: prev.elapsedSeconds + deltaSec,
            lastResumeTimestamp: now,
          };
        });
      }, 1000);
    }

    // Sync accurately when user switches back to this tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && appState === 'active') {
        const now = Date.now();
        setActiveTimer((prev) => {
          if (!prev || prev.isPaused || !prev.lastResumeTimestamp) return prev;
          const driftSec = Math.floor((now - prev.lastResumeTimestamp) / 1000);
          lastTickRef.current = now;
          if (driftSec > 1) {
            return {
              ...prev,
              elapsedSeconds: prev.elapsedSeconds + driftSec,
              lastResumeTimestamp: now,
            };
          }
          return prev;
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [appState, activeTimer?.isPaused]);

  // Start Creation Flow
  const handleStartCreation = useCallback(() => {
    if (!titleInput.trim()) return;

    const totalTargetSecs = hoursInput * 3600 + minutesInput * 60;
    if (totalTargetSecs <= 0) return;

    const now = Date.now();
    const newTimer: ActiveTimer = {
      title: titleInput.trim(),
      targetSeconds: totalTargetSecs,
      elapsedSeconds: 0,
      isPaused: false,
      startTimeIso: new Date().toISOString(),
      lastResumeTimestamp: now,
    };

    setActiveTimer(newTimer);
    setAppState('countdown');
    targetNotifySentRef.current = null;

    // Remember this activity for quick start later
    setRecentActivities((prev) => {
      const next = [
        { title: newTimer.title, hours: hoursInput, minutes: minutesInput },
        ...prev.filter((a) => a.title.toLowerCase() !== newTimer.title.toLowerCase()),
      ].slice(0, MAX_RECENT_ACTIVITIES);
      return next;
    });
  }, [titleInput, hoursInput, minutesInput]);

  // Cancel / Abort timer without recording a session
  const handleCancelTimer = useCallback(() => {
    if (!window.confirm('Discard this focus session without saving?')) return;
    setActiveTimer(null);
    setAppState('idle');
  }, []);

  // Toggle Pause / Resume
  const handleTogglePause = useCallback(() => {
    setActiveTimer((prev) => {
      if (!prev) return null;
      const isNowPaused = !prev.isPaused;
      return {
        ...prev,
        isPaused: isNowPaused,
        lastResumeTimestamp: isNowPaused ? undefined : Date.now(),
      };
    });
  }, []);

  // Finish Timer
  const handleFinishTimer = useCallback(() => {
    if (!activeTimer) return;

    const s = settingsRef.current;
    if (s.completionSoundEnabled) {
      playNotificationSound(s.completionSound, 90);
    }
    if (s.confettiEnabled) {
      try {
        confetti({
          particleCount: 65,
          spread: 75,
          origin: { y: 0.6 },
          colors: ['#ffffff', '#a1a1aa', '#52525b'],
        });
      } catch {
        // Confetti fallback
      }
    }

    const finishedRecord: CompletedSession = {
      id: `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: activeTimer.title,
      elapsedSeconds: activeTimer.elapsedSeconds,
      targetSeconds: activeTimer.targetSeconds,
      timestampIso: new Date().toISOString(),
    };

    setCompletedSessions((prev) => [finishedRecord, ...prev]);
    setAppState('summary');
  }, [activeTimer]);

  // Global Keyboard Shortcuts (Space to pause, Esc to close modals)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter' && appState === 'create') {
          e.preventDefault();
          handleStartCreation();
        }
        if (e.key === 'Escape') {
          setIsMusicModalOpen(false);
          setIsHistoryModalOpen(false);
          setIsSettingsModalOpen(false);
        }
        return;
      }

      if (e.key === 'Escape') {
        if (isMusicModalOpen) setIsMusicModalOpen(false);
        else if (isHistoryModalOpen) setIsHistoryModalOpen(false);
        else if (isSettingsModalOpen) setIsSettingsModalOpen(false);
        else if (appState === 'create') setAppState('idle');
      } else if (e.code === 'Space' && appState === 'active') {
        e.preventDefault();
        handleTogglePause();
      } else if (e.key === 'Enter' && appState === 'create') {
        e.preventDefault();
        handleStartCreation();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appState, isMusicModalOpen, isHistoryModalOpen, isSettingsModalOpen, handleStartCreation, handleTogglePause]);

  // Pull the title of the currently loaded video from the player and persist it
  // (reads only refs + stable setters, so it is safe in player event handlers)
  const syncTitle = () => {
    const p = playerRef.current;
    if (!p || typeof p.getVideoData !== 'function') return;
    try {
      const data = p.getVideoData();
      const id = data?.video_id ? String(data.video_id) : '';
      const title = typeof data?.title === 'string' && data.title ? String(data.title) : '';
      if (id && title) {
        setVideoHistory((prev) => prev.map((e) => (e.id === id ? { ...e, title } : e)));
      }
    } catch {
      // ignore unavailable metadata
    }
  };

  // Load a video into the player and record it as the most recent
  const loadVideo = useCallback((videoId: string) => {
    setVideoHistory((prev) => {
      const next = [
        { id: videoId, title: '' },
        ...prev.filter((h) => h.id !== videoId),
      ].slice(0, MAX_VIDEO_HISTORY);
      return next;
    });
    setCurrentIndex(0);
  }, []);

  const selectHistoryVideo = useCallback((idx: number) => {
    setCurrentIndex(idx);
  }, []);

  const handleScrub = useCallback((value: number) => {
    const p = playerRef.current;
    setPlayerPos(value);
    if (p && isPlayerReady) p.seekTo(Math.max(0, value), true);
  }, [isPlayerReady]);

  const seekBy = useCallback((deltaSeconds: number) => {
    const p = playerRef.current;
    if (!p || !isPlayerReady) return;
    const current = typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : 0;
    p.seekTo(Math.max(0, current + deltaSeconds), true);
  }, [isPlayerReady]);

  // Handle setting new YouTube audio link
  const handleApplyYoutubeUrl = () => {
    const extracted = extractYouTubeId(youtubeInput);
    if (extracted) {
      loadVideo(extracted);
      setIsMusicPlaying(true);
      setYoutubeInput('');
    }
  };

  // Progress Bar Snapping (Every 5%)
  const snappedProgressPct = useMemo(() => {
    if (!activeTimer || activeTimer.targetSeconds === 0) return 0;
    const rawPct = (activeTimer.elapsedSeconds / activeTimer.targetSeconds) * 100;
    return Math.floor(rawPct / 5) * 5;
  }, [activeTimer?.elapsedSeconds, activeTimer?.targetSeconds]);

  const visualBarWidthPct = Math.min(100, snappedProgressPct);

  // Memoized 7-Day Productivity Calculation (runs only when completedSessions change)
  const { weeklyDaysData, totalWeeklySeconds } = useMemo(() => {
    const days: DayProductivity[] = [];
    const today = new Date();
    let totalSec = 0;

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStrKey = formatLocalDateKey(d);

      const daySessions = completedSessions.filter((s) => {
        try {
          const sessionDate = new Date(s.timestampIso);
          return formatLocalDateKey(sessionDate) === dateStrKey;
        } catch {
          return false;
        }
      });

      const dayTotal = daySessions.reduce((acc, curr) => acc + curr.elapsedSeconds, 0);
      totalSec += dayTotal;

      // 86,400 seconds in a 24-hour day
      const dayPctFloat = (dayTotal / 86400) * 100;
      const dayPctInt = Math.min(100, Math.round(dayPctFloat));

      let dayTitle = '';
      if (i === 0) dayTitle = 'Today';
      else if (i === 1) dayTitle = 'Yesterday';
      else dayTitle = formatDateEn(d.toISOString());

      days.push({
        dateIso: d.toISOString(),
        dayTitle,
        totalElapsed: dayTotal,
        dayPctInt,
        sessions: daySessions,
      });
    }

    return { weeklyDaysData: days, totalWeeklySeconds: totalSec };
  }, [completedSessions]);

  return (
    <div className="h-dvh w-screen bg-black text-white font-['Inter',sans-serif] overflow-x-hidden overflow-y-auto flex flex-col justify-between items-center p-4 sm:p-8 select-none relative touch-manipulation">
      
      {/* Background YouTube Audio Stream */}
      <div
        id="temora-youtube-player"
        className="w-1 h-1 absolute top-0 left-0 opacity-0 pointer-events-none -z-50"
        aria-hidden="true"
      />

      {/* Main Focus Stage */}
      <main className="w-full max-w-md flex flex-col items-center justify-center my-auto">
        <AnimatePresence mode="wait">
          
          {/* STATE 1: IDLE */}
          {appState === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.2 }}
              className="w-full flex flex-col items-center text-center space-y-8"
            >
              {/* Central Start Button */}
              <button
                id="add-timer-btn"
                onClick={() => {
                  setTitleInput('');
                  setHoursInput(2);
                  setMinutesInput(0);
                  setAppState('create');
                }}
                className="group relative w-32 h-32 rounded-full bg-zinc-950 border border-zinc-800 hover:border-white hover:bg-zinc-900 text-white flex items-center justify-center transition-all duration-300 active:scale-95 shadow-2xl"
                aria-label="Create New Timer"
              >
                <Plus className="w-14 h-14 stroke-[1.75] transition-transform duration-300 group-hover:scale-110" />
              </button>

              {/* Recent Sessions Preview */}
              {completedSessions.length > 0 && (
                <div className="w-full text-left space-y-2 pt-4 border-t border-zinc-950">
                  {completedSessions.slice(0, 2).map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-xs py-1 text-zinc-500 font-mono">
                      <span className="text-zinc-400 font-sans truncate max-w-[220px]">{s.title}</span>
                      <span>{formatHHMMSS(s.elapsedSeconds)}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* STATE 2: CREATE */}
          {appState === 'create' && (
            <motion.div
              key="create"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              className="w-full bg-zinc-950 border border-zinc-900 rounded-3xl p-6 sm:p-8 space-y-6"
            >
              <div className="space-y-4 text-left">
                <div>
                  <input
                    type="text"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    placeholder="Activity name..."
                    autoFocus
                    maxLength={60}
                    className="w-full px-4 py-3.5 bg-black border border-zinc-800 rounded-2xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white transition-colors"
                  />
                </div>

                {recentActivities.length > 0 && (
                  <div>
                    <span className="block text-[10px] text-zinc-500 mb-1.5">Recent Activities:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {recentActivities.map((act, i) => (
                        <span
                          key={`${act.title}-${i}`}
                          className="flex items-center gap-0.5 bg-black border border-zinc-800 rounded-lg pl-2.5 pr-1 py-1"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setTitleInput(act.title);
                              setHoursInput(act.hours);
                              setMinutesInput(act.minutes);
                            }}
                            title={act.title}
                            className="max-w-[150px] truncate text-[11px] text-zinc-300 hover:text-white transition-colors"
                          >
                            {act.title}
                            <span className="text-zinc-600 font-mono"> · {formatHoursAndMinutes(act.hours * 3600 + act.minutes * 60)}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setRecentActivities((prev) => prev.filter((_, idx) => idx !== i))
                            }
                            className="p-1 rounded-md text-zinc-600 hover:text-rose-400 transition-colors"
                            aria-label="Remove activity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  {/* Preset Quick Buttons */}
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {[
                      { label: '30m', h: 0, m: 30 },
                      { label: '1h', h: 1, m: 0 },
                      { label: '1.5h', h: 1, m: 30 },
                      { label: '2h', h: 2, m: 0 },
                    ].map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setHoursInput(p.h);
                          setMinutesInput(p.m);
                        }}
                        className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                          hoursInput === p.h && minutesInput === p.m
                            ? 'bg-white text-black border-white'
                            : 'bg-black text-zinc-400 border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Hours / Minutes inputs */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-zinc-500 mb-1">Hours</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        value={hoursInput}
                        onChange={(e) => setHoursInput(Math.max(0, Math.min(24, parseInt(e.target.value, 10) || 0)))}
                        className="w-full px-4 py-2.5 bg-black border border-zinc-800 rounded-xl font-mono text-center text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-500 mb-1">Minutes</label>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={minutesInput}
                        onChange={(e) => setMinutesInput(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
                        className="w-full px-4 py-2.5 bg-black border border-zinc-800 rounded-xl font-mono text-center text-sm text-white focus:outline-none focus:border-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAppState('idle')}
                  className="px-4 py-2.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="confirm-start-timer-btn"
                  onClick={handleStartCreation}
                  disabled={!titleInput.trim() || (hoursInput === 0 && minutesInput === 0)}
                  className="px-6 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-xs disabled:opacity-30 transition-all active:scale-95"
                >
                  Start
                </button>
              </div>
            </motion.div>
          )}

          {/* STATE 3: COUNTDOWN */}
          {appState === 'countdown' && (
            <motion.div
              key="countdown"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full flex items-center justify-center text-center"
            >
              <motion.div
                key={countdownValue}
                initial={{ scale: 0.35, opacity: 0 }}
                animate={{ scale: 1.1, opacity: 1 }}
                exit={{ scale: 1.7, opacity: 0 }}
                transition={{ duration: 0.85, ease: 'easeOut' }}
                className="text-9xl font-black font-mono text-white tracking-tight"
              >
                {countdownValue}
              </motion.div>
            </motion.div>
          )}

          {/* STATE 4: ACTIVE TIMER */}
          {appState === 'active' && activeTimer && (
            <motion.div
              key="active"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="w-full flex flex-col items-center text-center space-y-8"
            >
              {/* Task Title */}
              <div className="px-4 py-1.5 rounded-full bg-zinc-950 border border-zinc-900 text-xs font-medium text-zinc-300 max-w-full truncate">
                {activeTimer.title}
              </div>

              {/* Count-UP Clock Display */}
              <div className="space-y-1">
                <div className="text-5xl min-[420px]:text-7xl sm:text-8xl font-black font-mono tracking-tight whitespace-nowrap text-white">
                  {formatHHMMSS(activeTimer.elapsedSeconds)}
                </div>
                <div className="text-xs font-mono text-zinc-600">
                  / {formatHHMMSS(activeTimer.targetSeconds)}
                </div>
              </div>

              {/* Minimal Progress Bar (5% Steps) */}
              <div className="w-full space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-zinc-500 px-1">
                  <span>{snappedProgressPct}%</span>
                </div>
                <div className="w-full h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-900">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${visualBarWidthPct}%` }}
                  />
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-3 w-full pt-4">
                <button
                  id="pause-resume-btn"
                  onClick={handleTogglePause}
                  className={`flex-1 py-3.5 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 border transition-all active:scale-95 ${
                    activeTimer.isPaused
                      ? 'bg-white text-black border-white'
                      : 'bg-zinc-950 text-white border-zinc-800 hover:border-zinc-600'
                  }`}
                  aria-label={activeTimer.isPaused ? 'Resume Timer' : 'Pause Timer'}
                >
                  {activeTimer.isPaused ? (
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  ) : (
                    <Pause className="w-4 h-4 fill-current" />
                  )}
                  <span>{activeTimer.isPaused ? 'Resume' : 'Pause'}</span>
                </button>

                <button
                  id="cancel-timer-btn"
                  onClick={handleCancelTimer}
                  className="px-4 py-3.5 rounded-2xl bg-zinc-950 hover:bg-zinc-900 text-rose-300/80 hover:text-rose-300 border border-zinc-800 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
                  aria-label="Cancel Timer"
                  title="Cancel timer without saving"
                >
                  <X className="w-4 h-4 stroke-[2.5]" />
                  <span>Cancel</span>
                </button>

                <button
                  id="finish-timer-btn"
                  onClick={handleFinishTimer}
                  className="px-4 py-3.5 rounded-2xl bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
                  aria-label="Finish Timer"
                >
                  <Square className="w-4 h-4 fill-current" />
                  <span>Finish</span>
                </button>
              </div>
            </motion.div>
          )}

          {/* STATE 5: SUMMARY */}
          {appState === 'summary' && activeTimer && (
            <motion.div
              key="summary"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full bg-zinc-950 border border-zinc-900 rounded-3xl p-8 text-center space-y-6"
            >
              <div className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center mx-auto">
                <Check className="w-6 h-6 stroke-[3]" />
              </div>

              <div className="space-y-1">
                <div className="text-sm font-bold text-white">{activeTimer.title}</div>
                <div className="text-3xl font-black font-mono text-white pt-2">
                  {formatHHMMSS(activeTimer.elapsedSeconds)}
                </div>
              </div>

              <button
                id="back-home-btn"
                onClick={() => {
                  setActiveTimer(null);
                  setAppState('idle');
                }}
                className="w-full py-3 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-xs transition-all active:scale-95"
              >
                New Timer
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* BOTTOM LEFT: YOUTUBE MUSIC CONTROLLER */}
      <div className="fixed bottom-4 left-4 sm:bottom-6 sm:left-6 z-50 flex flex-col items-start pb-[env(safe-area-inset-bottom)]">
        {isMusicModalOpen && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsMusicModalOpen(false)}
            aria-hidden="true"
          />
        )}
        <AnimatePresence>
          {isMusicModalOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="mb-3 w-80 max-w-[calc(100vw-2rem)] bg-zinc-950 border border-zinc-800 rounded-2xl p-4 shadow-2xl text-left space-y-3"
            >
              <div className="flex items-center justify-between pb-1 border-b border-zinc-900">
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Headphones className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Audio & Podcast</span>
                </div>
                <button
                  onClick={() => setIsMusicModalOpen(false)}
                  className="p-1 rounded-lg text-zinc-500 hover:text-white transition-colors"
                  aria-label="Close Music Modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* YouTube URL or ID Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={youtubeInput}
                  onChange={(e) => setYoutubeInput(e.target.value)}
                  placeholder="YouTube URL or ID..."
                  className="flex-1 px-3 py-2 bg-black border border-zinc-800 rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-white transition-colors font-mono"
                />
                <button
                  onClick={handleApplyYoutubeUrl}
                  disabled={!youtubeInput.trim()}
                  className="px-3 py-2 rounded-xl bg-white text-black font-bold text-xs disabled:opacity-30 active:scale-95 transition-all"
                >
                  Play
                </button>
              </div>

              {/* Recent Streams List */}
              <div className="pt-2 border-t border-zinc-900 space-y-1.5">
                <span className="text-[10px] text-zinc-500 block">Recent Streams:</span>
                {videoHistory.length > 0 ? (
                  <div className="space-y-1">
                    {videoHistory.map((entry, idx) => (
                      <button
                        key={entry.id}
                        onClick={() => selectHistoryVideo(idx)}
                        title={entry.title || entry.id}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-left border transition-all ${
                          idx === currentIndex
                            ? 'bg-white text-black border-white'
                            : 'bg-black text-zinc-400 border-zinc-900 hover:border-zinc-700'
                        }`}
                      >
                        <span className="text-[11px] font-medium truncate flex-1">{entry.title || entry.id}</span>
                        {idx === currentIndex && (
                          <span className="text-[10px] font-mono opacity-60 shrink-0">{isMusicPlaying ? 'Playing' : 'Paused'}</span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-600 py-1">No recent streams yet</div>
                )}
              </div>

              {/* Player Controls */}
              {currentVideoId && (
                <div className="space-y-2 pt-2 border-t border-zinc-900">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setIsMusicPlaying(!isMusicPlaying)}
                      className="flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-800 transition-colors"
                    >
                      {isMusicPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-current" />
                          <span>Stop</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Play</span>
                        </>
                      )}
                    </button>

                    <span className="text-[10px] text-zinc-500 font-mono">
                      {isMusicPlaying ? 'Playing' : 'Stopped'}
                    </span>
                  </div>

                  {/* Seek bar with minutes/seconds */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 tabular-nums">
                      <span>{formatMSS(playerPos)}</span>
                      <span>{playerDur > 0 ? formatMSS(playerDur) : '--:--'}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={playerDur > 0 ? playerDur : 1}
                      value={playerDur > 0 ? Math.min(playerPos, playerDur) : 0}
                      onChange={(e) => handleScrub(Number(e.target.value))}
                      disabled={playerDur <= 0}
                      className="w-full accent-white disabled:opacity-30"
                      aria-label="Seek position"
                    />
                    <div className="flex items-center justify-center gap-2 pt-0.5">
                      <button
                        onClick={() => seekBy(-15)}
                        className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-xl bg-black text-zinc-300 border border-zinc-800 hover:text-white hover:border-zinc-600 transition-colors active:scale-95"
                        aria-label="Back 15 seconds"
                      >
                        <RotateCcw className="w-3 h-3" />
                        15s
                      </button>
                      <button
                        onClick={() => seekBy(15)}
                        className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-xl bg-black text-zinc-300 border border-zinc-800 hover:text-white hover:border-zinc-600 transition-colors active:scale-95"
                        aria-label="Forward 15 seconds"
                      >
                        15s
                        <RotateCw className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          id="music-toggle-btn"
          onClick={() => {
            setIsMusicModalOpen(!isMusicModalOpen);
            setIsHistoryModalOpen(false);
            setIsSettingsModalOpen(false);
          }}
          className={`relative p-3 rounded-full border transition-all duration-300 active:scale-95 shadow-xl ${
            isMusicPlaying
              ? 'bg-white text-black border-white'
              : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white hover:border-zinc-700'
          }`}
          title="Background Audio & Music"
          aria-label="Toggle Music Player"
        >
          <Music className="w-5 h-5" />
          {isMusicPlaying && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
          )}
        </button>
      </div>

      {/* BOTTOM RIGHT: 7-DAY PRODUCTIVITY HISTORY CONTROLLER */}
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex flex-col items-end pb-[env(safe-area-inset-bottom)]">
        {isHistoryModalOpen && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsHistoryModalOpen(false)}
            aria-hidden="true"
          />
        )}
        <AnimatePresence>
          {isHistoryModalOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="mb-3 w-80 sm:w-96 max-w-[calc(100vw-2rem)] max-h-[75vh] bg-zinc-950 border border-zinc-800 rounded-3xl p-5 shadow-2xl text-left flex flex-col justify-between overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-zinc-900 shrink-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <History className="w-3.5 h-3.5 text-zinc-400" />
                  <span>7-Day Productivity History</span>
                </div>
                <div className="flex items-center gap-2">
                  {completedSessions.length > 0 && (
                    <button
                      onClick={() => {
                        if (window.confirm('Clear all 7-day history?')) {
                          setCompletedSessions([]);
                        }
                      }}
                      title="Clear History"
                      className="p-1 rounded-lg text-zinc-600 hover:text-rose-400 transition-colors"
                      aria-label="Clear History"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => setIsHistoryModalOpen(false)}
                    className="p-1 rounded-lg text-zinc-500 hover:text-white transition-colors"
                    aria-label="Close History Modal"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Total Weekly Banner */}
              <div className="my-3 px-3.5 py-2.5 rounded-2xl bg-zinc-900 border border-zinc-800/80 flex items-center justify-between text-xs shrink-0">
                <span className="text-zinc-400">7-Day Total Focus:</span>
                <span className="font-bold font-mono text-white">
                  {formatHoursAndMinutes(totalWeeklySeconds)}
                </span>
              </div>

              {/* Scrollable Days List */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-left scrollbar-none">
                {weeklyDaysData.map((day, idx) => (
                  <div key={idx} className="p-3 bg-black border border-zinc-900 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-zinc-200">{day.dayTitle}</span>
                      <span className="font-mono text-[11px] text-zinc-400">
                        {formatHoursAndMinutes(day.totalElapsed)}
                      </span>
                    </div>

                    {/* Percentage statement */}
                    <div className="text-xs text-zinc-300 font-medium leading-relaxed">
                      You spent{' '}
                      <span className="font-bold font-mono text-white text-sm">
                        {day.dayPctInt}%
                      </span>{' '}
                      of your day productively
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-900">
                      <div
                        className="h-full bg-white rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, day.dayPctInt)}%` }}
                      />
                    </div>

                    {/* Day Sessions List */}
                    {day.sessions.length > 0 && (
                      <div className="pt-1.5 space-y-1 border-t border-zinc-900/60">
                        {day.sessions.map((s) => (
                          <div key={s.id} className="flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                            <span className="font-sans text-zinc-400 truncate max-w-[180px]">{s.title}</span>
                            <span>{formatHHMMSS(s.elapsedSeconds)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          id="history-toggle-btn"
          onClick={() => {
            setIsHistoryModalOpen(!isHistoryModalOpen);
            setIsMusicModalOpen(false);
            setIsSettingsModalOpen(false);
          }}
          className={`p-3 rounded-full border transition-all duration-300 active:scale-95 shadow-xl ${
            isHistoryModalOpen
              ? 'bg-white text-black border-white'
              : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white hover:border-zinc-700'
          }`}
          title="7-Day Productivity History"
          aria-label="Toggle History Modal"
        >
          <History className="w-5 h-5" />
        </button>
      </div>

      {/* Click-outside backdrop for the settings panel (kept outside its
          transformed container so fixed positioning covers the viewport) */}
      {isSettingsModalOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsSettingsModalOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* BOTTOM CENTER: SETTINGS */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:bottom-6 z-50 flex flex-col items-center pb-[env(safe-area-inset-bottom)]">
        <AnimatePresence>
          {isSettingsModalOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="mb-3 w-80 max-w-[calc(100vw-2rem)] max-h-[75vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-3xl p-4 shadow-2xl text-left space-y-2"
            >
              <div className="flex items-center justify-between pb-2 border-b border-zinc-900">
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Settings className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Settings</span>
                </div>
                <button
                  onClick={() => setIsSettingsModalOpen(false)}
                  className="p-1 rounded-lg text-zinc-500 hover:text-white transition-colors"
                  aria-label="Close Settings Modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1.5 pt-1.5">
                <Toggle
                  label="Completion notifications"
                  checked={settings.notificationsEnabled}
                  onChange={(v) => setSettings((prev) => ({ ...prev, notificationsEnabled: v }))}
                />
                <Toggle
                  label="Countdown ticks (3-2-1)"
                  checked={settings.countdownSoundEnabled}
                  onChange={(v) => setSettings((prev) => ({ ...prev, countdownSoundEnabled: v }))}
                />
                <Toggle
                  label="Completion sound"
                  checked={settings.completionSoundEnabled}
                  onChange={(v) => setSettings((prev) => ({ ...prev, completionSoundEnabled: v }))}
                />

                {settings.completionSoundEnabled && (
                  <div className="flex items-center gap-2 px-3 py-1.5 pt-0">
                    {(['chime', 'bell', 'digital'] as const).map((snd) => (
                      <button
                        key={snd}
                        type="button"
                        onClick={() => setSettings((prev) => ({ ...prev, completionSound: snd }))}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all active:scale-95 ${
                          settings.completionSound === snd
                            ? 'bg-white text-black border-white'
                            : 'bg-black text-zinc-400 border-zinc-800 hover:border-zinc-600'
                        }`}
                      >
                        {snd.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}

                <Toggle
                  label="Confetti on finish"
                  checked={settings.confettiEnabled}
                  onChange={(v) => setSettings((prev) => ({ ...prev, confettiEnabled: v }))}
                />
              </div>

              {/* Music Volume */}
              <div className="pt-1.5 border-t border-zinc-900">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-300">Music Volume</span>
                  <span className="text-[11px] font-mono text-zinc-500">{settings.musicVolume}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={settings.musicVolume}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, musicVolume: Number(e.target.value) }))
                  }
                  className="mt-1.5 w-full accent-white"
                  aria-label="Music volume"
                />
              </div>

              {settings.notificationsEnabled && 'Notification' in window && Notification.permission === 'denied' && (
                <p className="text-[10px] text-rose-300/80 leading-relaxed">
                  Notifications are blocked in the browser. Allow them in site settings for this to work.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          id="settings-toggle-btn"
          onClick={() => {
            setIsSettingsModalOpen(!isSettingsModalOpen);
            setIsMusicModalOpen(false);
            setIsHistoryModalOpen(false);
          }}
          className={`p-3 rounded-full border transition-all duration-300 active:scale-95 shadow-xl ${
            isSettingsModalOpen
              ? 'bg-white text-black border-white'
              : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white hover:border-zinc-700'
          }`}
          title="Settings"
          aria-label="Toggle Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

    </div>
  );
}
