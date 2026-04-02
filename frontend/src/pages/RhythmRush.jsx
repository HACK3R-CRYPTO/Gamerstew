import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAccount } from 'wagmi';

const BACKEND_URL = import.meta.env.VITE_GAMES_BACKEND_URL || 'http://localhost:3005';

const BEAT_INTERVAL = 800;
const GAME_DURATION = 30000;

export default function RhythmRush() {
  const { address } = useAccount();
  const { state }   = useLocation();
  const wagerInfo   = state?.wager ? state : null; // { wager, amount, winAt, payout }
  const [score, setScore] = useState(0);
  const [gameActive, setGameActive] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [progress, setProgress] = useState(0);
  const [currentTarget, setCurrentTarget] = useState(1);
  const [feedback, setFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState('');
  const [gameOver, setGameOver] = useState(false);
  const [myRank,   setMyRank]   = useState(null);
  const [nextGap,  setNextGap]  = useState(null); // pts to beat rank above

  const gameTimerRef = useRef(null);
  const beatIntervalRef = useRef(null);
  const startTimeRef = useRef(0);
  const targetStartTimeRef = useRef(0);
  const scoreRef = useRef(0);
  const beatHitRef = useRef(false); // prevent multi-tap on same beat
  const audioContextRef = useRef(null);
  const toneGeneratorsRef = useRef({});

  const buttons = [1, 2, 3, 4];
  const BUTTON_COLORS = {
    1: { active: '#a855f7', glow: 'rgba(168,85,247,0.8)', key: '1 / ←' },
    2: { active: '#06b6d4', glow: 'rgba(6,182,212,0.8)', key: '2 / ↑' },
    3: { active: '#10b981', glow: 'rgba(16,185,129,0.8)', key: '3 / →' },
    4: { active: '#f59e0b', glow: 'rgba(245,158,11,0.8)', key: '4 / ↓' },
  };

  // Init Web Audio API tones
  useEffect(() => {
    const frequencies = { 1: 440, 2: 523.25, 3: 659.25, 4: 783.99 };

    const generateTone = (frequency, duration = 0.12) => () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ctx = audioContextRef.current;
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + duration);
      } catch (_) {}
    };

    buttons.forEach((b) => {
      toneGeneratorsRef.current[`tone${b}`] = generateTone(frequencies[b]);
    });
    toneGeneratorsRef.current['perfect'] = generateTone(1046.5, 0.15);
    toneGeneratorsRef.current['miss'] = generateTone(220, 0.1);
  }, []);

  const playTone = (name) => {
    const fn = toneGeneratorsRef.current[name];
    if (typeof fn === 'function') fn();
  };

  const startGame = () => {
    setScore(0);
    scoreRef.current = 0;
    setGameActive(true);
    setGameOver(false);
    setTimeRemaining(30);
    setProgress(0);
    setCurrentTarget(1);
    setFeedback('');
    setFeedbackType('');
    startTimeRef.current = Date.now();
    targetStartTimeRef.current = Date.now();

    beatHitRef.current = false;
    beatIntervalRef.current = setInterval(() => {
      beatHitRef.current = false; // unlock for next beat
      setCurrentTarget((prev) => {
        const next = (prev % 4) + 1;
        targetStartTimeRef.current = Date.now();
        playTone(`tone${next}`);
        return next;
      });
    }, BEAT_INTERVAL);

    gameTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, Math.ceil((GAME_DURATION - elapsed) / 1000));
      setTimeRemaining(remaining);
      setProgress(Math.min((elapsed / GAME_DURATION) * 100, 100));
      if (elapsed >= GAME_DURATION) endGame();
    }, 100);
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
      const res  = await fetch(`${BACKEND_URL}/api/submit-score`, {
        method:  'POST',
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
      if (data.rank) {
        setMyRank(data.rank);
        // Fetch leaderboard to get gap to rank above
        const lb = await fetch(`${BACKEND_URL}/api/leaderboard?game=rhythm`);
        const { leaderboard } = await lb.json();
        const above = leaderboard[data.rank - 2]; // rank - 2 because array is 0-indexed
        if (above) setNextGap(above.score - finalScore);
      }
    } catch (_) {}
  };

  const endGame = useCallback(() => {
    setGameActive(false);
    setGameOver(true);
    setMyRank(null);
    setNextGap(null);
    if (beatIntervalRef.current) clearInterval(beatIntervalRef.current);
    if (gameTimerRef.current) clearInterval(gameTimerRef.current);
    saveScore(scoreRef.current, Date.now() - startTimeRef.current);
  }, []);

  const handleButtonClick = useCallback((clickedBeat) => {
    if (!gameActive) return;
    if (beatHitRef.current) return; // already scored this beat
    const timeSince = Date.now() - targetStartTimeRef.current;
    playTone(`tone${clickedBeat}`);

    if (clickedBeat === currentTarget) {
      beatHitRef.current = true; // lock — one score per beat
      if (timeSince <= 400) {
        playTone('perfect');
        setScore((prev) => { const n = prev + 10; scoreRef.current = n; return n; });
        setFeedback('Perfect! +10');
        setFeedbackType('perfect');
      } else if (timeSince <= 700) {
        setScore((prev) => { const n = prev + 5; scoreRef.current = n; return n; });
        setFeedback('Good! +5');
        setFeedbackType('good');
      } else {
        playTone('miss');
        setFeedback('Too late!');
        setFeedbackType('miss');
      }
    } else {
      playTone('miss');
      setFeedback('Wrong! Tap the glowing one!');
      setFeedbackType('miss');
    }

    setTimeout(() => { setFeedback(''); setFeedbackType(''); }, 800);
  }, [gameActive, currentTarget]);

  // Keyboard controls
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
      if (beatIntervalRef.current) clearInterval(beatIntervalRef.current);
      if (gameTimerRef.current) clearInterval(gameTimerRef.current);
    };
  }, []);

  const feedbackColor = feedbackType === 'perfect' ? '#10b981' : feedbackType === 'good' ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ fontFamily: 'Orbitron, monospace' }}>
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
        <Link
          to="/"
          style={{
            color: '#6b7280',
            fontSize: '11px',
            fontFamily: 'Orbitron, monospace',
            letterSpacing: '1px',
            textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '6px 12px',
            borderRadius: '4px',
          }}
        >
          ← GAMES
        </Link>
      </div>

      {/* Game Panel */}
      <div style={{
        background: 'rgba(10,10,20,0.8)',
        border: '1px solid rgba(168,85,247,0.2)',
        borderRadius: '12px',
        padding: '28px',
        maxWidth: '480px',
        margin: '0 auto',
      }}>
        {/* Score + Timer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>SCORE</div>
            <div style={{ color: '#a855f7', fontSize: '42px', fontWeight: 900, lineHeight: 1 }}>{score}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>TIME</div>
            <div style={{
              color: timeRemaining <= 5 ? '#ef4444' : '#06b6d4',
              fontSize: '42px', fontWeight: 900, lineHeight: 1,
              transition: 'color 0.3s',
            }}>
              {timeRemaining}
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '4px',
          height: '4px',
          marginBottom: '24px',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #a855f7, #06b6d4)',
            transition: 'width 0.1s linear',
            borderRadius: '4px',
          }} />
        </div>

        {/* Target Indicator */}
        {gameActive && (
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <span style={{
              color: BUTTON_COLORS[currentTarget]?.active || '#fff',
              fontSize: '18px',
              fontWeight: 700,
              letterSpacing: '2px',
            }}>
              TAP {currentTarget}
            </span>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {buttons.map((beat) => {
            const isTarget = gameActive && beat === currentTarget;
            const color = BUTTON_COLORS[beat];
            return (
              <button
                key={beat}
                onClick={() => handleButtonClick(beat)}
                style={{
                  aspectRatio: '1',
                  borderRadius: '50%',
                  border: `3px solid ${isTarget ? color.active : 'rgba(255,255,255,0.1)'}`,
                  background: isTarget ? `${color.active}22` : 'rgba(255,255,255,0.03)',
                  color: isTarget ? color.active : '#4b5563',
                  fontSize: '20px',
                  fontWeight: 900,
                  cursor: gameActive ? 'pointer' : 'default',
                  boxShadow: isTarget ? `0 0 24px ${color.glow}` : 'none',
                  transform: isTarget ? 'scale(1.1)' : 'scale(1)',
                  transition: 'all 0.1s ease',
                  fontFamily: 'Orbitron, monospace',
                }}
              >
                {beat}
              </button>
            );
          })}
        </div>

        {/* Feedback */}
        <div style={{ height: '28px', textAlign: 'center', marginBottom: '20px' }}>
          {feedback && (
            <span style={{
              color: feedbackColor,
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '1px',
              animation: 'fadeInUp 0.15s ease',
            }}>
              {feedback}
            </span>
          )}
        </div>

        {/* Start / End button */}
        {!gameActive ? (
          <button
            onClick={startGame}
            style={{
              width: '100%',
              padding: '14px',
              background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '2px',
              cursor: 'pointer',
              fontFamily: 'Orbitron, monospace',
            }}
          >
            {gameOver ? 'PLAY_AGAIN' : 'START_GAME'}
          </button>
        ) : (
          <button
            onClick={endGame}
            style={{
              width: '100%',
              padding: '14px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              color: '#6b7280',
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '2px',
              cursor: 'pointer',
              fontFamily: 'Orbitron, monospace',
            }}
          >
            END_GAME
          </button>
        )}

        {/* Game Over result */}
        {gameOver && (
          <div style={{ marginTop: '20px' }}>
            <div style={{
              padding: '16px',
              background: 'rgba(168,85,247,0.08)',
              border: '1px solid rgba(168,85,247,0.3)',
              borderRadius: '8px',
              textAlign: 'center',
              marginBottom: '10px',
            }}>
              <div style={{ color: '#a855f7', fontSize: '12px', letterSpacing: '2px', marginBottom: '4px' }}>GAME OVER</div>
              <div style={{ color: '#fff', fontSize: '36px', fontWeight: 900, lineHeight: 1 }}>{score}</div>
              <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px', marginTop: '2px' }}>POINTS</div>
              <div style={{ color: '#6b7280', fontSize: '11px', marginTop: '8px' }}>
                {score >= 200 ? 'LEGENDARY' : score >= 100 ? 'SKILLED' : score >= 350 ? 'DECENT' : 'KEEP PRACTICING'}
              </div>

              {/* Rank badge */}
              {myRank && (
                <div style={{
                  display: 'inline-block', marginTop: '10px', padding: '6px 18px',
                  background: myRank <= 3 ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${myRank <= 3 ? '#a855f7' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '20px',
                }}>
                  <span style={{ color: myRank <= 3 ? '#a855f7' : '#9ca3af', fontSize: '13px', fontWeight: 900 }}>
                    {myRank === 1 ? '🥇 GLOBAL #1' : myRank === 2 ? '🥈 GLOBAL #2' : myRank === 3 ? '🥉 GLOBAL #3' : `GLOBAL #${myRank}`}
                  </span>
                </div>
              )}

              {/* Near-miss */}
              {nextGap !== null && nextGap > 0 && myRank > 1 && (
                <div style={{
                  marginTop: '10px', padding: '7px 12px', borderRadius: '6px',
                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                }}>
                  <span style={{ color: '#ef4444', fontSize: '11px', fontWeight: 700 }}>
                    {nextGap === 1
                      ? `1 PT FROM #${myRank - 1} — SO CLOSE`
                      : `${nextGap} PTS FROM #${myRank - 1} — PLAY AGAIN`}
                  </span>
                </div>
              )}

              {/* Wager result */}
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
              <Link
                to="/leaderboard"
                style={{
                  flex: 1, display: 'block', padding: '11px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px', color: '#9ca3af',
                  fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
                  textDecoration: 'none', textAlign: 'center',
                  fontFamily: 'Orbitron, monospace',
                }}
              >
                LEADERBOARD
              </Link>
              <Link
                to="/"
                style={{
                  flex: 1, display: 'block', padding: '11px',
                  background: 'rgba(168,85,247,0.12)',
                  border: '1px solid rgba(168,85,247,0.4)',
                  borderRadius: '8px', color: '#a855f7',
                  fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
                  textDecoration: 'none', textAlign: 'center',
                  fontFamily: 'Orbitron, monospace',
                }}
              >
                🤖 CHALLENGE AI
              </Link>
            </div>
          </div>
        )}

        {/* Instructions (before first game) */}
        {!gameActive && !gameOver && (
          <div style={{ marginTop: '20px', color: '#4b5563', fontSize: '11px', lineHeight: '1.8', textAlign: 'center' }}>
            <div style={{ color: '#6b7280', marginBottom: '6px' }}>HOW TO PLAY</div>
            Tap the <span style={{ color: '#a855f7' }}>glowing button</span> as it lights up<br />
            Perfect (0–400ms) = 10 pts · Good (400–700ms) = 5 pts<br />
            <span style={{ color: '#4b5563' }}>Keys: 1–4 · Arrows · WASD</span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
