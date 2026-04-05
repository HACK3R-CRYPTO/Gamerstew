'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { submitScore } from '@/app/actions/game';

const BASE_COLORS = [
  { id: 'red',    hex: '#ef4444', glow: 'rgba(239,68,68,0.8)',   freq: 261.63 },
  { id: 'blue',   hex: '#3b82f6', glow: 'rgba(59,130,246,0.8)',  freq: 329.63 },
  { id: 'green',  hex: '#10b981', glow: 'rgba(16,185,129,0.8)',  freq: 392.00 },
  { id: 'yellow', hex: '#eab308', glow: 'rgba(234,179,8,0.8)',   freq: 523.25 },
];
const BONUS_COLOR = { id: 'purple', hex: '#a855f7', glow: 'rgba(168,85,247,0.8)', freq: 659.25 };
const ALL_COLORS  = [...BASE_COLORS, BONUS_COLOR];

const BASE_FLASH    = 500;
const BASE_DELAY    = 700;
const MIN_FLASH     = 200;
const MIN_DELAY     = 350;
const BASE_SCORE    = 10;

type Color = typeof BASE_COLORS[0];

export default function SimonGame() {
  const { user, getAccessToken, authenticated } = usePrivy();
  const router  = useRouter();
  const address = (user?.linkedAccounts?.find((a: { type: string }) => a.type === 'wallet') as { type: string; address: string } | undefined)?.address;

  const [gamePattern, setGamePattern]           = useState<string[]>([]);
  const [score, setScore]                       = useState(0);
  const [sequences, setSequences]               = useState(0);
  const [gameActive, setGameActive]             = useState(false);
  const [isShowingSequence, setIsShowingSequence] = useState(false);
  const [gameOver, setGameOver]                 = useState(false);
  const [activeBtn, setActiveBtn]               = useState<string | null>(null);
  const [myRank, setMyRank]                     = useState<number | null>(null);
  const [roundFlash, setRoundFlash]             = useState<string | null>(null);
  const [availableColors, setAvailableColors]   = useState<Color[]>(BASE_COLORS);
  const [bonusUnlocked, setBonusUnlocked]       = useState(false);
  const [countdown, setCountdown]               = useState<number | string | null>(null);
  const [submitting, setSubmitting]             = useState(false);
  const [streak, setStreak]                     = useState<number | null>(null);
  const [gameTimeMs, setGameTimeMs]             = useState(0);

  const audioCtxRef    = useRef<AudioContext | null>(null);
  const startTimeRef   = useRef(0);
  const scoreRef       = useRef(0);
  const sequencesRef   = useRef(0);
  const patternRef     = useRef<string[]>([]);
  const userPatternRef = useRef<string[]>([]);
  const timeoutsRef    = useRef<ReturnType<typeof setTimeout>[]>([]);
  const colorsRef      = useRef<Color[]>(BASE_COLORS);

  const clearTimeouts = () => { timeoutsRef.current.forEach(clearTimeout); timeoutsRef.current = []; };
  useEffect(() => () => clearTimeouts(), []);

  const playTone = useCallback((freq: number, dur = 0.3) => {
    try {
      if (!audioCtxRef.current)
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const ctx  = audioCtxRef.current;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = 'sine';
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
    } catch (_) {}
  }, []);

  const playWrong   = useCallback(() => playTone(100, 0.4), [playTone]);
  const playSuccess = useCallback(() => playTone(880, 0.15), [playTone]);

  const getFlashDur  = (r: number) => Math.max(MIN_FLASH, BASE_FLASH - r * 30);
  const getSeqDelay  = (r: number) => Math.max(MIN_DELAY, BASE_DELAY - r * 35);

  const flashButton = useCallback((colorId: string, duration: number, onDone: (() => void) | null) => {
    const btn = ALL_COLORS.find(b => b.id === colorId)!;
    setActiveBtn(colorId); playTone(btn.freq);
    const t = setTimeout(() => { setActiveBtn(null); onDone?.(); }, duration);
    timeoutsRef.current.push(t);
  }, [playTone]);

  const showSequence = useCallback((pattern: string[], round: number) => {
    setIsShowingSequence(true);
    userPatternRef.current = [];
    const flashDur = getFlashDur(round);
    const seqDelay = getSeqDelay(round);
    pattern.forEach((colorId, i) => {
      const t = setTimeout(() => flashButton(colorId, flashDur, null), i * seqDelay);
      timeoutsRef.current.push(t);
    });
    const done = setTimeout(() => setIsShowingSequence(false), pattern.length * seqDelay + flashDur);
    timeoutsRef.current.push(done);
  }, [flashButton]);

  const addNext = useCallback((current: string[]) => {
    const colors = colorsRef.current;
    const next   = colors[Math.floor(Math.random() * colors.length)].id;
    const newPat = [...current, next];
    patternRef.current = newPat;
    setGamePattern(newPat);
    const t = setTimeout(() => showSequence(newPat, newPat.length), 600);
    timeoutsRef.current.push(t);
  }, [showSequence]);

  const handleGameOver = useCallback(async (finalScore: number, gameTime: number) => {
    playWrong();
    setGameOver(true); setGameActive(false);
    setIsShowingSequence(false); setActiveBtn(null);
    setGameTimeMs(gameTime);
    clearTimeouts();
    if (!address || !authenticated) return;
    setSubmitting(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const result = await submitScore(token, address, {
        game: 'simon', score: finalScore, gameTime,
      });
      if (result.success) {
        if (result.rank) setMyRank(result.rank);
        if (result.streak) setStreak(result.streak);
      }
    } catch (_) {
    } finally {
      setSubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, authenticated, playWrong]);

  const handleButtonClick = useCallback((colorId: string) => {
    if (!gameActive || isShowingSequence || gameOver) return;
    const btn = ALL_COLORS.find(b => b.id === colorId)!;
    playTone(btn.freq);
    setActiveBtn(colorId);
    setTimeout(() => setActiveBtn(null), 150);

    const newUserPat = [...userPatternRef.current, colorId];
    userPatternRef.current = newUserPat;
    const idx = newUserPat.length - 1;

    if (patternRef.current[idx] !== colorId) {
      handleGameOver(scoreRef.current, Date.now() - startTimeRef.current);
      return;
    }

    if (newUserPat.length === patternRef.current.length) {
      const newSeqs   = sequencesRef.current + 1;
      sequencesRef.current = newSeqs; setSequences(newSeqs);
      const elapsed    = Date.now() - startTimeRef.current;
      const speedBonus = Math.max(0, Math.floor((60000 - elapsed) / 1000));
      const roundBonus = newSeqs * 2;
      const newScore   = newSeqs * BASE_SCORE + speedBonus + roundBonus;
      scoreRef.current = newScore; setScore(newScore);

      playSuccess();
      setRoundFlash(`ROUND ${newSeqs} CLEAR!`);
      setTimeout(() => setRoundFlash(null), 800);

      if (newSeqs === 5 && !bonusUnlocked) {
        setBonusUnlocked(true);
        const newColors = [...BASE_COLORS, BONUS_COLOR];
        colorsRef.current = newColors; setAvailableColors(newColors);
        setRoundFlash('5TH COLOR UNLOCKED!');
        setTimeout(() => setRoundFlash(null), 1200);
      }

      const t = setTimeout(() => addNext(patternRef.current), 700);
      timeoutsRef.current.push(t);
    }
  }, [gameActive, isShowingSequence, gameOver, playTone, handleGameOver, addNext, bonusUnlocked, playSuccess]);

  const actualStart = useCallback(() => {
    setCountdown(null); clearTimeouts();
    patternRef.current = []; userPatternRef.current = [];
    sequencesRef.current = 0; scoreRef.current = 0;
    colorsRef.current = BASE_COLORS;
    setAvailableColors(BASE_COLORS); setBonusUnlocked(false);
    setGamePattern([]); setScore(0); setSequences(0);
    setGameOver(false); setGameActive(true);
    setIsShowingSequence(false); setActiveBtn(null);
    setMyRank(null); setRoundFlash(null); setStreak(null); setGameTimeMs(0);
    startTimeRef.current = Date.now();
    addNext([]);
  }, [addNext]);

  const startGame = () => {
    setGameOver(false); setCountdown(3); playTone(523.25);
    setTimeout(() => { setCountdown(2); playTone(523.25); }, 1000);
    setTimeout(() => { setCountdown(1); playTone(523.25); }, 2000);
    setTimeout(() => { setCountdown('GO!'); playTone(659.25, 0.2); }, 3000);
    setTimeout(() => actualStart(), 3500);
  };

  const diffLabel = sequences >= 10 ? 'INSANE' : sequences >= 7 ? 'HARD' : sequences >= 5 ? 'MEDIUM' : sequences >= 3 ? 'WARMING UP' : 'EASY';
  const diffColor = sequences >= 10 ? '#ef4444' : sequences >= 7 ? '#f59e0b' : sequences >= 5 ? '#eab308' : '#10b981';

  return (
    <div style={{ fontFamily: 'Orbitron, monospace', padding: '24px', maxWidth: '440px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ color: '#06b6d4', fontSize: '22px', fontWeight: 900, letterSpacing: '2px', margin: 0 }}>SIMON_MEMORY</h1>
          <p style={{ color: '#6b7280', fontSize: '11px', margin: '4px 0 0' }}>watch · remember · repeat</p>
        </div>
        <button onClick={() => router.push('/')} style={{ color: '#6b7280', fontSize: '11px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>
          ← BACK
        </button>
      </div>

      {/* Countdown */}
      {countdown !== null && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,5,15,0.85)' }}>
          <div style={{ color: countdown === 'GO!' ? '#10b981' : '#06b6d4', fontSize: countdown === 'GO!' ? '72px' : '96px', fontWeight: 900 }}>{countdown}</div>
        </div>
      )}

      <div style={{ background: 'rgba(10,10,20,0.8)', border: `1px solid rgba(6,182,212,${gameActive ? 0.4 : 0.2})`, borderRadius: '12px', padding: '28px' }}>
        {/* Score + round */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px' }}>SCORE</div>
            <div style={{ color: '#06b6d4', fontSize: '36px', fontWeight: 900 }}>{score}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px' }}>ROUND</div>
            <div style={{ color: '#a855f7', fontSize: '36px', fontWeight: 900 }}>{sequences}</div>
          </div>
        </div>

        {/* Difficulty */}
        {gameActive && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '9px' }}>
            <span style={{ color: diffColor, fontWeight: 700 }}>{diffLabel}</span>
            <span style={{ color: '#6b7280' }}>Flash: {getFlashDur(sequences)}ms</span>
            {bonusUnlocked && <span style={{ color: '#a855f7', fontWeight: 700 }}>5 COLORS</span>}
          </div>
        )}

        {/* Round flash */}
        {roundFlash && (
          <div style={{ textAlign: 'center', marginBottom: '12px' }}>
            <span style={{ color: '#10b981', fontSize: '16px', fontWeight: 900, letterSpacing: '2px' }}>{roundFlash}</span>
          </div>
        )}

        {/* Status */}
        {!roundFlash && (
          <div style={{ textAlign: 'center', height: '24px', marginBottom: '16px' }}>
            <span style={{ fontSize: '12px', letterSpacing: '2px', fontWeight: 700, color: isShowingSequence ? '#eab308' : gameActive ? '#10b981' : '#6b7280' }}>
              {isShowingSequence ? 'WATCH...' : gameActive ? 'YOUR TURN' : gameOver ? 'GAME OVER' : 'WATCH & REPEAT'}
            </span>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: bonusUnlocked ? '1fr 1fr 1fr' : '1fr 1fr', gap: '14px', marginBottom: '24px' }}>
          {availableColors.map(btn => {
            const isActive = activeBtn === btn.id;
            return (
              <button key={btn.id}
                onPointerDown={e => { e.preventDefault(); handleButtonClick(btn.id); }}
                disabled={!gameActive || isShowingSequence || gameOver}
                style={{
                  aspectRatio: '1', borderRadius: bonusUnlocked ? '12px' : '16px',
                  border: `3px solid ${isActive ? btn.hex : 'rgba(255,255,255,0.08)'}`,
                  background: isActive ? `${btn.hex}55` : `${btn.hex}18`,
                  boxShadow: isActive ? `0 0 32px ${btn.glow}` : 'none',
                  transform: isActive ? 'scale(1.08)' : 'scale(1)',
                  transition: 'all 0.12s ease', minHeight: '80px',
                  cursor: gameActive && !isShowingSequence ? 'pointer' : 'default',
                }}
              />
            );
          })}
        </div>

        {/* Quit button */}
        {gameActive && !gameOver && (
          <button onClick={() => handleGameOver(scoreRef.current, Date.now() - startTimeRef.current)} style={{ width: '100%', padding: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '8px', color: '#ef4444', fontSize: '12px', fontWeight: 700, letterSpacing: '2px', cursor: 'pointer', marginBottom: '8px' }}>
            END GAME
          </button>
        )}

        {/* Pattern dots */}
        {gameActive && !isShowingSequence && patternRef.current.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {patternRef.current.map((colorId, i) => {
              const c = ALL_COLORS.find(b => b.id === colorId)!;
              return <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: i < userPatternRef.current.length ? c.hex : 'rgba(255,255,255,0.1)' }} />;
            })}
          </div>
        )}

        {/* Start */}
        {!gameActive && !gameOver && (
          <button onClick={startGame} style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 700, letterSpacing: '2px', cursor: 'pointer' }}>
            START_GAME
          </button>
        )}

        {/* Game over overlay */}
        {gameOver && (() => {
          const grade = sequences >= 10 ? 'S' : sequences >= 7 ? 'A' : sequences >= 5 ? 'B' : sequences >= 3 ? 'C' : 'D';
          const gradeColor: Record<string, string> = { S: '#f59e0b', A: '#10b981', B: '#06b6d4', C: '#a855f7', D: '#6b7280' };
          const gradeLabel: Record<string, string> = { S: 'LEGENDARY', A: 'SKILLED', B: 'SOLID', C: 'DECENT', D: 'KEEP GOING' };
          return (
            <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(5,5,15,0.6)', animation: 'fadeIn 0.2s ease' }}>
              <div style={{ background: '#0a0a1a', borderTop: `2px solid ${gradeColor[grade]}40`, borderRadius: '24px 24px 0 0', padding: '32px 24px 40px', animation: 'slideUp 0.4s cubic-bezier(0.34,1.2,0.64,1)' }}>

                {/* Title */}
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                  <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '3px', marginBottom: '4px' }}>SIMON_MEMORY · RESULT</div>
                  <div style={{ width: '40px', height: '2px', background: gradeColor[grade], margin: '0 auto', borderRadius: '2px' }} />
                </div>

                {/* Grade + Score */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px', marginBottom: '28px' }}>
                  <div style={{ width: '72px', height: '72px', borderRadius: '16px', background: `${gradeColor[grade]}15`, border: `2px solid ${gradeColor[grade]}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px', fontWeight: 900, color: gradeColor[grade], boxShadow: `0 0 24px ${gradeColor[grade]}40` }}>{grade}</div>
                  <div>
                    <div style={{ color: '#fff', fontSize: '52px', fontWeight: 900, lineHeight: 1 }}>{score}</div>
                    <div style={{ color: gradeColor[grade], fontSize: '11px', letterSpacing: '2px', fontWeight: 700, marginTop: '2px' }}>{gradeLabel[grade]}</div>
                    <div style={{ color: '#4b5563', fontSize: '10px', marginTop: '3px' }}>{sequences} rounds · {diffLabel}</div>
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                  {[
                    { val: sequences,                      label: 'ROUNDS',  color: '#06b6d4' },
                    { val: bonusUnlocked ? '5' : '4',      label: 'COLORS',  color: '#a855f7' },
                    { val: `${(gameTimeMs/1000).toFixed(1)}s`, label: 'TIME', color: '#10b981' },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'center', padding: '12px 4px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px' }}>
                      <div style={{ color: s.color, fontSize: '22px', fontWeight: 900 }}>{s.val}</div>
                      <div style={{ color: '#4b5563', fontSize: '8px', letterSpacing: '1px', marginTop: '2px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Rank + bonus */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '24px', minHeight: '28px', flexWrap: 'wrap' }}>
                  {submitting && <span style={{ color: '#4b5563', fontSize: '11px', letterSpacing: '1px' }}>SAVING...</span>}
                  {myRank > 0 && !submitting && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 20px', background: myRank <= 3 ? `${gradeColor[grade]}15` : 'rgba(255,255,255,0.04)', border: `1px solid ${myRank <= 3 ? gradeColor[grade] : 'rgba(255,255,255,0.08)'}`, borderRadius: '20px' }}>
                      <span style={{ color: myRank <= 3 ? gradeColor[grade] : '#6b7280', fontSize: '13px', fontWeight: 900 }}>
                        {myRank === 1 ? '🥇 RANK #1' : myRank === 2 ? '🥈 RANK #2' : myRank === 3 ? '🥉 RANK #3' : `RANK #${myRank}`}
                      </span>
                    </div>
                  )}
                  {bonusUnlocked && !submitting && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 14px', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: '20px' }}>
                      <span style={{ color: '#a855f7', fontSize: '11px', fontWeight: 700 }}>🟣 5TH COLOR</span>
                    </div>
                  )}
                </div>

                {/* Buttons */}
                <button onClick={startGame} style={{ width: '100%', padding: '15px', background: 'linear-gradient(135deg,#06b6d4,#0891b2)', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '13px', fontWeight: 700, letterSpacing: '2px', cursor: 'pointer', fontFamily: 'Orbitron, monospace', marginBottom: '10px' }}>
                  PLAY AGAIN
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => router.push('/leaderboard')} style={{ flex: 1, padding: '13px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#9ca3af', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Orbitron, monospace' }}>
                    SCORES
                  </button>
                  <button onClick={() => { const text = `🧠 GameArena — Simon Memory\n🎯 Score: ${score} | Grade: ${grade} | ${sequences} Rounds\n${bonusUnlocked ? '🟣 5th color unlocked!' : ''}\n\nPlay: ${window.location.origin}`; navigator.clipboard.writeText(text); }} style={{ flex: 1, padding: '13px', background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)', borderRadius: '12px', color: '#06b6d4', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Orbitron, monospace' }}>
                    SHARE
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
      <style>{`
        @keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
      `}</style>
    </div>
  );
}
