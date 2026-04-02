import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { toast } from 'react-hot-toast';
import { getDailyRhythmSequence, getPlayStreak, recordPlay, checkNewHighScores } from '../utils/gameUtils';

const BACKEND_URL = import.meta.env.VITE_GAMES_BACKEND_URL || 'http://localhost:3005';

const BASE_BPM = 90;
const MAX_BPM = 200;
const BPM_RAMP_PER_HIT = 2;
const GAME_DURATION = 30000;
const COMBO_THRESHOLDS = [5, 10, 15, 25];

export default function RhythmRush() {
  const { address } = useAccount();
  const { state }   = useLocation();
  const wagerInfo   = state?.wager ? state : null;
  const [isDailyMode, setIsDailyMode] = useState(false);
  const [streak, setStreak] = useState({ streak: 0, playedToday: false });
  const dailySequenceRef = useRef(getDailyRhythmSequence());
  const dailyIndexRef = useRef(0);

  // Fetch streak from backend
  useEffect(() => {
    if (address) getPlayStreak(address).then(setStreak);
  }, [address]);
  const [score, setScore] = useState(0);
  const [gameActive, setGameActive] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [progress, setProgress] = useState(0);
  const [currentTarget, setCurrentTarget] = useState(1);
  const [feedback, setFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState('');
  const [gameOver, setGameOver] = useState(false);
  const [myRank, setMyRank] = useState(null);
  const [nextGap, setNextGap] = useState(null);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [comboMultiplier, setComboMultiplier] = useState(1);
  const [bpm, setBpm] = useState(BASE_BPM);
  const [shakeScreen, setShakeScreen] = useState(false);
  const [comboFlash, setComboFlash] = useState(null);
  const [perfectStreak, setPerfectStreak] = useState(0);
  const [countdown, setCountdown] = useState(null); // 3, 2, 1, GO
  const [perfectHits, setPerfectHits] = useState(0);
  const [goodHits, setGoodHits] = useState(0);
  const [missHits, setMissHits] = useState(0);
  const [totalTaps, setTotalTaps] = useState(0);
  const [copied, setCopied] = useState(false);

  const gameTimerRef = useRef(null);
  const beatIntervalRef = useRef(null);
  const startTimeRef = useRef(0);
  const targetStartTimeRef = useRef(0);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const perfectRef = useRef(0);
  const goodRef = useRef(0);
  const missRef = useRef(0);
  const totalRef = useRef(0);
  const bpmRef = useRef(BASE_BPM);
  const beatHitRef = useRef(false);
  const audioContextRef = useRef(null);
  const toneGeneratorsRef = useRef({});

  const buttons = [1, 2, 3, 4];
  const BUTTON_COLORS = {
    1: { active: '#a855f7', glow: 'rgba(168,85,247,0.8)', key: '1 / ←' },
    2: { active: '#06b6d4', glow: 'rgba(6,182,212,0.8)', key: '2 / ↑' },
    3: { active: '#10b981', glow: 'rgba(16,185,129,0.8)', key: '3 / →' },
    4: { active: '#f59e0b', glow: 'rgba(245,158,11,0.8)', key: '4 / ↓' },
  };

  // Compute dynamic beat interval from BPM
  const getBeatInterval = (currentBpm) => Math.round(60000 / currentBpm);

  useEffect(() => {
    const frequencies = { 1: 440, 2: 523.25, 3: 659.25, 4: 783.99 };
    const generateTone = (frequency, duration = 0.12) => () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ctx = audioContextRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = frequency;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
      } catch (_) {}
    };
    buttons.forEach((b) => {
      toneGeneratorsRef.current[`tone${b}`] = generateTone(frequencies[b]);
    });
    toneGeneratorsRef.current['perfect'] = generateTone(1046.5, 0.15);
    toneGeneratorsRef.current['combo'] = generateTone(1318.5, 0.2);
    toneGeneratorsRef.current['miss'] = generateTone(220, 0.1);
  }, []);

  const playTone = (name) => {
    const fn = toneGeneratorsRef.current[name];
    if (typeof fn === 'function') fn();
  };

  // Schedule next beat with dynamic BPM
  const scheduleNextBeat = () => {
    if (beatIntervalRef.current) clearTimeout(beatIntervalRef.current);
    beatIntervalRef.current = setTimeout(() => {
      beatHitRef.current = false;
      setCurrentTarget((prev) => {
        let next;
        if (isDailyMode) {
          next = dailySequenceRef.current[dailyIndexRef.current % dailySequenceRef.current.length];
          dailyIndexRef.current++;
        } else {
          // Random target, but never same as previous (forces movement)
          do { next = Math.floor(Math.random() * 4) + 1; } while (next === prev);
        }
        targetStartTimeRef.current = Date.now();
        playTone(`tone${next}`);
        return next;
      });
      scheduleNextBeat();
    }, getBeatInterval(bpmRef.current));
  };

  const actualStart = () => {
    setCountdown(null);
    setScore(0); scoreRef.current = 0;
    setCombo(0); comboRef.current = 0;
    setMaxCombo(0); maxComboRef.current = 0;
    setComboMultiplier(1);
    setBpm(BASE_BPM); bpmRef.current = BASE_BPM;
    setPerfectStreak(0);
    setPerfectHits(0); perfectRef.current = 0;
    setGoodHits(0); goodRef.current = 0;
    setMissHits(0); missRef.current = 0;
    setTotalTaps(0); totalRef.current = 0;
    setCopied(false);
    setGameActive(true);
    setGameOver(false);
    setTimeRemaining(30);
    setProgress(0);
    setCurrentTarget(1);
    setFeedback('');
    setFeedbackType('');
    setShakeScreen(false);
    setComboFlash(null);
    startTimeRef.current = Date.now();
    targetStartTimeRef.current = Date.now();

    beatHitRef.current = false;
    scheduleNextBeat();

    gameTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, Math.ceil((GAME_DURATION - elapsed) / 1000));
      setTimeRemaining(remaining);
      setProgress(Math.min((elapsed / GAME_DURATION) * 100, 100));
      if (elapsed >= GAME_DURATION) endGame();
    }, 100);
  };

  const startGame = () => {
    setGameOver(false);
    setCountdown(3);
    playTone('perfect');
    setTimeout(() => { setCountdown(2); playTone('perfect'); }, 1000);
    setTimeout(() => { setCountdown(1); playTone('perfect'); }, 2000);
    setTimeout(() => { setCountdown('GO!'); playTone('combo'); }, 3000);
    setTimeout(() => actualStart(), 3500);
  };

  const saveScore = async (finalScore, gameTime) => {
    try {
      const existing = JSON.parse(localStorage.getItem('rhythmrush_scores') || '[]');
      existing.push({ score: finalScore, date: Date.now() });
      existing.sort((a, b) => b.score - a.score);
      localStorage.setItem('rhythmrush_scores', JSON.stringify(existing.slice(0, 10)));
    } catch (_) {}
    if (!address) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/submit-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerAddress: address,
          scoreData: {
            game: 'rhythm', score: finalScore, gameTime,
            wagered: wagerInfo?.amount || null,
            wagerId: wagerInfo?.wagerId || null,
          },
        }),
      });
      const data = await res.json();
      if (data.streak) {
        setStreak({ streak: data.streak, playedToday: true });
        if (data.streak >= 3) toast(`🔥 ${data.streak}-day streak!`, { icon: '🔥' });
      }
      if (data.rank) {
        setMyRank(data.rank);
        const lb = await fetch(`${BACKEND_URL}/api/leaderboard?game=rhythm`);
        const { leaderboard } = await lb.json();
        const above = leaderboard[data.rank - 2];
        if (above) setNextGap(above.score - finalScore);
      }
    } catch (_) {}
  };

  const endGame = useCallback(() => {
    setGameActive(false);
    setGameOver(true);
    setMyRank(null);
    setNextGap(null);
    if (beatIntervalRef.current) clearTimeout(beatIntervalRef.current);
    if (gameTimerRef.current) clearInterval(gameTimerRef.current);
    recordPlay(); // no-op, streak handled server-side
    saveScore(scoreRef.current, Date.now() - startTimeRef.current);
  }, []);

  // Poll for live score notifications
  useEffect(() => {
    const interval = setInterval(() => {
      checkNewHighScores(BACKEND_URL, (msg) => {
        toast(msg, { icon: '🎯', style: { background: '#1a1a2e', color: '#fff', border: '1px solid rgba(168,85,247,0.3)' } });
      });
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const triggerComboMilestone = (newCombo) => {
    let label = null;
    if (newCombo >= 25) label = 'UNSTOPPABLE!';
    else if (newCombo >= 15) label = 'ON FIRE!';
    else if (newCombo >= 10) label = 'COMBO x3!';
    else if (newCombo >= 5) label = 'COMBO x2!';
    if (label) {
      playTone('combo');
      setComboFlash(label);
      setShakeScreen(true);
      setTimeout(() => setComboFlash(null), 1200);
      setTimeout(() => setShakeScreen(false), 300);
    }
  };

  const handleButtonClick = useCallback((clickedBeat) => {
    if (!gameActive) return;
    if (beatHitRef.current) return;
    const timeSince = Date.now() - targetStartTimeRef.current;
    playTone(`tone${clickedBeat}`);

    if (clickedBeat === currentTarget) {
      beatHitRef.current = true;

      // Update combo
      const newCombo = comboRef.current + 1;
      comboRef.current = newCombo;
      setCombo(newCombo);
      if (newCombo > maxComboRef.current) {
        maxComboRef.current = newCombo;
        setMaxCombo(newCombo);
      }

      // Multiplier: 1x base, 2x at 5 combo, 3x at 10, 4x at 15, 5x at 25
      const mult = newCombo >= 25 ? 5 : newCombo >= 15 ? 4 : newCombo >= 10 ? 3 : newCombo >= 5 ? 2 : 1;
      setComboMultiplier(mult);

      // Check combo milestones
      if (COMBO_THRESHOLDS.includes(newCombo)) {
        triggerComboMilestone(newCombo);
      }

      // Increase BPM
      const newBpm = Math.min(MAX_BPM, bpmRef.current + BPM_RAMP_PER_HIT);
      bpmRef.current = newBpm;
      setBpm(newBpm);

      // Score with multiplier
      const perfectWindow = Math.max(200, 400 - (bpmRef.current - BASE_BPM));
      const goodWindow = Math.max(400, 700 - (bpmRef.current - BASE_BPM) * 0.5);

      totalRef.current++; setTotalTaps(totalRef.current);
      if (timeSince <= perfectWindow) {
        playTone('perfect');
        perfectRef.current++; setPerfectHits(perfectRef.current);
        const pts = 10 * mult;
        setScore((prev) => { const n = prev + pts; scoreRef.current = n; return n; });
        setPerfectStreak(p => p + 1);
        setFeedback(`PERFECT! +${pts}${mult > 1 ? ` (${mult}x)` : ''}`);
        setFeedbackType('perfect');
      } else if (timeSince <= goodWindow) {
        goodRef.current++; setGoodHits(goodRef.current);
        const pts = 5 * mult;
        setScore((prev) => { const n = prev + pts; scoreRef.current = n; return n; });
        setPerfectStreak(0);
        setFeedback(`GOOD +${pts}${mult > 1 ? ` (${mult}x)` : ''}`);
        setFeedbackType('good');
      } else {
        missRef.current++; setMissHits(missRef.current);
        comboRef.current = 0;
        setCombo(0);
        setComboMultiplier(1);
        setPerfectStreak(0);
        bpmRef.current = Math.max(BASE_BPM, bpmRef.current - 5);
        setBpm(bpmRef.current);
        playTone('miss');
        setFeedback('LATE!');
        setFeedbackType('miss');
      }
    } else {
      totalRef.current++; setTotalTaps(totalRef.current);
      missRef.current++; setMissHits(missRef.current);
      comboRef.current = 0;
      setCombo(0);
      setComboMultiplier(1);
      setPerfectStreak(0);
      bpmRef.current = Math.max(BASE_BPM, bpmRef.current - 10);
      setBpm(bpmRef.current);
      playTone('miss');
      setFeedback('WRONG!');
      setFeedbackType('miss');
    }

    setTimeout(() => { setFeedback(''); setFeedbackType(''); }, 600);
  }, [gameActive, currentTarget]);

  // Keyboard
  useEffect(() => {
    const map = {
      '1': 1, 'ArrowLeft': 1, 'a': 1, 'A': 1,
      '2': 2, 'ArrowUp': 2, 'w': 2, 'W': 2,
      '3': 3, 'ArrowRight': 3, 'd': 3, 'D': 3,
      '4': 4, 'ArrowDown': 4, 's': 4, 'S': 4,
    };
    const onKey = (e) => {
      if (!gameActive) return;
      const btn = map[e.key];
      if (btn !== undefined) { e.preventDefault(); handleButtonClick(btn); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameActive, handleButtonClick]);

  useEffect(() => {
    return () => {
      if (beatIntervalRef.current) clearTimeout(beatIntervalRef.current);
      if (gameTimerRef.current) clearInterval(gameTimerRef.current);
    };
  }, []);

  const feedbackColor = feedbackType === 'perfect' ? '#10b981' : feedbackType === 'good' ? '#f59e0b' : '#ef4444';

  // Dynamic hue shift based on BPM intensity
  const intensity = Math.min(1, (bpm - BASE_BPM) / (MAX_BPM - BASE_BPM));
  const panelBorder = gameActive
    ? `1px solid rgba(${Math.round(168 + 71 * intensity)},${Math.round(85 - 85 * intensity)},${Math.round(247 - 200 * intensity)},${0.2 + intensity * 0.4})`
    : '1px solid rgba(168,85,247,0.2)';

  return (
    <div style={{
      fontFamily: 'Orbitron, monospace',
      animation: shakeScreen ? 'screenShake 0.3s ease' : 'none',
    }}>
      {/* Wager banner */}
      {wagerInfo && (
        <div style={{
          marginBottom: '16px', padding: '10px 16px',
          background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.4)',
          borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ color: '#a855f7', fontSize: '11px', fontWeight: 700, letterSpacing: '1px' }}>
            WAGER: {wagerInfo.amount} G$
          </span>
          <span style={{ color: '#6b7280', fontSize: '10px' }}>
            Win at {wagerInfo.winAt} → <span style={{ color: '#10b981' }}>{wagerInfo.payout} payout</span>
          </span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ color: '#a855f7', fontSize: '22px', fontWeight: 900, letterSpacing: '2px', margin: 0 }}>
            RHYTHM_RUSH
          </h1>
          <p style={{ color: '#6b7280', fontSize: '11px', letterSpacing: '1px', marginTop: '4px' }}>
            {wagerInfo ? `WAGER MODE — score ${wagerInfo.winAt} to win` : 'FREE PLAY — no wager required'}
          </p>
        </div>
        <Link to="/" style={{
          color: '#6b7280', fontSize: '11px', fontFamily: 'Orbitron, monospace',
          letterSpacing: '1px', textDecoration: 'none',
          border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: '4px',
        }}>
          ← GAMES
        </Link>
      </div>

      {/* Countdown overlay */}
      {countdown !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,5,15,0.85)',
        }}>
          <div style={{
            color: countdown === 'GO!' ? '#10b981' : '#a855f7',
            fontSize: countdown === 'GO!' ? '72px' : '96px',
            fontWeight: 900, fontFamily: 'Orbitron, monospace',
            animation: 'countPop 0.8s ease',
            textShadow: `0 0 40px ${countdown === 'GO!' ? 'rgba(16,185,129,0.5)' : 'rgba(168,85,247,0.5)'}`,
          }}>
            {countdown}
          </div>
        </div>
      )}

      {/* Game Panel */}
      <div style={{
        background: 'rgba(10,10,20,0.8)',
        border: panelBorder,
        borderRadius: '12px',
        padding: '28px',
        maxWidth: '480px',
        margin: '0 auto',
        transition: 'border 0.3s',
      }}>
        {/* Score + Combo + Timer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>SCORE</div>
            <div style={{ color: '#a855f7', fontSize: '36px', fontWeight: 900, lineHeight: 1 }}>{score}</div>
          </div>
          {gameActive && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>COMBO</div>
              <div style={{
                color: combo >= 15 ? '#ef4444' : combo >= 10 ? '#f59e0b' : combo >= 5 ? '#10b981' : '#6b7280',
                fontSize: '36px', fontWeight: 900, lineHeight: 1,
                transition: 'color 0.2s',
              }}>
                {combo}
                {comboMultiplier > 1 && (
                  <span style={{ fontSize: '14px', color: '#f59e0b' }}> ×{comboMultiplier}</span>
                )}
              </div>
            </div>
          )}
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>TIME</div>
            <div style={{
              color: timeRemaining <= 5 ? '#ef4444' : '#06b6d4',
              fontSize: '36px', fontWeight: 900, lineHeight: 1,
              transition: 'color 0.3s',
            }}>
              {timeRemaining}
            </div>
          </div>
        </div>

        {/* BPM indicator */}
        {gameActive && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '8px', padding: '4px 8px',
            background: `rgba(${Math.round(239 * intensity)},${Math.round(68 * (1 - intensity))},68,0.08)`,
            borderRadius: '4px',
          }}>
            <span style={{ color: '#6b7280', fontSize: '9px', letterSpacing: '1px' }}>SPEED</span>
            <div style={{ flex: 1, margin: '0 8px', height: '3px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${intensity * 100}%`,
                background: `linear-gradient(90deg, #10b981, #f59e0b, #ef4444)`,
                transition: 'width 0.3s',
                borderRadius: '2px',
              }} />
            </div>
            <span style={{
              color: intensity > 0.7 ? '#ef4444' : intensity > 0.4 ? '#f59e0b' : '#10b981',
              fontSize: '10px', fontWeight: 900,
            }}>
              {bpm} BPM
            </span>
          </div>
        )}

        {/* Progress Bar */}
        <div style={{
          background: 'rgba(255,255,255,0.05)', borderRadius: '4px',
          height: '4px', marginBottom: '20px', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${progress}%`,
            background: `linear-gradient(90deg, #a855f7, ${intensity > 0.5 ? '#ef4444' : '#06b6d4'})`,
            transition: 'width 0.1s linear', borderRadius: '4px',
          }} />
        </div>

        {/* Combo milestone flash */}
        {comboFlash && (
          <div style={{
            textAlign: 'center', marginBottom: '12px',
            animation: 'comboFlash 1.2s ease forwards',
          }}>
            <span style={{
              color: '#f59e0b', fontSize: '24px', fontWeight: 900,
              textShadow: '0 0 20px rgba(245,158,11,0.5)',
              letterSpacing: '4px',
            }}>
              {comboFlash}
            </span>
          </div>
        )}

        {/* Target Indicator */}
        {gameActive && !comboFlash && (
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <span style={{
              color: BUTTON_COLORS[currentTarget]?.active || '#fff',
              fontSize: '18px', fontWeight: 700, letterSpacing: '2px',
            }}>
              TAP {currentTarget}
            </span>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
          {buttons.map((beat) => {
            const isTarget = gameActive && beat === currentTarget;
            const color = BUTTON_COLORS[beat];
            const pulseScale = isTarget ? (1.1 + intensity * 0.05) : 1;
            return (
              <button key={beat} onClick={() => handleButtonClick(beat)}
                style={{
                  aspectRatio: '1', borderRadius: '50%',
                  border: `3px solid ${isTarget ? color.active : 'rgba(255,255,255,0.1)'}`,
                  background: isTarget ? `${color.active}22` : 'rgba(255,255,255,0.03)',
                  color: isTarget ? color.active : '#4b5563',
                  fontSize: '20px', fontWeight: 900,
                  cursor: gameActive ? 'pointer' : 'default',
                  boxShadow: isTarget ? `0 0 ${24 + intensity * 20}px ${color.glow}` : 'none',
                  transform: `scale(${pulseScale})`,
                  transition: 'all 0.08s ease',
                  fontFamily: 'Orbitron, monospace',
                }}
              >
                {beat}
              </button>
            );
          })}
        </div>

        {/* Feedback */}
        <div style={{ height: '28px', textAlign: 'center', marginBottom: '16px' }}>
          {feedback && (
            <span style={{
              color: feedbackColor, fontSize: '14px', fontWeight: 700,
              letterSpacing: '1px', animation: 'fadeInUp 0.15s ease',
            }}>
              {feedback}
            </span>
          )}
        </div>

        {/* Start / End button */}
        {!gameActive ? (
          <button onClick={startGame}
            style={{
              width: '100%', padding: '14px',
              background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
              border: 'none', borderRadius: '8px', color: '#fff',
              fontSize: '14px', fontWeight: 700, letterSpacing: '2px',
              cursor: 'pointer', fontFamily: 'Orbitron, monospace',
            }}
          >
            {gameOver ? 'PLAY_AGAIN' : 'START_GAME'}
          </button>
        ) : (
          <button onClick={endGame}
            style={{
              width: '100%', padding: '14px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px', color: '#6b7280',
              fontSize: '14px', fontWeight: 700, letterSpacing: '2px',
              cursor: 'pointer', fontFamily: 'Orbitron, monospace',
            }}
          >
            END_GAME
          </button>
        )}

        {/* Game Over result */}
        {gameOver && (
          <div style={{ marginTop: '20px' }}>
            <div style={{
              padding: '20px',
              background: 'rgba(168,85,247,0.08)',
              border: '1px solid rgba(168,85,247,0.3)',
              borderRadius: '8px', textAlign: 'center', marginBottom: '10px',
            }}>
              {/* Letter grade */}
              {(() => {
                const accuracy = totalTaps > 0 ? Math.round((perfectHits / totalTaps) * 100) : 0;
                const grade = score >= 500 ? 'S' : score >= 350 ? 'A' : score >= 200 ? 'B' : score >= 100 ? 'C' : 'D';
                const gradeColor = { S: '#f59e0b', A: '#10b981', B: '#06b6d4', C: '#a855f7', D: '#6b7280' }[grade];
                const gradeLabel = { S: 'LEGENDARY', A: 'SKILLED', B: 'SOLID', C: 'DECENT', D: 'KEEP GOING' }[grade];
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginBottom: '8px' }}>
                      <div style={{
                        width: '56px', height: '56px', borderRadius: '12px',
                        background: `${gradeColor}20`, border: `2px solid ${gradeColor}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '32px', fontWeight: 900, color: gradeColor,
                      }}>{grade}</div>
                      <div>
                        <div style={{ color: '#fff', fontSize: '36px', fontWeight: 900, lineHeight: 1 }}>{score}</div>
                        <div style={{ color: gradeColor, fontSize: '10px', letterSpacing: '1px', fontWeight: 700 }}>{gradeLabel}</div>
                      </div>
                    </div>

                    {/* Stats breakdown */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px',
                      padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', marginTop: '10px',
                    }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#10b981', fontSize: '16px', fontWeight: 900 }}>{perfectHits}</div>
                        <div style={{ color: '#6b7280', fontSize: '7px', letterSpacing: '1px' }}>PERFECT</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#f59e0b', fontSize: '16px', fontWeight: 900 }}>{goodHits}</div>
                        <div style={{ color: '#6b7280', fontSize: '7px', letterSpacing: '1px' }}>GOOD</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#ef4444', fontSize: '16px', fontWeight: 900 }}>{missHits}</div>
                        <div style={{ color: '#6b7280', fontSize: '7px', letterSpacing: '1px' }}>MISS</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#06b6d4', fontSize: '16px', fontWeight: 900 }}>{accuracy}%</div>
                        <div style={{ color: '#6b7280', fontSize: '7px', letterSpacing: '1px' }}>ACCURACY</div>
                      </div>
                    </div>

                    <div style={{
                      display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '8px',
                      padding: '6px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px',
                    }}>
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ color: '#f59e0b', fontSize: '14px', fontWeight: 900 }}>{maxCombo}x</span>
                        <span style={{ color: '#6b7280', fontSize: '8px', marginLeft: '4px' }}>COMBO</span>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ color: '#ef4444', fontSize: '14px', fontWeight: 900 }}>{Math.round(bpm)}</span>
                        <span style={{ color: '#6b7280', fontSize: '8px', marginLeft: '4px' }}>BPM</span>
                      </div>
                    </div>
                  </>
                );
              })()}

              {myRank && (
                <div style={{
                  display: 'inline-block', marginTop: '10px', padding: '6px 18px',
                  background: myRank <= 3 ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${myRank <= 3 ? '#a855f7' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '20px',
                }}>
                  <span style={{ color: myRank <= 3 ? '#a855f7' : '#9ca3af', fontSize: '13px', fontWeight: 900 }}>
                    {myRank === 1 ? '🥇 #1' : myRank === 2 ? '🥈 #2' : myRank === 3 ? '🥉 #3' : `#${myRank}`}
                  </span>
                </div>
              )}

              {nextGap !== null && nextGap > 0 && myRank > 1 && (
                <div style={{
                  marginTop: '10px', padding: '7px 12px', borderRadius: '6px',
                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                }}>
                  <span style={{ color: '#ef4444', fontSize: '11px', fontWeight: 700 }}>
                    {nextGap} PTS FROM #{myRank - 1} — PLAY AGAIN
                  </span>
                </div>
              )}

              {wagerInfo && (
                <div style={{
                  marginTop: '10px', padding: '8px 12px', borderRadius: '6px',
                  background: score >= 350 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                  border: `1px solid ${score >= 350 ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
                }}>
                  {score >= 350
                    ? <span style={{ color: '#10b981', fontWeight: 700, fontSize: '13px' }}>
                        WON — {(parseFloat(wagerInfo.amount) * 1.3).toFixed(1)} G$ incoming
                      </span>
                    : <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '13px' }}>
                        LOST — {wagerInfo.amount} G$ wagered
                      </span>
                  }
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <Link to="/leaderboard" style={{
                flex: 1, display: 'block', padding: '11px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px', color: '#9ca3af',
                fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
                textDecoration: 'none', textAlign: 'center',
                fontFamily: 'Orbitron, monospace',
              }}>
                LEADERBOARD
              </Link>
              <button
                onClick={() => {
                  const accuracy = totalTaps > 0 ? Math.round((perfectHits / totalTaps) * 100) : 0;
                  const grade = score >= 500 ? 'S' : score >= 350 ? 'A' : score >= 200 ? 'B' : score >= 100 ? 'C' : 'D';
                  const text = `🎮 GameArena — Rhythm Rush\n🎵 Score: ${score} | Grade: ${grade} | Combo: ${maxCombo}x\n🎯 Accuracy: ${accuracy}% | ${perfectHits} Perfects\n\nPlay now: ${window.location.origin}`;
                  navigator.clipboard.writeText(text).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
                style={{
                  flex: 1, padding: '11px',
                  background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(168,85,247,0.12)',
                  border: `1px solid ${copied ? 'rgba(16,185,129,0.4)' : 'rgba(168,85,247,0.4)'}`,
                  borderRadius: '8px', color: copied ? '#10b981' : '#a855f7',
                  fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
                  cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                }}
              >
                {copied ? 'COPIED!' : 'SHARE SCORE'}
              </button>
            </div>
          </div>
        )}

        {/* Instructions + Daily Challenge + Streak */}
        {!gameActive && !gameOver && (
          <div style={{ marginTop: '20px' }}>
            {/* Streak banner */}
            {streak.streak >= 1 && (
              <div style={{
                textAlign: 'center', marginBottom: '12px', padding: '6px',
                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                borderRadius: '6px',
              }}>
                <span style={{ color: '#f59e0b', fontSize: '11px', fontWeight: 700 }}>
                  🔥 {streak.streak}-DAY STREAK {streak.playedToday ? '✓' : '— play to keep it!'}
                </span>
              </div>
            )}

            {/* Daily challenge button */}
            <button
              onClick={() => { setIsDailyMode(true); dailyIndexRef.current = 0; startGame(); }}
              style={{
                width: '100%', padding: '12px', marginBottom: '10px',
                background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.15))',
                border: '1px solid rgba(245,158,11,0.4)',
                borderRadius: '8px', color: '#f59e0b',
                fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
                cursor: 'pointer', fontFamily: 'Orbitron, monospace',
              }}
            >
              DAILY CHALLENGE — same sequence for everyone today
            </button>

            <div style={{ color: '#4b5563', fontSize: '11px', lineHeight: '1.8', textAlign: 'center' }}>
              <div style={{ color: '#6b7280', marginBottom: '6px' }}>HOW TO PLAY</div>
              Tap the <span style={{ color: '#a855f7' }}>glowing button</span> as it lights up<br />
              <span style={{ color: '#10b981' }}>Build combos</span> for multiplied points (5 hits = 2x, 10 = 3x)<br />
              Speed increases with each hit — <span style={{ color: '#ef4444' }}>miss resets combo</span><br />
              <span style={{ color: '#4b5563' }}>Keys: 1–4 · Arrows · WASD</span>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes screenShake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-4px) rotate(-0.5deg); }
          40% { transform: translateX(4px) rotate(0.5deg); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(3px); }
        }
        @keyframes countPop {
          0% { opacity: 0; transform: scale(2); }
          30% { opacity: 1; transform: scale(0.9); }
          50% { transform: scale(1.05); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes comboFlash {
          0% { opacity: 0; transform: scale(0.5); }
          30% { opacity: 1; transform: scale(1.3); }
          60% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.1) translateY(-10px); }
        }
      `}</style>
    </div>
  );
}
