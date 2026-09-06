import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Play, Pause, Square, Check, Music, X, Headphones, History, Trash2 } from 'lucide-react';
import { formatHHMMSS, formatHoursAndMinutes, formatDateEn } from './utils/formatters';
import { playCountdownTick, playNotificationSound } from './utils/audio';
import { AppState, ActiveTimer, CompletedSession, DayProductivity } from './types';
import confetti from 'canvas-confetti';

const STORAGE_KEYS = {
  ACTIVE: 'temora_active_timer_v1',
  HISTORY: 'temora_weekly_history_v1',
  YT_ID: 'temora_yt_id_v1',
  // Backwards compatibility keys
  LEGACY_ACTIVE: 'black_timer_active_v1',
  LEGACY_HISTORY: 'black_timer_weekly_history_v2',
  LEGACY_YT: 'black_timer_yt_id',
};

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

const PRESET_STREAMS = [
  { name: 'Lofi Girl', id: 'jfKfPfyJRdk' },
  { name: 'Lofi Chill', id: '5qap5aO4i9A' },
  { name: 'Jazz & Lofi', id: 'DWcJFNfaw9c' },
  { name: 'Ambient Rain', id: 'mPZkdNFkNps' },
];

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
  const [currentVideoId, setCurrentVideoId] = useState<string>(() => {
    return (
      localStorage.getItem(STORAGE_KEYS.YT_ID) ||
      localStorage.getItem(STORAGE_KEYS.LEGACY_YT) ||
      'jfKfPfyJRdk'
    );
  });
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);

  // Weekly History Modal State
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // Refs for tracking active session timestamps cleanly
  const lastTickRef = useRef<number>(Date.now());

  // Persist YouTube ID
  useEffect(() => {
    if (currentVideoId) {
      localStorage.setItem(STORAGE_KEYS.YT_ID, currentVideoId);
    }
  }, [currentVideoId]);

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
    let timer: ReturnType<typeof setInterval> | null = null;
    if (appState === 'countdown') {
      playCountdownTick(false);
      setCountdownValue(3);

      timer = setInterval(() => {
        setCountdownValue((prev) => {
          if (prev <= 1) {
            clearInterval(timer!);
            playCountdownTick(true);
            setAppState('active');
            return 0;
          } else {
            playCountdownTick(false);
            return prev - 1;
          }
        });
      }, 1000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [appState]);

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
  }, [titleInput, hoursInput, minutesInput]);

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

    playNotificationSound('chime', 90);
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
        }
        return;
      }

      if (e.key === 'Escape') {
        if (isMusicModalOpen) setIsMusicModalOpen(false);
        else if (isHistoryModalOpen) setIsHistoryModalOpen(false);
        else if (appState === 'create') setAppState('idle');
      } else if (e.code === 'Space' && appState === 'active') {
        e.preventDefault();
        handleTogglePause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appState, isMusicModalOpen, isHistoryModalOpen, handleStartCreation, handleTogglePause]);

  // Handle setting new YouTube audio link
  const handleApplyYoutubeUrl = () => {
    const extracted = extractYouTubeId(youtubeInput);
    if (extracted) {
      setCurrentVideoId(extracted);
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
      const dateStrKey = d.toISOString().split('T')[0];

      const daySessions = completedSessions.filter((s) => {
        try {
          const sessionDate = new Date(s.timestampIso);
          return sessionDate.toISOString().split('T')[0] === dateStrKey;
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
    <div className="h-screen w-screen bg-black text-white font-['Inter',sans-serif] overflow-hidden flex flex-col justify-between items-center p-4 sm:p-8 select-none relative dir-ltr">
      
      {/* Background YouTube Audio Stream */}
      {currentVideoId && isMusicPlaying && (
        <iframe
          key={currentVideoId}
          src={`https://www.youtube.com/embed/${currentVideoId}?autoplay=1&loop=1&playlist=${currentVideoId}&enablejsapi=1&controls=0`}
          title="TEMORA Ambient Audio"
          allow="autoplay"
          className="w-1 h-1 absolute top-0 left-0 opacity-0 pointer-events-none -z-50"
        />
      )}

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
                        onChange={(e) => setHoursInput(Math.max(0, parseInt(e.target.value, 10) || 0))}
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
                <div className="text-7xl sm:text-8xl font-black font-mono tracking-tight text-white">
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
              <div className="flex items-center justify-center gap-4 w-full pt-4">
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
                  id="finish-timer-btn"
                  onClick={handleFinishTimer}
                  className="px-5 py-3.5 rounded-2xl bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
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
      <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start">
        <AnimatePresence>
          {isMusicModalOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="mb-3 w-80 bg-zinc-950 border border-zinc-800 rounded-2xl p-4 shadow-2xl text-left space-y-3"
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

              {/* Presets */}
              <div className="space-y-1">
                <span className="text-[10px] text-zinc-500 block">Featured Lofi Channels:</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRESET_STREAMS.map((st) => (
                    <button
                      key={st.id}
                      onClick={() => {
                        setCurrentVideoId(st.id);
                        setIsMusicPlaying(true);
                      }}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-left border transition-all truncate ${
                        currentVideoId === st.id && isMusicPlaying
                          ? 'bg-white text-black border-white'
                          : 'bg-black text-zinc-400 border-zinc-900 hover:border-zinc-700'
                      }`}
                    >
                      {st.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Player Controls */}
              {currentVideoId && (
                <div className="flex items-center justify-between pt-2 border-t border-zinc-900">
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
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          id="music-toggle-btn"
          onClick={() => {
            setIsMusicModalOpen(!isMusicModalOpen);
            setIsHistoryModalOpen(false);
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
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
        <AnimatePresence>
          {isHistoryModalOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="mb-3 w-80 sm:w-96 max-h-[75vh] bg-zinc-950 border border-zinc-800 rounded-3xl p-5 shadow-2xl text-left flex flex-col justify-between overflow-hidden"
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

    </div>
  );
}
