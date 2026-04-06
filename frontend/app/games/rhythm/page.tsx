'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useWriteContract, useAccount, useSignMessage } from 'wagmi';
import { useIsMiniPay } from '@/hooks/useMiniPay';
import { submitScore, signScore, signScoreMiniPay, submitScoreMiniPay } from '@/app/actions/game';
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from '@/lib/contracts';

const BASE_BPM         = 90;
const MAX_BPM          = 200;
const BPM_RAMP_PER_HIT = 2;
const GAME_DURATION    = 30000;
const COMBO_THRESHOLDS = [5, 10, 15, 25];

const BUTTON_COLORS: Record<number, { active: string; glow: string; key: string }> = {
  1: { active: '#a855f7', glow: 'rgba(168,85,247,0.8)', key: '1 / ←' },
  2: { active: '#06b6d4', glow: 'rgba(6,182,212,0.8)',  key: '2 / ↑' },
  3: { active: '#10b981', glow: 'rgba(16,185,129,0.8)', key: '3 / →' },
  4: { active: '#f59e0b', glow: 'rgba(245,158,11,0.8)', key: '4 / ↓' },
};

export default function RhythmRush() {
  const { user, getAccessToken, authenticated, ready } = usePrivy();
  const { address: wagmiAddress } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const isMiniPay = useIsMiniPay();
  const router = useRouter();

  // MiniPay users are connected via injected wallet — skip Privy auth redirect
  useEffect(() => {
    if (ready && !authenticated && !isMiniPay) router.replace('/');
  }, [ready, authenticated, isMiniPay, router]);
  const { writeContractAsync } = useWriteContract();
  const privyAddress = (user?.linkedAccounts?.find((a: { type: string }) => a.type === 'wallet') as { type: string; address: string } | undefined)?.address;
  const address = isMiniPay ? wagmiAddress : privyAddress;
  const isEmbeddedWallet = user?.linkedAccounts?.some((a: { type: string; walletClientType?: string }) => a.type === 'wallet' && a.walletClientType === 'privy');


  const [score, setScore]                   = useState(0);
  const [gameActive, setGameActive]         = useState(false);
  const [timeRemaining, setTimeRemaining]   = useState(30);
  const [progress, setProgress]             = useState(0);
  const [currentTarget, setCurrentTarget]   = useState(1);
  const [feedback, setFeedback]             = useState('');
  const [feedbackType, setFeedbackType]     = useState('');
  const [gameOver, setGameOver]             = useState(false);
  const [myRank, setMyRank]                 = useState<number | null>(null);
  const [combo, setCombo]                   = useState(0);
  const [maxCombo, setMaxCombo]             = useState(0);
  const [comboMultiplier, setComboMultiplier] = useState(1);
  const [bpm, setBpm]                       = useState(BASE_BPM);
  const [shakeScreen, setShakeScreen]       = useState(false);
  const [comboFlash, setComboFlash]         = useState<string | null>(null);
  const [countdown, setCountdown]           = useState<number | string | null>(null);
  const [perfectHits, setPerfectHits]       = useState(0);
  const [goodHits, setGoodHits]             = useState(0);
  const [missHits, setMissHits]             = useState(0);
  const [submitting, setSubmitting]         = useState(false);
  const [txError, setTxError]               = useState<string | null>(null);
  const [signingOnChain, setSigningOnChain] = useState(false);
  const [, setStreak]                       = useState<number | null>(null);
  const [gameTimeMs, setGameTimeMs]         = useState(0);
  const [beatTick, setBeatTick]             = useState(0);
  const beatTickRef                         = useRef(0);

  const gameEndingRef      = useRef(false);
  const gameTimerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const beatIntervalRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef       = useRef(0);
  const targetStartTimeRef = useRef(0);
  const scoreRef           = useRef(0);
  const comboRef           = useRef(0);
  const maxComboRef        = useRef(0);
  const perfectRef         = useRef(0);
  const goodRef            = useRef(0);
  const missRef            = useRef(0);
  const bpmRef             = useRef(BASE_BPM);
  const beatHitRef         = useRef(false);
  const audioCtxRef        = useRef<AudioContext | null>(null);
  const tonesRef           = useRef<Record<string, () => void>>({});

  const getBeatInterval = (b: number) => Math.round(60000 / b);

  // Audio setup
  useEffect(() => {
    const frequencies: Record<number, number> = { 1: 440, 2: 523.25, 3: 659.25, 4: 783.99 };
    const makeTone = (freq: number, dur = 0.12) => () => {
      try {
        if (!audioCtxRef.current)
          audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const ctx  = audioCtxRef.current;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq; osc.type = 'sine';
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
      } catch (_) {}
    };
    [1, 2, 3, 4].forEach(b => { tonesRef.current[`tone${b}`] = makeTone(frequencies[b]); });
    tonesRef.current['perfect'] = makeTone(1046.5, 0.15);
    tonesRef.current['combo']   = makeTone(1318.5, 0.2);
    tonesRef.current['miss']    = makeTone(220, 0.1);
  }, []);

  const playTone = (name: string) => tonesRef.current[name]?.();

  const scheduleNextBeat = useCallback(() => {
    if (beatIntervalRef.current) clearTimeout(beatIntervalRef.current);
    beatIntervalRef.current = setTimeout(() => {
      beatHitRef.current = false;
      beatTickRef.current += 1;
      setBeatTick(beatTickRef.current);
      setCurrentTarget(prev => {
        let next: number;
        do { next = Math.floor(Math.random() * 4) + 1; } while (next === prev);
        targetStartTimeRef.current = Date.now();
        playTone(`tone${next}`);
        return next;
      });
      scheduleNextBeat();
    }, getBeatInterval(bpmRef.current));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerComboMilestone = (c: number) => {
    const label = c >= 25 ? 'UNSTOPPABLE!' : c >= 15 ? 'ON FIRE!' : c >= 10 ? 'COMBO x3!' : c >= 5 ? 'COMBO x2!' : null;
    if (label) {
      playTone('combo');
      setComboFlash(label); setShakeScreen(true);
      setTimeout(() => setComboFlash(null), 1200);
      setTimeout(() => setShakeScreen(false), 300);
    }
  };

  const endGame = useCallback(async () => {
    if (gameEndingRef.current) return;
    gameEndingRef.current = true;
    setGameActive(false);
    setGameOver(true);
    if (beatIntervalRef.current) clearTimeout(beatIntervalRef.current);
    if (gameTimerRef.current) clearInterval(gameTimerRef.current);
    const elapsed = Date.now() - startTimeRef.current;
    setGameTimeMs(elapsed);

    if (!address || (!authenticated && !isMiniPay)) return;
    setSubmitting(true);
    try {
      let sig: { success: true; signature: string; nonce: string; gameType: number } | { success: false; error: string };
      let authToken: string | null = null;
      let miniPaySig: string | null = null;
      let miniPayMsg: string | null = null;

      if (isMiniPay) {
        // MiniPay: verify ownership via wallet signature instead of Privy JWT
        miniPayMsg = `GameArena|rhythm|${scoreRef.current}|${Date.now()}`;
        miniPaySig = await signMessageAsync({ message: miniPayMsg });
        sig = await signScoreMiniPay(address, miniPaySig, miniPayMsg, { game: 'rhythm', score: scoreRef.current });
      } else {
        authToken = await getAccessToken();
        if (!authToken) return;
        sig = await signScore(authToken, address, { game: 'rhythm', score: scoreRef.current });
      }

      // 2. Player submits on-chain — embedded wallet: silent, MiniPay: popup
      let txHash: string | null = null;
      let txFailed = false;
      if (sig.success) {
        setSigningOnChain(true);
        try {
          txHash = await writeContractAsync({
            address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
            abi: GAME_PASS_ABI,
            functionName: 'recordScoreWithBackendSig',
            args: [sig.gameType, BigInt(scoreRef.current), BigInt(sig.nonce), sig.signature as `0x${string}`],
            ...(isEmbeddedWallet ? { gas: 300000n } : {}),
          });
        } catch (err: unknown) {
          txFailed = true;
          const e   = err as { name?: string; code?: number; message?: string; cause?: { name?: string; code?: string } };
          const msg = ((err as Error)?.message ?? '').toLowerCase();
          const isRejected =
            e?.name === 'UserRejectedRequestError' || e?.code === 4001 || e?.code === -32003 ||
            e?.cause?.name === 'UserRejectedRequestError' ||
            e?.cause?.code === 'policy_violation' ||
            msg.includes('user rejected') || msg.includes('rejected the request') || msg.includes('user denied');
          const isGasOrFunds =
            e?.name === 'InsufficientFundsError' || e?.name === 'EstimateGasExecutionError' ||
            e?.code === -32000 || e?.code === -32010 || e?.cause?.code === 'insufficient_funds' ||
            msg.includes('insufficient funds') || msg.includes('insufficient balance') ||
            msg.includes('gas limit') || msg.includes('exceeds gas');
          if (isRejected) {
            setTxError('Transaction rejected — score not saved on-chain');
          } else if (isGasOrFunds) {
            setTxError('Insufficient CELO to cover gas — top up and try again');
          } else {
            setTxError('Transaction failed — score not saved on-chain');
          }
        } finally { setSigningOnChain(false); }
      }

      if (txFailed) return;

      // 3. Save to Supabase + get rank/streak
      let result;
      if (isMiniPay && miniPaySig && miniPayMsg) {
        result = await submitScoreMiniPay(address, miniPaySig, miniPayMsg, {
          game: 'rhythm', score: scoreRef.current, gameTime: elapsed, txHash,
        });
      } else if (authToken) {
        result = await submitScore(authToken, address, {
          game: 'rhythm', score: scoreRef.current, gameTime: elapsed, txHash,
        });
      }
      if (result?.success) {
        if (result.rank) setMyRank(result.rank);
        if (result.streak) setStreak(result.streak);
      }
    } catch (_) {
    } finally {
      setSubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, authenticated]);

  const actualStart = useCallback(() => {
    setCountdown(null);
    setScore(0); scoreRef.current = 0;
    setCombo(0); comboRef.current = 0;
    setMaxCombo(0); maxComboRef.current = 0;
    setComboMultiplier(1);
    setBpm(BASE_BPM); bpmRef.current = BASE_BPM;
    setPerfectHits(0); perfectRef.current = 0;
    setGoodHits(0); goodRef.current = 0;
    setMissHits(0); missRef.current = 0;
    setGameActive(true); setGameOver(false);
    setTimeRemaining(30); setProgress(0);
    setCurrentTarget(1); setFeedback(''); setFeedbackType('');
    setShakeScreen(false); setComboFlash(null); setMyRank(null); setStreak(null); setGameTimeMs(0); setTxError(null);
    gameEndingRef.current = false;
    startTimeRef.current = Date.now();
    targetStartTimeRef.current = Date.now();
    beatHitRef.current = false;
    scheduleNextBeat();

    gameTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setTimeRemaining(Math.max(0, Math.ceil((GAME_DURATION - elapsed) / 1000)));
      setProgress(Math.min((elapsed / GAME_DURATION) * 100, 100));
      if (elapsed >= GAME_DURATION) endGame();
    }, 100);
  }, [scheduleNextBeat, endGame]);

  const startGame = () => {
    setGameOver(false); setCountdown(3); playTone('perfect');
    setTimeout(() => { setCountdown(2); playTone('perfect'); }, 1000);
    setTimeout(() => { setCountdown(1); playTone('perfect'); }, 2000);
    setTimeout(() => { setCountdown('GO!'); playTone('combo'); }, 3000);
    setTimeout(() => actualStart(), 3500);
  };

  const handleButtonClick = useCallback((clicked: number) => {
    if (!gameActive || beatHitRef.current) return;
    const timeSince = Date.now() - targetStartTimeRef.current;
    playTone(`tone${clicked}`);

    if (clicked === currentTarget) {
      beatHitRef.current = true;
      const newCombo = comboRef.current + 1;
      comboRef.current = newCombo; setCombo(newCombo);
      if (newCombo > maxComboRef.current) { maxComboRef.current = newCombo; setMaxCombo(newCombo); }
      const mult = newCombo >= 25 ? 5 : newCombo >= 15 ? 4 : newCombo >= 10 ? 3 : newCombo >= 5 ? 2 : 1;
      setComboMultiplier(mult);
      if (COMBO_THRESHOLDS.includes(newCombo)) triggerComboMilestone(newCombo);
      const newBpm = Math.min(MAX_BPM, bpmRef.current + BPM_RAMP_PER_HIT);
      bpmRef.current = newBpm; setBpm(newBpm);
      const perfectWindow = Math.max(200, 400 - (bpmRef.current - BASE_BPM));
      const goodWindow    = Math.max(400, 700 - (bpmRef.current - BASE_BPM) * 0.5);

      if (timeSince <= perfectWindow) {
        playTone('perfect'); perfectRef.current++; setPerfectHits(perfectRef.current);
        const pts = 10 * mult;
        setScore(p => { const n = p + pts; scoreRef.current = n; return n; });
        setFeedback(`PERFECT! +${pts}${mult > 1 ? ` (${mult}x)` : ''}`); setFeedbackType('perfect');
      } else if (timeSince <= goodWindow) {
        goodRef.current++; setGoodHits(goodRef.current);
        const pts = 5 * mult;
        setScore(p => { const n = p + pts; scoreRef.current = n; return n; });
        setFeedback(`GOOD +${pts}${mult > 1 ? ` (${mult}x)` : ''}`); setFeedbackType('good');
      } else {
        missRef.current++; setMissHits(missRef.current);
        comboRef.current = 0; setCombo(0); setComboMultiplier(1);
        bpmRef.current = Math.max(BASE_BPM, bpmRef.current - 5); setBpm(bpmRef.current);
        playTone('miss'); setFeedback('LATE!'); setFeedbackType('miss');
      }
    } else {
      missRef.current++; setMissHits(missRef.current);
      comboRef.current = 0; setCombo(0); setComboMultiplier(1);
      bpmRef.current = Math.max(BASE_BPM, bpmRef.current - 10); setBpm(bpmRef.current);
      const penalty = 8;
      setScore(p => { const n = Math.max(0, p - penalty); scoreRef.current = n; return n; });
      playTone('miss'); setFeedback(`WRONG! -${penalty}`); setFeedbackType('miss');
    }
    setTimeout(() => { setFeedback(''); setFeedbackType(''); }, 600);
  }, [gameActive, currentTarget]);

  // Keyboard support
  useEffect(() => {
    const map: Record<string, number> = {
      '1': 1, 'ArrowLeft': 1, 'a': 1, 'A': 1,
      '2': 2, 'ArrowUp': 2,   'w': 2, 'W': 2,
      '3': 3, 'ArrowRight': 3,'d': 3, 'D': 3,
      '4': 4, 'ArrowDown': 4, 's': 4, 'S': 4,
    };
    const onKey = (e: KeyboardEvent) => {
      if (!gameActive) return;
      const btn = map[e.key];
      if (btn !== undefined) { e.preventDefault(); handleButtonClick(btn); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameActive, handleButtonClick]);

  if (!ready || !authenticated) return null;

  return (
    <div style={{ fontFamily: 'Orbitron, monospace', padding: '24px 16px', maxWidth: '480px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ color: '#a855f7', fontSize: '22px', fontWeight: 900, letterSpacing: '2px', margin: 0 }}>RHYTHM_RUSH</h1>
          <p style={{ color: '#6b7280', fontSize: '11px', margin: '4px 0 0' }}>30 second sprint · hit the right beat</p>
        </div>
        <button onClick={() => router.push('/')} style={{ color: '#6b7280', fontSize: '11px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>
          ← BACK
        </button>
      </div>

      {/* Countdown overlay */}
      {countdown !== null && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,5,15,0.85)' }}>
          <div style={{ color: countdown === 'GO!' ? '#10b981' : '#a855f7', fontSize: countdown === 'GO!' ? '72px' : '96px', fontWeight: 900 }}>{countdown}</div>
        </div>
      )}

      {/* Game panel — border shifts purple → red as BPM climbs */}
      {(() => {
        const intensity = Math.min(1, (bpm - BASE_BPM) / (MAX_BPM - BASE_BPM));
        const r = Math.round(168 + 71 * intensity);
        const g = Math.round(85  - 85  * intensity);
        const b = Math.round(247 - 200 * intensity);
        const a = gameActive ? 0.2 + intensity * 0.4 : 0.2;
        const panelBorder = `1px solid rgba(${r},${g},${b},${a})`;
        return (
      <div style={{ background: 'rgba(10,10,20,0.8)', border: panelBorder, borderRadius: '12px', padding: '20px 16px' }}>
        {/* Stats row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px' }}>SCORE</div>
            <div style={{ color: '#a855f7', fontSize: '36px', fontWeight: 900 }}>{score}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px' }}>TIME</div>
            <div style={{ color: timeRemaining <= 5 ? '#ef4444' : '#06b6d4', fontSize: '36px', fontWeight: 900 }}>{timeRemaining}s</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#6b7280', fontSize: '10px' }}>COMBO</div>
            <div style={{ color: '#f59e0b', fontSize: '36px', fontWeight: 900 }}>{combo}</div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginBottom: '16px' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#a855f7,#06b6d4)', borderRadius: '2px', transition: 'width 0.1s linear' }} />
        </div>

        {/* BPM + multiplier */}
        {gameActive && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '10px', color: '#6b7280' }}>
            <span>{bpm} BPM</span>
            {comboMultiplier > 1 && <span style={{ color: '#f59e0b', fontWeight: 700 }}>{comboMultiplier}x MULTIPLIER</span>}
          </div>
        )}

        {/* Combo flash */}
        {comboFlash && (
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <span style={{ color: '#f59e0b', fontSize: '18px', fontWeight: 900 }}>{comboFlash}</span>
          </div>
        )}

        {/* Feedback */}
        <div style={{ textAlign: 'center', height: '28px', marginBottom: '16px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: feedbackType === 'perfect' ? '#10b981' : feedbackType === 'good' ? '#06b6d4' : feedbackType === 'miss' ? '#ef4444' : '#6b7280' }}>
            {feedback || (gameActive ? `HIT ${currentTarget}` : gameOver ? 'GAME OVER' : 'GET READY')}
          </span>
        </div>

        {/* Buttons 2×2 */}
        <style>{`
          @keyframes beatRing {
            from { transform: scale(2.2); opacity: 0.9; }
            to   { transform: scale(1.0); opacity: 0; }
          }
        `}</style>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '24px' }}>
          {[1, 2, 3, 4].map(btn => {
            const c = BUTTON_COLORS[btn];
            const isTarget = gameActive && btn === currentTarget;
            const intensity = Math.min(1, (bpm - BASE_BPM) / (MAX_BPM - BASE_BPM));
            const glowSize  = Math.round(24 + intensity * 20); // 24px → 44px as BPM climbs
            const scale     = isTarget ? 1.1 + intensity * 0.05 : 1;
            return (
              <div key={btn} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isTarget && (
                  <div
                    key={`ring-${beatTick}`}
                    style={{
                      position: 'absolute',
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      border: `2px solid ${c.active}`,
                      animation: `beatRing ${getBeatInterval(bpm)}ms linear forwards`,
                      pointerEvents: 'none',
                    }}
                  />
                )}
                <button
                  onPointerDown={e => { e.preventDefault(); handleButtonClick(btn); }}
                  disabled={!gameActive || gameOver}
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    border: `3px solid ${isTarget ? c.active : 'rgba(255,255,255,0.08)'}`,
                    background: isTarget ? `${c.active}33` : `${c.active}11`,
                    boxShadow: isTarget ? `0 0 ${glowSize}px ${c.glow}` : 'none',
                    transform: `scale(${scale})`,
                    transition: 'all 0.08s ease',
                    cursor: gameActive ? 'pointer' : 'default',
                  }}
                >
                  <span style={{ color: c.active, fontSize: '9px', fontWeight: 700 }}>{c.key}</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Quit button */}
        {gameActive && !gameOver && (
          <button onClick={endGame} style={{ width: '100%', padding: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '8px', color: '#ef4444', fontSize: '12px', fontWeight: 700, letterSpacing: '2px', cursor: 'pointer', marginBottom: '8px' }}>
            END GAME
          </button>
        )}

        {/* Start */}
        {!gameActive && !gameOver && (
          <button onClick={startGame} style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg,#a855f7,#7c3aed)', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 700, letterSpacing: '2px', cursor: 'pointer' }}>
            START_GAME
          </button>
        )}

        {/* Game over overlay */}
        {gameOver && (() => {
          const totalTaps = perfectHits + goodHits + missHits;
          const accuracy = totalTaps > 0 ? Math.round((perfectHits / totalTaps) * 100) : 0;
          const grade = score >= 500 ? 'S' : score >= 350 ? 'A' : score >= 200 ? 'B' : score >= 100 ? 'C' : 'D';
          const gradeColor: Record<string, string> = { S: '#f59e0b', A: '#10b981', B: '#06b6d4', C: '#a855f7', D: '#6b7280' };
          const gradeLabel: Record<string, string> = { S: 'LEGENDARY', A: 'SKILLED', B: 'SOLID', C: 'DECENT', D: 'KEEP GOING' };
          const rank = myRank ?? 0;
          return (
            <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(5,5,15,0.6)', animation: 'fadeIn 0.2s ease' }} onClick={() => setGameOver(false)}>
              <div style={{ background: '#0a0a1a', borderTop: `2px solid ${gradeColor[grade]}40`, borderRadius: '24px 24px 0 0', padding: '20px 20px 28px', animation: 'slideUp 0.4s cubic-bezier(0.34,1.2,0.64,1)', position: 'relative', maxHeight: '82vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                <button onClick={() => setGameOver(false)} style={{ position: 'absolute', top: '14px', right: '16px', background: 'none', border: 'none', color: '#4b5563', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>✕</button>

                {/* Title */}
                <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                  <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '3px', marginBottom: '4px' }}>RHYTHM_RUSH · RESULT</div>
                  <div style={{ width: '40px', height: '2px', background: gradeColor[grade], margin: '0 auto', borderRadius: '2px' }} />
                </div>

                {/* Grade + Score */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginBottom: '16px' }}>
                  <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: `${gradeColor[grade]}15`, border: `2px solid ${gradeColor[grade]}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '30px', fontWeight: 900, color: gradeColor[grade], boxShadow: `0 0 20px ${gradeColor[grade]}40` }}>{grade}</div>
                  <div>
                    <div style={{ color: '#fff', fontSize: '42px', fontWeight: 900, lineHeight: 1 }}>{score}</div>
                    <div style={{ color: gradeColor[grade], fontSize: '11px', letterSpacing: '2px', fontWeight: 700, marginTop: '2px' }}>{gradeLabel[grade]}</div>
                  </div>
                </div>

                {/* Hit breakdown */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                  {[
                    { val: perfectHits, label: 'PERFECT', color: '#10b981' },
                    { val: goodHits,    label: 'GOOD',    color: '#f59e0b' },
                    { val: missHits,    label: 'MISS',    color: '#ef4444' },
                    { val: `${accuracy}%`, label: 'ACC', color: '#06b6d4' },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'center', padding: '8px 4px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px' }}>
                      <div style={{ color: s.color, fontSize: '18px', fontWeight: 900 }}>{s.val}</div>
                      <div style={{ color: '#4b5563', fontSize: '8px', letterSpacing: '1px', marginTop: '2px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Combo / BPM / Time */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', marginBottom: '12px' }}>
                  <div style={{ textAlign: 'center' }}><div style={{ color: '#f59e0b', fontSize: '16px', fontWeight: 900 }}>{maxCombo}x</div><div style={{ color: '#4b5563', fontSize: '8px' }}>COMBO</div></div>
                  <div style={{ width: '1px', background: 'rgba(255,255,255,0.06)' }} />
                  <div style={{ textAlign: 'center' }}><div style={{ color: '#ef4444', fontSize: '16px', fontWeight: 900 }}>{Math.round(bpm)}</div><div style={{ color: '#4b5563', fontSize: '8px' }}>BPM</div></div>
                  <div style={{ width: '1px', background: 'rgba(255,255,255,0.06)' }} />
                  <div style={{ textAlign: 'center' }}><div style={{ color: '#a855f7', fontSize: '16px', fontWeight: 900 }}>{(gameTimeMs / 1000).toFixed(1)}s</div><div style={{ color: '#4b5563', fontSize: '8px' }}>TIME</div></div>
                </div>

                {/* Rank */}
                <div style={{ textAlign: 'center', marginBottom: '14px', minHeight: '28px' }}>
                  {submitting && <span style={{ color: '#4b5563', fontSize: '11px', letterSpacing: '1px' }}>SAVING...</span>}
                  {txError && !submitting && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ color: '#ef4444', fontSize: '11px', letterSpacing: '1px', fontWeight: 700 }}>⚠ SCORE NOT SAVED</div>
                      <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '3px' }}>Insufficient CELO to cover gas — top up and try again</div>
                    </div>
                  )}
                  {rank > 0 && !submitting && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 20px', background: rank <= 3 ? `${gradeColor[grade]}15` : 'rgba(255,255,255,0.04)', border: `1px solid ${rank <= 3 ? gradeColor[grade] : 'rgba(255,255,255,0.08)'}`, borderRadius: '20px' }}>
                      <span style={{ color: rank <= 3 ? gradeColor[grade] : '#6b7280', fontSize: '13px', fontWeight: 900 }}>
                        {rank === 1 ? '🥇 RANK #1' : rank === 2 ? '🥈 RANK #2' : rank === 3 ? '🥉 RANK #3' : `RANK #${rank}`}
                      </span>
                    </div>
                  )}
                </div>

                {/* Buttons */}
                <button onClick={startGame} style={{ width: '100%', padding: '13px', background: 'linear-gradient(135deg,#a855f7,#7c3aed)', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '13px', fontWeight: 700, letterSpacing: '2px', cursor: 'pointer', fontFamily: 'Orbitron, monospace', marginBottom: '8px' }}>
                  PLAY AGAIN
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => router.push('/leaderboard')} style={{ flex: 1, padding: '13px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#9ca3af', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Orbitron, monospace' }}>
                    SCORES
                  </button>
                  <button onClick={() => { const text = `🎮 GameArena — Rhythm Rush\n🎵 Score: ${score} | Grade: ${grade} | Combo: ${maxCombo}x\n🎯 Accuracy: ${accuracy}%\n\nPlay: ${window.location.origin}`; navigator.clipboard.writeText(text); }} style={{ flex: 1, padding: '13px', background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.25)', borderRadius: '12px', color: '#a855f7', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Orbitron, monospace' }}>
                    SHARE
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
        );
      })()}

      {/* Wallet signing overlay */}
      {signingOnChain && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,5,15,0.85)', backdropFilter: 'blur(8px)', animation: 'fadeIn 0.2s ease' }}>
          <div style={{ textAlign: 'center', padding: '40px 32px', background: 'rgba(10,10,26,0.95)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: '24px', maxWidth: '320px', width: '90%', boxShadow: '0 0 80px rgba(168,85,247,0.15)' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px', animation: 'walletPulse 1.4s ease-in-out infinite' }}>🦊</div>
            <div style={{ color: '#a855f7', fontSize: '11px', fontWeight: 700, letterSpacing: '3px', marginBottom: '8px' }}>ACTION REQUIRED</div>
            <div style={{ color: '#fff', fontSize: '18px', fontWeight: 900, letterSpacing: '1px', marginBottom: '12px', fontFamily: 'Orbitron, monospace' }}>CHECK YOUR WALLET</div>
            <div style={{ color: '#9ca3af', fontSize: '12px', lineHeight: 1.6, marginBottom: '24px' }}>
              Your wallet is asking for approval.<br />Open your wallet app and tap <span style={{ color: '#10b981', fontWeight: 700 }}>Confirm</span> to save your score on-chain.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#a855f7', animation: 'dot1 1.4s ease-in-out infinite' }} />
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#a855f7', animation: 'dot1 1.4s ease-in-out infinite 0.2s' }} />
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#a855f7', animation: 'dot1 1.4s ease-in-out infinite 0.4s' }} />
            </div>
            <div style={{ marginTop: '16px', color: '#374151', fontSize: '10px' }}>Skipping will still save your score to the leaderboard</div>
          </div>
        </div>
      )}

      {/* Screen shake style */}
      <style>{`
        @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }
        @keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes walletPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.12);opacity:0.85} }
        @keyframes dot1 { 0%,80%,100%{transform:scale(0.6);opacity:0.3} 40%{transform:scale(1);opacity:1} }
        ${shakeScreen ? 'body{animation:shake 0.3s ease}' : ''}
      `}</style>
    </div>
  );
}
