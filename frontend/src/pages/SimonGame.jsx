import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { toast } from 'react-hot-toast';
import { getDailySimonSequence, getPlayStreak, recordPlay, checkNewHighScores } from '../utils/gameUtils';

const BACKEND_URL = import.meta.env.VITE_GAMES_BACKEND_URL || 'http://localhost:3005';

const BASE_COLORS = [
  { id: 'red',    hex: '#ef4444', glow: 'rgba(239,68,68,0.8)',   freq: 261.63 },
  { id: 'blue',   hex: '#3b82f6', glow: 'rgba(59,130,246,0.8)',  freq: 329.63 },
  { id: 'green',  hex: '#10b981', glow: 'rgba(16,185,129,0.8)',  freq: 392.00 },
  { id: 'yellow', hex: '#eab308', glow: 'rgba(234,179,8,0.8)',   freq: 523.25 },
];

// 5th color unlocks at round 5
const BONUS_COLOR = { id: 'purple', hex: '#a855f7', glow: 'rgba(168,85,247,0.8)', freq: 659.25 };

const BASE_FLASH_DURATION = 500;
const BASE_SEQUENCE_DELAY = 700;
const MIN_FLASH_DURATION = 200;
const MIN_SEQUENCE_DELAY = 350;
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
  const [myRank, setMyRank]                       = useState(null);
  const [nextGap, setNextGap]                     = useState(null);
  const [roundFlash, setRoundFlash]               = useState(null);
  const [availableColors, setAvailableColors]     = useState(BASE_COLORS);
  const [bonusUnlocked, setBonusUnlocked]         = useState(false);
  const [isDailyMode, setIsDailyMode]             = useState(false);
  const [streak, setStreak]                       = useState({ streak: 0, playedToday: false });
  const [countdown, setCountdown]                 = useState(null);
  const [copied, setCopied]                       = useState(false);
  const dailySeqRef = useRef([]);

  useEffect(() => {
    if (address) getPlayStreak(address).then(setStreak);
  }, [address]);

  const audioCtxRef    = useRef(null);
  const startTimeRef   = useRef(0);
  const scoreRef       = useRef(0);
  const sequencesRef   = useRef(0);
  const patternRef     = useRef([]);
  const userPatternRef = useRef([]);
  const timeoutsRef    = useRef([]);
  const colorsRef      = useRef(BASE_COLORS);

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
  const playSuccess = useCallback(() => playTone(880, 0.15), [playTone]);

  // Dynamic timing based on round
  const getFlashDuration = (round) => Math.max(MIN_FLASH_DURATION, BASE_FLASH_DURATION - round * 30);
  const getSequenceDelay = (round) => Math.max(MIN_SEQUENCE_DELAY, BASE_SEQUENCE_DELAY - round * 35);

  const flashButton = useCallback((colorId, duration, onDone) => {
    const btn = [...BASE_COLORS, BONUS_COLOR].find(b => b.id === colorId);
    setActiveBtn(colorId);
    playTone(btn.freq);
    const t = setTimeout(() => {
      setActiveBtn(null);
      if (onDone) onDone();
    }, duration);
    timeoutsRef.current.push(t);
  }, [playTone]);

  const showSequence = useCallback((pattern, round) => {
    setIsShowingSequence(true);
    userPatternRef.current = [];
    const flashDur = getFlashDuration(round);
    const seqDelay = getSequenceDelay(round);

    pattern.forEach((colorId, i) => {
      const onT = setTimeout(() => {
        flashButton(colorId, flashDur, null);
      }, i * seqDelay);
      timeoutsRef.current.push(onT);
    });

    const doneT = setTimeout(() => {
      setIsShowingSequence(false);
    }, pattern.length * seqDelay + flashDur);
    timeoutsRef.current.push(doneT);
  }, [flashButton]);

  const addNext = useCallback((currentPattern) => {
    const colors = colorsRef.current;
    let next;
    if (isDailyMode && dailySeqRef.current.length > currentPattern.length) {
      next = dailySeqRef.current[currentPattern.length];
    } else {
      next = colors[Math.floor(Math.random() * colors.length)].id;
    }
    const newPattern = [...currentPattern, next];
    patternRef.current = newPattern;
    setGamePattern(newPattern);
    const round = newPattern.length;
    const t = setTimeout(() => showSequence(newPattern, round), 600);
    timeoutsRef.current.push(t);
  }, [showSequence, isDailyMode]);

  const saveScore = useCallback(async (finalScore, gameTime) => {
    try {
      const existing = JSON.parse(localStorage.getItem('simon_scores') || '[]');
      existing.push({ score: finalScore, date: Date.now() });
      existing.sort((a, b) => b.score - a.score);
      localStorage.setItem('simon_scores', JSON.stringify(existing.slice(0, 10)));
    } catch (_) {}

    if (!address) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/submit-score`, {
        method: 'POST',
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
      if (data.streak) {
        setStreak({ streak: data.streak, playedToday: true });
        if (data.streak >= 3) toast(`🔥 ${data.streak}-day streak!`, { icon: '🔥' });
      }
      if (data.rank) setMyRank(data.rank);
      const lb = await fetch(`${BACKEND_URL}/api/leaderboard?game=simon`).then(r => r.json());
      const above = lb.leaderboard?.[data.rank - 2];
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
    recordPlay();
    saveScore(finalScore, gameTime);
  }, [playWrong, saveScore]);

  // Poll for live score notifications
  useEffect(() => {
    const interval = setInterval(() => {
      checkNewHighScores(BACKEND_URL, (msg) => {
        toast(msg, { icon: '🎯', style: { background: '#1a1a2e', color: '#fff', border: '1px solid rgba(6,182,212,0.3)' } });
      });
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleButtonClick = useCallback((colorId) => {
    if (!gameActive || isShowingSequence || gameOver) return;

    const btn = [...BASE_COLORS, BONUS_COLOR].find(b => b.id === colorId);
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

      // Score: round number × base + speed bonus
      const elapsed    = Date.now() - startTimeRef.current;
      const speedBonus = Math.max(0, Math.floor((60000 - elapsed) / 1000));
      const roundBonus = newSeqs * 2; // higher rounds worth more
      const newScore   = newSeqs * BASE_SCORE + speedBonus + roundBonus;
      scoreRef.current = newScore;
      setScore(newScore);

      // Show round complete flash
      playSuccess();
      setRoundFlash(`ROUND ${newSeqs} CLEAR!`);
      setTimeout(() => setRoundFlash(null), 800);

      // Unlock 5th color at round 5
      if (newSeqs === 5 && !bonusUnlocked) {
        setBonusUnlocked(true);
        const newColors = [...BASE_COLORS, BONUS_COLOR];
        colorsRef.current = newColors;
        setAvailableColors(newColors);
        setRoundFlash('5TH COLOR UNLOCKED!');
        setTimeout(() => setRoundFlash(null), 1200);
      }

      const t = setTimeout(() => addNext(patternRef.current), 700);
      timeoutsRef.current.push(t);
    }
  }, [gameActive, isShowingSequence, gameOver, playTone, handleGameOver, addNext, bonusUnlocked]);

  const actualStart = () => {
    setCountdown(null);
    clearTimeouts();
    patternRef.current     = [];
    userPatternRef.current = [];
    sequencesRef.current   = 0;
    scoreRef.current       = 0;
    colorsRef.current      = BASE_COLORS;
    setAvailableColors(BASE_COLORS);
    setBonusUnlocked(false);
    setCopied(false);
    setGamePattern([]);
    setScore(0);
    setSequences(0);
    setGameOver(false);
    setGameActive(true);
    setIsShowingSequence(false);
    setActiveBtn(null);
    setMyRank(null);
    setNextGap(null);
    setRoundFlash(null);
    startTimeRef.current = Date.now();
    addNext([]);
  };

  const startGame = () => {
    setGameOver(false);
    setCountdown(3);
    playTone(523.25);
    setTimeout(() => { setCountdown(2); playTone(523.25); }, 1000);
    setTimeout(() => { setCountdown(1); playTone(523.25); }, 2000);
    setTimeout(() => { setCountdown('GO!'); playTone(659.25, 0.2); }, 3000);
    setTimeout(() => actualStart(), 3500);
  };

  // Difficulty indicator
  const difficultyLabel = sequences >= 10 ? 'INSANE' : sequences >= 7 ? 'HARD' : sequences >= 5 ? 'MEDIUM' : sequences >= 3 ? 'WARMING UP' : 'EASY';
  const difficultyColor = sequences >= 10 ? '#ef4444' : sequences >= 7 ? '#f59e0b' : sequences >= 5 ? '#eab308' : '#10b981';

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
          <Link to="/leaderboard" style={{
            color: '#a855f7', fontSize: '11px', fontFamily: 'Orbitron, monospace',
            letterSpacing: '1px', textDecoration: 'none',
            border: '1px solid rgba(168,85,247,0.3)', padding: '6px 12px', borderRadius: '4px',
          }}>
            SCORES
          </Link>
          <Link to="/" style={{
            color: '#6b7280', fontSize: '11px', fontFamily: 'Orbitron, monospace',
            letterSpacing: '1px', textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: '4px',
          }}>
            ← GAMES
          </Link>
        </div>
      </div>

      {/* Countdown overlay */}
      {countdown !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,5,15,0.85)',
        }}>
          <div style={{
            color: countdown === 'GO!' ? '#10b981' : '#06b6d4',
            fontSize: countdown === 'GO!' ? '72px' : '96px',
            fontWeight: 900, fontFamily: 'Orbitron, monospace',
            animation: 'countPop 0.8s ease',
            textShadow: `0 0 40px ${countdown === 'GO!' ? 'rgba(16,185,129,0.5)' : 'rgba(6,182,212,0.5)'}`,
          }}>
            {countdown}
          </div>
        </div>
      )}

      {/* Game Panel */}
      <div style={{
        background: 'rgba(10,10,20,0.8)',
        border: `1px solid rgba(6,182,212,${gameActive ? 0.4 : 0.2})`,
        borderRadius: '12px',
        padding: '28px',
        maxWidth: '400px',
        margin: '0 auto',
        transition: 'border 0.3s',
      }}>
        {/* Score + Round */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>SCORE</div>
            <div style={{ color: '#06b6d4', fontSize: '36px', fontWeight: 900, lineHeight: 1 }}>{score}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>ROUND</div>
            <div style={{ color: '#a855f7', fontSize: '36px', fontWeight: 900, lineHeight: 1 }}>{sequences}</div>
          </div>
        </div>

        {/* Difficulty + speed indicator */}
        {gameActive && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '12px', padding: '4px 10px',
            background: 'rgba(255,255,255,0.03)', borderRadius: '4px',
          }}>
            <span style={{ color: difficultyColor, fontSize: '9px', fontWeight: 700, letterSpacing: '1px' }}>
              {difficultyLabel}
            </span>
            <span style={{ color: '#6b7280', fontSize: '9px' }}>
              Flash: {getFlashDuration(sequences)}ms
            </span>
            {bonusUnlocked && (
              <span style={{ color: '#a855f7', fontSize: '9px', fontWeight: 700 }}>
                5 COLORS
              </span>
            )}
          </div>
        )}

        {/* Round flash */}
        {roundFlash && (
          <div style={{
            textAlign: 'center', marginBottom: '12px',
            animation: 'roundPop 0.8s ease forwards',
          }}>
            <span style={{
              color: bonusUnlocked && roundFlash.includes('UNLOCK') ? '#a855f7' : '#10b981',
              fontSize: '16px', fontWeight: 900,
              textShadow: '0 0 12px rgba(16,185,129,0.4)',
              letterSpacing: '2px',
            }}>
              {roundFlash}
            </span>
          </div>
        )}

        {/* Status text */}
        {!roundFlash && (
          <div style={{ textAlign: 'center', height: '24px', marginBottom: '16px' }}>
            <span style={{
              fontSize: '12px', letterSpacing: '2px', fontWeight: 700,
              color: isShowingSequence ? '#eab308' : gameActive ? '#10b981' : '#6b7280',
            }}>
              {isShowingSequence
                ? 'WATCH...'
                : gameActive
                  ? 'YOUR TURN'
                  : gameOver ? 'GAME OVER' : 'WATCH & REPEAT'}
            </span>
          </div>
        )}

        {/* Buttons — 2x2 grid (or 2x3 with bonus) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: bonusUnlocked ? '1fr 1fr 1fr' : '1fr 1fr',
          gap: '14px',
          marginBottom: '24px',
        }}>
          {availableColors.map((btn) => {
            const isActive = activeBtn === btn.id;
            return (
              <button key={btn.id} onClick={() => handleButtonClick(btn.id)}
                disabled={!gameActive || isShowingSequence || gameOver}
                style={{
                  aspectRatio: '1', borderRadius: bonusUnlocked ? '12px' : '16px',
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

        {/* Pattern progress dots */}
        {gameActive && !isShowingSequence && patternRef.current.length > 0 && (
          <div style={{
            display: 'flex', justifyContent: 'center', gap: '4px',
            marginBottom: '16px', flexWrap: 'wrap',
          }}>
            {patternRef.current.map((colorId, i) => {
              const btn = [...BASE_COLORS, BONUS_COLOR].find(b => b.id === colorId);
              const done = i < userPatternRef.current.length;
              return (
                <div key={i} style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: done ? btn.hex : 'rgba(255,255,255,0.1)',
                  transition: 'background 0.2s',
                }} />
              );
            })}
          </div>
        )}

        {/* Start */}
        {!gameActive && !gameOver && (
          <>
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

            <button onClick={() => { setIsDailyMode(false); startGame(); }}
              style={{
                width: '100%', padding: '14px',
                background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
                border: 'none', borderRadius: '8px', color: '#fff',
                fontSize: '14px', fontWeight: 700, letterSpacing: '2px',
                cursor: 'pointer', fontFamily: 'Orbitron, monospace',
              }}
            >
              START_GAME
            </button>

            {/* Daily challenge */}
            <button
              onClick={() => {
                setIsDailyMode(true);
                dailySeqRef.current = getDailySimonSequence(BASE_COLORS, 20);
                startGame();
              }}
              style={{
                width: '100%', padding: '12px', marginTop: '8px',
                background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.15))',
                border: '1px solid rgba(245,158,11,0.4)',
                borderRadius: '8px', color: '#f59e0b',
                fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
                cursor: 'pointer', fontFamily: 'Orbitron, monospace',
              }}
            >
              DAILY CHALLENGE — same pattern for everyone
            </button>

            <div style={{ marginTop: '16px', color: '#4b5563', fontSize: '11px', lineHeight: '1.8', textAlign: 'center' }}>
              <div style={{ color: '#6b7280', marginBottom: '6px' }}>HOW TO PLAY</div>
              Watch the sequence flash · Repeat it in order<br />
              <span style={{ color: '#eab308' }}>Speed increases each round</span><br />
              <span style={{ color: '#a855f7' }}>5th color unlocks at round 5</span><br />
              Score = Rounds × 10 + Speed Bonus
            </div>
          </>
        )}

        {/* Game Over */}
        {gameOver && (
          <div style={{
            background: 'rgba(6,182,212,0.08)',
            border: '1px solid rgba(6,182,212,0.3)',
            borderRadius: '8px', padding: '20px',
            textAlign: 'center', marginBottom: '16px',
          }}>
            {(() => {
              const grade = sequences >= 10 ? 'S' : sequences >= 7 ? 'A' : sequences >= 5 ? 'B' : sequences >= 3 ? 'C' : 'D';
              const gradeColor = { S: '#f59e0b', A: '#10b981', B: '#06b6d4', C: '#a855f7', D: '#6b7280' }[grade];
              const gradeLabel = { S: 'LEGENDARY', A: 'SKILLED', B: 'SOLID', C: 'DECENT', D: 'KEEP GOING' }[grade];
              return (
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
                    <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '2px' }}>{sequences} rounds · {difficultyLabel}</div>
                  </div>
                </div>
              );
            })()}

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
                  #{myRank}
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

          </div>
        )}

        {gameOver && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={startGame}
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
              <button
                onClick={() => {
                  const grade = sequences >= 10 ? 'S' : sequences >= 7 ? 'A' : sequences >= 5 ? 'B' : sequences >= 3 ? 'C' : 'D';
                  const text = `🧠 GameArena — Simon Memory\n🎯 Score: ${score} | Grade: ${grade} | ${sequences} Rounds\n${bonusUnlocked ? '🟣 5th color unlocked!' : ''}\n\nPlay now: ${window.location.origin}`;
                  navigator.clipboard.writeText(text).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
                style={{
                  flex: 1, padding: '12px',
                  background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(168,85,247,0.15)',
                  border: `1px solid ${copied ? 'rgba(16,185,129,0.4)' : 'rgba(168,85,247,0.3)'}`,
                  borderRadius: '8px', color: copied ? '#10b981' : '#a855f7',
                  fontSize: '13px', fontWeight: 700, letterSpacing: '1px',
                  cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                }}
              >
                {copied ? 'COPIED!' : 'SHARE'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Link to="/leaderboard" style={{
                flex: 1, padding: '10px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px', color: '#9ca3af',
                fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
                fontFamily: 'Orbitron, monospace', textDecoration: 'none',
                textAlign: 'center',
              }}>
                SCORES
              </Link>
              <Link to="/" style={{
                flex: 1, padding: '10px',
                background: 'rgba(168,85,247,0.08)',
                border: '1px solid rgba(168,85,247,0.25)',
                borderRadius: '8px', color: '#a855f7',
                fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
                textDecoration: 'none', textAlign: 'center',
                fontFamily: 'Orbitron, monospace',
              }}>
                CHALLENGE AI
              </Link>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes countPop {
          0% { opacity: 0; transform: scale(2); }
          30% { opacity: 1; transform: scale(0.9); }
          50% { transform: scale(1.05); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes roundPop {
          0% { opacity: 0; transform: scale(0.7); }
          40% { opacity: 1; transform: scale(1.15); }
          100% { opacity: 0; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
