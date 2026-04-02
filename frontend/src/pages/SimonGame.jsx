import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAccount } from 'wagmi';

const BACKEND_URL = import.meta.env.VITE_GAMES_BACKEND_URL || 'http://localhost:3005';

const BUTTON_COLORS = [
  { id: 'red',    hex: '#ef4444', glow: 'rgba(239,68,68,0.8)',   freq: 261.63 },
  { id: 'blue',   hex: '#3b82f6', glow: 'rgba(59,130,246,0.8)',  freq: 329.63 },
  { id: 'green',  hex: '#10b981', glow: 'rgba(16,185,129,0.8)',  freq: 392.00 },
  { id: 'yellow', hex: '#eab308', glow: 'rgba(234,179,8,0.8)',   freq: 523.25 },
];

const FLASH_DURATION = 400;
const SEQUENCE_DELAY = 700;
const BASE_SCORE = 10;

export default function SimonGame() {
  const { address } = useAccount();
  const { state }   = useLocation();
  const wagerInfo   = state?.wager ? state : null;
  const [gamePattern, setGamePattern]             = useState([]);
  const [score, setScore]                         = useState(0);
  const [sequences, setSequences]                 = useState(0);
  const [gameActive, setGameActive]               = useState(false);
  const [isShowingSequence, setIsShowingSequence] = useState(false);
  const [gameOver, setGameOver]                   = useState(false);
  const [activeBtn, setActiveBtn]                 = useState(null);
  const [myRank,    setMyRank]                    = useState(null);
  const [nextGap,   setNextGap]                   = useState(null);

  const audioCtxRef    = useRef(null);
  const startTimeRef   = useRef(0);
  const scoreRef       = useRef(0);
  const sequencesRef   = useRef(0);
  const patternRef     = useRef([]);
  const userPatternRef = useRef([]);
  const timeoutsRef    = useRef([]);

  const clearTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  useEffect(() => () => clearTimeouts(), []);

  const playTone = useCallback((freq, duration = 0.3) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  }, []);

  const playWrong = useCallback(() => playTone(100, 0.4), [playTone]);

  const flashButton = useCallback((colorId, onDone) => {
    const btn = BUTTON_COLORS.find(b => b.id === colorId);
    setActiveBtn(colorId);
    playTone(btn.freq);
    const t = setTimeout(() => {
      setActiveBtn(null);
      if (onDone) onDone();
    }, FLASH_DURATION);
    timeoutsRef.current.push(t);
  }, [playTone]);

  const showSequence = useCallback((pattern) => {
    setIsShowingSequence(true);
    userPatternRef.current = [];

    pattern.forEach((colorId, i) => {
      const onT = setTimeout(() => {
        flashButton(colorId, null);
      }, i * SEQUENCE_DELAY);
      timeoutsRef.current.push(onT);
    });

    const doneT = setTimeout(() => {
      setIsShowingSequence(false);
    }, pattern.length * SEQUENCE_DELAY + FLASH_DURATION);
    timeoutsRef.current.push(doneT);
  }, [flashButton]);

  const addNext = useCallback((currentPattern) => {
    const next = BUTTON_COLORS[Math.floor(Math.random() * BUTTON_COLORS.length)].id;
    const newPattern = [...currentPattern, next];
    patternRef.current = newPattern;
    setGamePattern(newPattern);
    const t = setTimeout(() => showSequence(newPattern), 600);
    timeoutsRef.current.push(t);
  }, [showSequence]);

  const saveScore = useCallback(async (finalScore, gameTime) => {
    try {
      const existing = JSON.parse(localStorage.getItem('simon_scores') || '[]');
      existing.push({ score: finalScore, date: Date.now() });
      existing.sort((a, b) => b.score - a.score);
      localStorage.setItem('simon_scores', JSON.stringify(existing.slice(0, 10)));
    } catch (_) {}

    if (!address) return;
    try {
      const res  = await fetch(`${BACKEND_URL}/api/submit-score`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerAddress: address,
          scoreData: {
            game: 'simon', score: finalScore, gameTime,
            wagered: wagerInfo?.amount || null,
            wagerId: wagerInfo?.wagerId || null,
          },
        }),
      });
      const data = await res.json();
      if (data.rank) setMyRank(data.rank);

      // Compute gap to the rank above
      const lb = await fetch(`${BACKEND_URL}/api/leaderboard?game=simon`).then(r => r.json());
      const above = lb.leaderboard?.[data.rank - 2]; // rank - 2 = index of player one above
      if (above && above.score > finalScore) setNextGap({ pts: above.score - finalScore, rank: data.rank - 1 });
    } catch (_) {}
  }, [address]);

  const handleGameOver = useCallback((finalScore, finalSeqs, gameTime) => {
    playWrong();
    setGameOver(true);
    setGameActive(false);
    setIsShowingSequence(false);
    setActiveBtn(null);
    clearTimeouts();
    saveScore(finalScore, gameTime);
  }, [playWrong, saveScore]);

  const handleButtonClick = useCallback((colorId) => {
    if (!gameActive || isShowingSequence || gameOver) return;

    const btn = BUTTON_COLORS.find(b => b.id === colorId);
    playTone(btn.freq);
    setActiveBtn(colorId);
    setTimeout(() => setActiveBtn(null), 150);

    const newUserPattern = [...userPatternRef.current, colorId];
    userPatternRef.current = newUserPattern;
    const idx = newUserPattern.length - 1;

    if (patternRef.current[idx] !== colorId) {
      handleGameOver(scoreRef.current, sequencesRef.current, Date.now() - startTimeRef.current);
      return;
    }

    if (newUserPattern.length === patternRef.current.length) {
      const newSeqs = sequencesRef.current + 1;
      sequencesRef.current = newSeqs;
      setSequences(newSeqs);

      const elapsed     = Date.now() - startTimeRef.current;
      const speedBonus  = Math.max(0, Math.floor((60000 - elapsed) / 1000));
      const newScore    = newSeqs * BASE_SCORE + speedBonus;
      scoreRef.current  = newScore;
      setScore(newScore);

      const t = setTimeout(() => addNext(patternRef.current), 500);
      timeoutsRef.current.push(t);
    }
  }, [gameActive, isShowingSequence, gameOver, playTone, handleGameOver, addNext]);

  const startGame = () => {
    clearTimeouts();
    patternRef.current     = [];
    userPatternRef.current = [];
    sequencesRef.current   = 0;
    scoreRef.current       = 0;
    setGamePattern([]);
    setScore(0);
    setSequences(0);
    setGameOver(false);
    setGameActive(true);
    setIsShowingSequence(false);
    setActiveBtn(null);
    setMyRank(null);
    setNextGap(null);
    startTimeRef.current = Date.now();
    addNext([]);
  };

  return (
    <div style={{ fontFamily: 'Orbitron, monospace' }}>
      {/* Wager banner */}
      {wagerInfo && (
        <div style={{
          marginBottom: '16px', padding: '10px 16px',
          background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.4)',
          borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ color: '#06b6d4', fontSize: '11px', fontWeight: 700, letterSpacing: '1px' }}>
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
          <h1 style={{ color: '#06b6d4', fontSize: '22px', fontWeight: 900, letterSpacing: '2px', margin: 0 }}>
            SIMON_MEMORY
          </h1>
          <p style={{ color: '#6b7280', fontSize: '11px', letterSpacing: '1px', marginTop: '4px' }}>
            {wagerInfo ? `WAGER MODE — complete ${wagerInfo.winAt} to win` : 'FREE PLAY — no wager required'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link
            to="/leaderboard"
            style={{
              color: '#a855f7',
              fontSize: '11px',
              fontFamily: 'Orbitron, monospace',
              letterSpacing: '1px',
              textDecoration: 'none',
              border: '1px solid rgba(168,85,247,0.3)',
              padding: '6px 12px',
              borderRadius: '4px',
            }}
          >
            SCORES
          </Link>
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
      </div>

      {/* Game Panel */}
      <div style={{
        background: 'rgba(10,10,20,0.8)',
        border: '1px solid rgba(6,182,212,0.2)',
        borderRadius: '12px',
        padding: '28px',
        maxWidth: '400px',
        margin: '0 auto',
      }}>
        {/* Score row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>SCORE</div>
            <div style={{ color: '#06b6d4', fontSize: '42px', fontWeight: 900, lineHeight: 1 }}>{score}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>ROUND</div>
            <div style={{ color: '#a855f7', fontSize: '42px', fontWeight: 900, lineHeight: 1 }}>{sequences}</div>
          </div>
        </div>

        {/* Status text */}
        <div style={{ textAlign: 'center', height: '24px', marginBottom: '20px' }}>
          <span style={{
            fontSize: '12px',
            letterSpacing: '2px',
            color: isShowingSequence ? '#eab308' : gameActive ? '#10b981' : '#6b7280',
            fontWeight: 700,
          }}>
            {isShowingSequence
              ? 'WATCH THE SEQUENCE...'
              : gameActive
                ? 'YOUR TURN — REPEAT IT'
                : gameOver
                  ? 'GAME OVER'
                  : 'WATCH & REPEAT THE PATTERN'}
          </span>
        </div>

        {/* Buttons — 2x2 grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '24px' }}>
          {BUTTON_COLORS.map((btn) => {
            const isActive = activeBtn === btn.id;
            return (
              <button
                key={btn.id}
                onClick={() => handleButtonClick(btn.id)}
                disabled={!gameActive || isShowingSequence || gameOver}
                style={{
                  aspectRatio: '1',
                  borderRadius: '16px',
                  border: `3px solid ${isActive ? btn.hex : 'rgba(255,255,255,0.08)'}`,
                  background: isActive ? `${btn.hex}55` : `${btn.hex}18`,
                  cursor: gameActive && !isShowingSequence && !gameOver ? 'pointer' : 'default',
                  boxShadow: isActive ? `0 0 32px ${btn.glow}` : 'none',
                  transform: isActive ? 'scale(1.08)' : 'scale(1)',
                  transition: 'all 0.12s ease',
                  opacity: !gameActive && !isActive ? 0.4 : 1,
                }}
              />
            );
          })}
        </div>

        {/* Start / Game Over */}
        {!gameActive && !gameOver && (
          <>
            <button
              onClick={startGame}
              style={{
                width: '100%',
                padding: '14px',
                background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
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
              START_GAME
            </button>
            <div style={{ marginTop: '20px', color: '#4b5563', fontSize: '11px', lineHeight: '1.8', textAlign: 'center' }}>
              <div style={{ color: '#6b7280', marginBottom: '6px' }}>HOW TO PLAY</div>
              Watch the sequence flash · Repeat it in order<br />
              Sequence gets longer each round<br />
              <span style={{ color: '#eab308' }}>Score = Rounds × 10 + Speed Bonus</span>
            </div>
          </>
        )}

        {gameOver && (
          <div style={{
            background: 'rgba(6,182,212,0.08)',
            border: '1px solid rgba(6,182,212,0.3)',
            borderRadius: '8px',
            padding: '20px',
            textAlign: 'center',
            marginBottom: '16px',
          }}>
            <div style={{ color: '#06b6d4', fontSize: '12px', letterSpacing: '2px', marginBottom: '4px' }}>FINAL SCORE</div>
            <div style={{ color: '#fff', fontSize: '36px', fontWeight: 900 }}>{score} pts</div>
            <div style={{ color: '#6b7280', fontSize: '11px', marginTop: '4px' }}>
              {sequences} sequences completed
            </div>
            {wagerInfo && (
              <div style={{
                marginTop: '12px', padding: '8px 12px', borderRadius: '6px',
                background: sequences >= 7 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                border: `1px solid ${sequences >= 7 ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
              }}>
                {sequences >= 7
                  ? <span style={{ color: '#10b981', fontWeight: 700, fontSize: '13px' }}>
                      WON — {(parseFloat(wagerInfo.amount) * 1.3).toFixed(1)} G$ incoming
                    </span>
                  : <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '13px' }}>
                      LOST — {wagerInfo.amount} G$ wagered
                    </span>
                }
              </div>
            )}
            {myRank && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                marginTop: '10px', padding: '4px 14px', borderRadius: '20px',
                background: myRank === 1 ? 'rgba(245,158,11,0.15)' : 'rgba(6,182,212,0.12)',
                border: `1px solid ${myRank === 1 ? 'rgba(245,158,11,0.5)' : 'rgba(6,182,212,0.4)'}`,
              }}>
                <span style={{ fontSize: '16px' }}>
                  {myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : '🏅'}
                </span>
                <span style={{ color: myRank === 1 ? '#f59e0b' : '#06b6d4', fontSize: '11px', fontWeight: 900 }}>
                  GLOBAL RANK #{myRank}
                </span>
              </div>
            )}
            {nextGap && (
              <div style={{
                marginTop: '8px', padding: '6px 12px', borderRadius: '8px',
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              }}>
                <span style={{ color: '#f87171', fontSize: '10px', fontWeight: 700 }}>
                  {nextGap.pts} PTS FROM #{nextGap.rank} — PLAY AGAIN
                </span>
              </div>
            )}
            <div style={{ color: '#a855f7', fontSize: '11px', marginTop: '8px' }}>
              {score >= 200 ? 'LEGENDARY' : score >= 100 ? 'SKILLED' : score >= 50 ? 'DECENT' : 'KEEP TRAINING'}
            </div>
          </div>
        )}

        {gameOver && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={startGame}
                style={{
                  flex: 1, padding: '12px',
                  background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
                  border: 'none', borderRadius: '8px', color: '#fff',
                  fontSize: '13px', fontWeight: 700, letterSpacing: '1px',
                  cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                }}
              >
                PLAY_AGAIN
              </button>
              <Link to="/leaderboard" style={{
                flex: 1, padding: '12px',
                background: 'rgba(168,85,247,0.15)',
                border: '1px solid rgba(168,85,247,0.3)',
                borderRadius: '8px', color: '#a855f7',
                fontSize: '13px', fontWeight: 700, letterSpacing: '1px',
                fontFamily: 'Orbitron, monospace', textDecoration: 'none',
                textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                SCORES
              </Link>
            </div>
            <Link to="/" style={{
              display: 'block', padding: '12px',
              background: 'rgba(168,85,247,0.08)',
              border: '1px solid rgba(168,85,247,0.35)',
              borderRadius: '8px', color: '#a855f7',
              fontSize: '12px', fontWeight: 700, letterSpacing: '2px',
              textDecoration: 'none', textAlign: 'center',
              fontFamily: 'Orbitron, monospace',
            }}>
              🤖 CHALLENGE THE AI AGENT
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
