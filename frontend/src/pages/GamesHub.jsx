import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useReadContract, useWriteContract, usePublicClient, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { parseUnits, formatUnits } from 'viem';
import { CONTRACT_ADDRESSES, ERC20_ABI, SOLO_WAGER_ABI, SOLO_WAGER_ADDRESS, GAME_PASS_ABI } from '../config/contracts';
import { useSelfVerification } from '../contexts/SelfVerificationContext';
import { toast } from 'react-hot-toast';

const BACKEND_URL = import.meta.env.VITE_GAMES_BACKEND_URL || 'http://localhost:3005';

const BADGE_COLORS = { gold: '#f59e0b', silver: '#9ca3af', bronze: '#b45309' };

function MiniChip({ badge }) {
  const color = BADGE_COLORS[badge.type];
  const medal = badge.rank === 1 ? '🥇' : badge.rank === 2 ? '🥈' : '🥉';
  return (
    <span title={`Week ${badge.season} — #${badge.rank} in ${badge.game}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '2px',
        padding: '2px 6px', borderRadius: '8px',
        background: `${color}18`, border: `1px solid ${color}40`,
        color, fontSize: '8px', fontWeight: 700, cursor: 'default',
      }}
    >
      {medal} W{badge.season}
    </span>
  );
}

const GAMES = [
  {
    id:       'rhythm',
    path:     '/rhythm',
    emoji:    '🎵',
    title:    'RHYTHM RUSH',
    desc:     'Tap the glowing button in time with the beat.',
    accent:   '#a855f7',
    faint:    'rgba(168,85,247,0.08)',
    border:   'rgba(168,85,247,0.25)',
    gameType: 0,
    winAt:    '350 pts',
    payout:   '1.3x',
  },
  {
    id:       'simon',
    path:     '/simon',
    emoji:    '🧠',
    title:    'SIMON MEMORY',
    desc:     'Watch the color sequence flash and repeat it.',
    accent:   '#06b6d4',
    faint:    'rgba(6,182,212,0.08)',
    border:   'rgba(6,182,212,0.25)',
    gameType: 1,
    winAt:    '7 sequences',
    payout:   '1.3x',
    noWager:  true,
  },
];

const WAGER_AMOUNTS = ['1', '5', '10', '25', '50'];

const fmt = (a) => a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '';

const GAME_LABELS = { rhythm: 'RHYTHM RUSH', simon: 'SIMON MEMORY' };
const GAME_ACCENT = { rhythm: '#a855f7', simon: '#06b6d4' };

function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function GamesHub() {
  const navigate    = useNavigate();
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const publicClient = usePublicClient();
  const { isVerified, isVerifying, verifyIdentity, claimG$, entitlement } = useSelfVerification();

  const [wagerMode,   setWagerMode]   = useState({});
  const [wagerAmount, setWagerAmount] = useState({});
  const [pending,     setPending]     = useState(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [mintingPass,   setMintingPass]   = useState(false);

  // GamePass reads
  const { data: hasPass, refetch: refetchPass } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS,
    abi: GAME_PASS_ABI,
    functionName: 'hasMinted',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: username, refetch: refetchUsername } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS,
    abi: GAME_PASS_ABI,
    functionName: 'getUsername',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: totalUsers } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS,
    abi: GAME_PASS_ABI,
    functionName: 'totalSupply',
  });

  // Live data
  const [activity,  setActivity]  = useState([]);
  const [stats,     setStats]     = useState(null);
  const [newIdx,    setNewIdx]    = useState(-1);
  const [badges,    setBadges]    = useState(null);
  const [countdown, setCountdown] = useState('');
  const prevTopTimestamp = useRef(null);

  // Season countdown ticker
  useEffect(() => {
    function tick() {
      if (!stats?.seasonEndsAt) return;
      const diff = stats.seasonEndsAt - Math.floor(Date.now() / 1000);
      if (diff <= 0) { setCountdown('ENDING SOON'); return; }
      const d = Math.floor(diff / 86400);
      const h = Math.floor((diff % 86400) / 3600);
      const m = Math.floor((diff % 3600) / 60);
      setCountdown(d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`);
    }
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [stats?.seasonEndsAt]);

  const { writeContractAsync } = useWriteContract();

  const mintGamePass = async () => {
    if (!usernameInput || usernameInput.length < 3) {
      toast.error('Username must be 3-16 characters (a-z, 0-9, _)');
      return;
    }
    setMintingPass(true);
    try {
      toast.loading('Minting your Game Pass...', { id: 'mint-pass' });
      await writeContractAsync({
        address: CONTRACT_ADDRESSES.GAME_PASS,
        abi: GAME_PASS_ABI,
        functionName: 'mint',
        args: [usernameInput],
      });
      toast.success(`Welcome, ${usernameInput}!`, { id: 'mint-pass' });
      refetchPass();
      refetchUsername();
    } catch (err) {
      const msg = err.shortMessage || err.message || 'Mint failed';
      if (msg.includes('Username taken')) toast.error('That username is taken, try another', { id: 'mint-pass' });
      else if (msg.includes('Already minted')) toast.error('You already have a Game Pass', { id: 'mint-pass' });
      else toast.error(msg, { id: 'mint-pass' });
    } finally {
      setMintingPass(false);
    }
  };

  // Poll activity every 5 s
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/activity`);
        if (!r.ok) return;
        const { activity: incoming } = await r.json();
        if (!cancelled) {
          setActivity(prev => {
            const topTs = incoming[0]?.timestamp;
            if (topTs && topTs !== prevTopTimestamp.current) {
              prevTopTimestamp.current = topTs;
              setNewIdx(0);
              setTimeout(() => setNewIdx(-1), 1500);
            }
            return incoming;
          });
        }
      } catch (_) {}
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Poll stats every 10 s
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/stats`);
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setStats(data);
      } catch (_) {}
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Fetch player badges when wallet connects
  useEffect(() => {
    if (!address) { setBadges(null); return; }
    fetch(`${BACKEND_URL}/api/badges/${address}`)
      .then(r => r.json())
      .then(setBadges)
      .catch(() => {});
  }, [address]);

  // G$ balance
  const { data: gBalance } = useReadContract({
    address:      CONTRACT_ADDRESSES.G_TOKEN,
    abi:          ERC20_ABI,
    functionName: 'balanceOf',
    args:         [address],
    query:        { enabled: !!address, refetchInterval: 15000 },
  });

  const gBal      = gBalance ? Number(formatUnits(gBalance, 18)).toFixed(2) : '0.00';
  const claimable = entitlement ? Number(formatUnits(entitlement, 18)).toFixed(4) : '0';
  const canClaim  = Number(claimable) > 0;

  const handlePlay = async (game) => {
    const isWager = wagerMode[game.id];
    if (!isWager) { navigate(game.path); return; }

    if (!isConnected)  { toast.error('Connect your wallet first'); return; }
    if (!isVerified)   { toast.error('Verify your GoodDollar identity to wager'); return; }
    if (!SOLO_WAGER_ADDRESS) {
      toast('Wager contract not deployed — playing free', { icon: 'ℹ️' });
      navigate(game.path); return;
    }

    const amount    = wagerAmount[game.id] || '5';
    const amountWei = parseUnits(amount, 18);

    try {
      setPending(game.id);

      toast.loading('Approving G$...', { id: 'wager' });
      await writeContractAsync({
        address: CONTRACT_ADDRESSES.G_TOKEN,
        abi:     ERC20_ABI,
        functionName: 'approve',
        args:    [SOLO_WAGER_ADDRESS, amountWei],
      });

      toast.loading('Locking wager on-chain...', { id: 'wager' });
      const txHash = await writeContractAsync({
        address: SOLO_WAGER_ADDRESS,
        abi:     SOLO_WAGER_ABI,
        functionName: 'createWager',
        args:    [amountWei, game.gameType],
      });

      let wagerId = null;
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        const wagerLog = receipt.logs.find(l =>
          l.address.toLowerCase() === SOLO_WAGER_ADDRESS.toLowerCase() &&
          l.topics.length >= 3
        );
        if (wagerLog) wagerId = Number(BigInt(wagerLog.topics[1]));
      } catch (_) {}

      toast.success(`${amount} G$ locked`, { id: 'wager' });
      navigate(game.path, {
        state: { wager: true, amount, wagerId, gameType: game.gameType, winAt: game.winAt, payout: game.payout },
      });
    } catch (err) {
      toast.error(err.shortMessage || 'Transaction failed', { id: 'wager' });
    } finally {
      setPending(null);
    }
  };

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes pulseGlow { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes breathe { 0%,100% { box-shadow: 0 0 20px rgba(168,85,247,0.1); } 50% { box-shadow: 0 0 40px rgba(168,85,247,0.2); } }
        @keyframes gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        .game-card { transition: all 0.25s ease; }
        .game-card:hover { transform: translateY(-3px); }
        .play-btn { transition: all 0.2s ease; }
        .play-btn:hover { filter: brightness(1.2); transform: scale(1.02); }
        .chip:hover { filter: brightness(1.3); }
      `}</style>

      <div style={{ fontFamily: 'Orbitron, monospace', maxWidth: '580px', margin: '0 auto' }}>

        {/* ── Hero Section ──────────────────────────────────────────── */}
        <div style={{
          position: 'relative', padding: '30px 24px 24px', marginBottom: '20px',
          background: 'linear-gradient(160deg, rgba(168,85,247,0.12) 0%, rgba(6,182,212,0.06) 50%, rgba(16,185,129,0.04) 100%)',
          border: '1px solid rgba(168,85,247,0.15)', borderRadius: '20px',
          overflow: 'hidden', animation: 'breathe 5s ease-in-out infinite',
        }}>
          {/* Grid overlay */}
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.04,
            backgroundImage: 'linear-gradient(rgba(168,85,247,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.3) 1px, transparent 1px)',
            backgroundSize: '32px 32px', pointerEvents: 'none',
          }} />
          {/* Gradient orb */}
          <div style={{
            position: 'absolute', top: '-40px', right: '-40px', width: '160px', height: '160px',
            borderRadius: '50%', background: 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          <div style={{ position: 'relative', zIndex: 1 }}>
            {/* Top row — player or connect */}
            {isConnected && username ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '42px', height: '42px', borderRadius: '12px',
                    background: 'linear-gradient(135deg, #a855f7, #06b6d4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '20px', fontWeight: 900, color: '#fff',
                    boxShadow: '0 4px 15px rgba(168,85,247,0.3)',
                  }}>
                    {username[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ color: '#fff', fontSize: '15px', fontWeight: 900, letterSpacing: '1px' }}>{username}</div>
                    <div style={{ color: '#6b7280', fontSize: '9px', marginTop: '2px' }}>
                      {gBal} G$ · Player #{totalUsers ? Number(totalUsers) : '?'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {isVerified ? (
                    <span className="chip" style={{
                      padding: '5px 12px', borderRadius: '20px', fontSize: '9px', fontWeight: 700,
                      background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', color: '#10b981',
                    }}>VERIFIED</span>
                  ) : (
                    <button onClick={verifyIdentity} disabled={isVerifying} className="chip" style={{
                      padding: '5px 12px', borderRadius: '20px', fontSize: '9px', fontWeight: 700, cursor: 'pointer',
                      background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24',
                      fontFamily: 'Orbitron, monospace',
                    }}>{isVerifying ? '...' : 'VERIFY'}</button>
                  )}
                  {canClaim && (
                    <button onClick={claimG$} className="chip" style={{
                      padding: '5px 12px', borderRadius: '20px', fontSize: '9px', fontWeight: 700, cursor: 'pointer',
                      background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc',
                      fontFamily: 'Orbitron, monospace',
                    }}>CLAIM G$</button>
                  )}
                </div>
              </div>
            ) : isConnected && !hasPass ? null : !isConnected ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <span style={{ color: '#6b7280', fontSize: '9px', letterSpacing: '3px' }}>WELCOME TO</span>
                <button onClick={() => connect({ connector: injected() })} className="play-btn" style={{
                  padding: '10px 22px', borderRadius: '12px', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
                  border: 'none', color: '#fff', fontSize: '11px', fontWeight: 700,
                  fontFamily: 'Orbitron, monospace', letterSpacing: '1px',
                  boxShadow: '0 4px 20px rgba(168,85,247,0.3)',
                }}>CONNECT WALLET</button>
              </div>
            ) : null}

            {/* Title */}
            <h1 style={{ color: '#fff', fontSize: '32px', fontWeight: 900, margin: 0, letterSpacing: '4px', lineHeight: 1 }}>
              GAME<span style={{ color: '#a855f7' }}>_</span>ARENA
            </h1>
            <p style={{ color: '#4b5563', fontSize: '11px', marginTop: '8px', lineHeight: 1.4 }}>
              Play games · Earn G$ · Compete weekly · Fund global UBI
            </p>

            {/* Stats row */}
            {stats && (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px',
                marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)',
              }}>
                {[
                  { val: totalUsers ? Number(totalUsers) : (stats.totalUsers ?? 0), lab: 'PLAYERS', col: '#10b981' },
                  { val: stats.totalGames ?? 0, lab: 'GAMES', col: '#a855f7' },
                  { val: `${stats.estimatedPrizePot}`, lab: 'PRIZE POT', col: '#f59e0b' },
                  { val: countdown || '—', lab: `WEEK ${stats.currentSeason}`, col: '#06b6d4' },
                ].map(s => (
                  <div key={s.lab} style={{
                    textAlign: 'center', padding: '8px 4px',
                    background: 'rgba(0,0,0,0.2)', borderRadius: '10px',
                  }}>
                    <div style={{ color: s.col, fontSize: '17px', fontWeight: 900 }}>{s.val}</div>
                    <div style={{ color: '#374151', fontSize: '7px', letterSpacing: '0.5px', marginTop: '4px' }}>{s.lab}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Badges */}
            {badges && badges.badges.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginTop: '12px' }}>
                {badges.summary.streakLabel && (
                  <span style={{
                    padding: '3px 10px', borderRadius: '10px', fontSize: '8px', fontWeight: 900,
                    background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b',
                  }}>{badges.summary.streakLabel}</span>
                )}
                {badges.badges.slice(0, 5).map((b, i) => <MiniChip key={i} badge={b} />)}
                {badges.badges.length > 5 && <span style={{ color: '#374151', fontSize: '9px' }}>+{badges.badges.length - 5}</span>}
              </div>
            )}
          </div>
        </div>

        {/* ── Game Pass Gate ─────────────────────────────────────────── */}
        {isConnected && !hasPass && (
          <div style={{
            marginBottom: '20px', padding: '28px 24px',
            background: 'linear-gradient(160deg, rgba(16,185,129,0.08), rgba(6,182,212,0.04))',
            border: '1px solid rgba(16,185,129,0.25)', borderRadius: '16px',
            textAlign: 'center', animation: 'slideUp 0.5s ease-out',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '12px', animation: 'float 3s ease-in-out infinite' }}>🎮</div>
            <div style={{ color: '#10b981', fontSize: '16px', fontWeight: 900, letterSpacing: '3px', marginBottom: '6px' }}>
              CREATE YOUR PLAYER
            </div>
            <div style={{ color: '#6b7280', fontSize: '10px', marginBottom: '20px', lineHeight: 1.5 }}>
              Pick a username · Mint your free soulbound pass · Start playing
            </div>
            <div style={{ display: 'flex', gap: '8px', maxWidth: '340px', margin: '0 auto' }}>
              <input
                type="text"
                placeholder="username..."
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16))}
                onKeyDown={(e) => e.key === 'Enter' && mintGamePass()}
                style={{
                  flex: 1, padding: '14px 16px',
                  background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(16,185,129,0.3)',
                  borderRadius: '12px', color: '#fff', fontSize: '14px',
                  fontFamily: 'Orbitron, monospace', outline: 'none', textAlign: 'center',
                  letterSpacing: '2px',
                }}
              />
              <button
                onClick={mintGamePass}
                disabled={mintingPass || usernameInput.length < 3}
                className="play-btn"
                style={{
                  padding: '14px 24px', borderRadius: '12px', cursor: 'pointer',
                  background: usernameInput.length >= 3 ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.05)',
                  border: 'none', color: '#fff', fontSize: '12px', fontWeight: 900,
                  fontFamily: 'Orbitron, monospace', letterSpacing: '1px',
                  opacity: mintingPass || usernameInput.length < 3 ? 0.4 : 1,
                  boxShadow: usernameInput.length >= 3 ? '0 4px 15px rgba(16,185,129,0.3)' : 'none',
                }}
              >{mintingPass ? '...' : 'GO'}</button>
            </div>
            <div style={{ color: '#374151', fontSize: '8px', marginTop: '12px', letterSpacing: '0.5px' }}>
              3-16 characters · letters, numbers, underscore
            </div>
          </div>
        )}

        {/* ── Identity Notice ────────────────────────────────────────── */}
        {isConnected && hasPass && !isVerified && (
          <div style={{
            marginBottom: '16px', padding: '12px 16px',
            background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)',
            borderRadius: '12px', display: 'flex', gap: '12px', alignItems: 'center',
          }}>
            <span style={{ fontSize: '20px' }}>👤</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#fbbf24', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>
                VERIFY TO UNLOCK WAGERS
              </div>
              <div style={{ color: '#4b5563', fontSize: '9px', marginTop: '2px' }}>
                One-time face scan via GoodDollar — prevents bots
              </div>
            </div>
            <button onClick={verifyIdentity} disabled={isVerifying} className="play-btn" style={{
              padding: '8px 16px', borderRadius: '10px', cursor: 'pointer',
              background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)',
              color: '#fbbf24', fontSize: '10px', fontWeight: 700, fontFamily: 'Orbitron, monospace',
            }}>{isVerifying ? '...' : 'VERIFY'}</button>
          </div>
        )}

        {/* ── Game Cards ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px' }}>
          {GAMES.map((game, gi) => {
            const isWager  = wagerMode[game.id];
            const amount   = wagerAmount[game.id] || '5';
            const loading  = pending === game.id;
            const canWager = isConnected && isVerified;
            const myBest = address
              ? activity.filter(a => a.game === game.id && a.player === address.toLowerCase())
                  .sort((a, b) => b.score - a.score)[0]?.score
              : null;

            return (
              <div key={game.id} className="game-card" style={{
                background: `linear-gradient(160deg, ${game.faint} 0%, rgba(8,8,16,0.95) 100%)`,
                border: `1px solid ${isWager ? game.accent : game.border}`,
                borderRadius: '16px', padding: '22px',
                animation: `slideUp 0.4s ease-out ${gi * 0.12}s both`,
              }}>
                {/* Header row */}
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <div style={{
                    width: '60px', height: '60px', borderRadius: '16px',
                    background: `linear-gradient(135deg, ${game.accent}25, ${game.accent}08)`,
                    border: `1px solid ${game.accent}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '30px', flexShrink: 0,
                    animation: `float 4s ease-in-out infinite ${gi * 0.5}s`,
                  }}>{game.emoji}</div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ color: game.accent, fontSize: '16px', fontWeight: 900, letterSpacing: '2px' }}>
                        {game.title}
                      </span>
                      {myBest != null && (
                        <span style={{
                          padding: '3px 10px', borderRadius: '12px', fontSize: '9px', fontWeight: 900,
                          background: `${game.accent}15`, border: `1px solid ${game.accent}30`, color: game.accent,
                        }}>PB: {myBest}</span>
                      )}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '5px', lineHeight: 1.4 }}>{game.desc}</div>
                    {!game.noWager && (
                      <div style={{ display: 'flex', gap: '14px', marginTop: '6px' }}>
                        <span style={{ color: '#374151', fontSize: '8px' }}>
                          WIN: <span style={{ color: '#9ca3af' }}>{game.winAt}</span>
                        </span>
                        <span style={{ color: '#374151', fontSize: '8px' }}>
                          PAYOUT: <span style={{ color: '#10b981' }}>{game.payout}</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Wager section */}
                {!game.noWager && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ display: 'flex', gap: '6px', marginBottom: isWager ? '12px' : 0 }}>
                      <button onClick={() => setWagerMode(p => ({ ...p, [game.id]: false }))} style={{
                        flex: 1, padding: '9px',
                        background: !isWager ? 'rgba(255,255,255,0.08)' : 'transparent',
                        border: `1px solid ${!isWager ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}`,
                        borderRadius: '10px', color: !isWager ? '#e5e7eb' : '#4b5563',
                        fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
                        cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                      }}>FREE PLAY</button>
                      <button onClick={() => {
                        if (!canWager && isConnected) { toast('Verify identity first', { icon: '👤' }); return; }
                        setWagerMode(p => ({ ...p, [game.id]: true }));
                      }} style={{
                        flex: 1, padding: '9px',
                        background: isWager ? `${game.accent}18` : 'transparent',
                        border: `1px solid ${isWager ? game.accent : 'rgba(255,255,255,0.05)'}`,
                        borderRadius: '10px', color: isWager ? game.accent : canWager ? '#6b7280' : '#374151',
                        fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
                        cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                        opacity: !canWager ? 0.5 : 1,
                      }}>{!canWager && isConnected ? '🔒 WAGER' : 'WAGER G$'}</button>
                    </div>

                    {isWager && (
                      <div style={{
                        padding: '14px', background: 'rgba(0,0,0,0.3)', borderRadius: '12px',
                        border: `1px solid ${game.accent}15`, marginBottom: '12px',
                      }}>
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', justifyContent: 'center' }}>
                          {WAGER_AMOUNTS.map(amt => (
                            <button key={amt} onClick={() => setWagerAmount(p => ({ ...p, [game.id]: amt }))} className="chip" style={{
                              padding: '7px 14px',
                              background: amount === amt ? `${game.accent}28` : 'rgba(255,255,255,0.03)',
                              border: `1px solid ${amount === amt ? game.accent : 'rgba(255,255,255,0.06)'}`,
                              borderRadius: '8px', color: amount === amt ? game.accent : '#6b7280',
                              fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                              fontFamily: 'Orbitron, monospace', transition: 'all 0.15s',
                            }}>{amt}</button>
                          ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', padding: '0 6px' }}>
                          <span style={{ color: '#6b7280' }}>Win: <span style={{ color: '#fff' }}>{game.winAt}</span></span>
                          <span style={{ color: '#10b981', fontWeight: 700 }}>{(parseFloat(amount) * 1.3).toFixed(1)} G$</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Play button */}
                <button
                  onClick={() => handlePlay(game)}
                  disabled={loading}
                  className="play-btn"
                  style={{
                    width: '100%', padding: '14px', marginTop: game.noWager ? '16px' : isWager ? 0 : '16px',
                    background: isWager
                      ? `linear-gradient(135deg, ${game.accent}, ${game.accent}99)`
                      : `linear-gradient(135deg, ${game.accent}20, ${game.accent}08)`,
                    border: `1px solid ${game.accent}${isWager ? '' : '35'}`,
                    borderRadius: '12px',
                    color: isWager ? '#fff' : game.accent,
                    fontSize: '13px', fontWeight: 900, letterSpacing: '3px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'Orbitron, monospace',
                    opacity: loading ? 0.6 : 1,
                    boxShadow: isWager ? `0 4px 20px ${game.accent}30` : 'none',
                  }}
                >
                  {loading ? 'PROCESSING...' : isWager ? `WAGER ${amount} G$` : 'PLAY NOW'}
                </button>
              </div>
            );
          })}
        </div>

        {/* ── AI Challenge Card ──────────────────────────────────────── */}
        <div
          onClick={() => navigate('/arena')}
          className="game-card"
          style={{
            marginBottom: '16px', padding: '20px',
            background: 'linear-gradient(160deg, rgba(168,85,247,0.08), rgba(139,92,246,0.03))',
            border: '1px solid rgba(168,85,247,0.2)', borderRadius: '16px',
            display: 'flex', alignItems: 'center', gap: '16px', cursor: 'pointer',
          }}
        >
          <div style={{
            width: '52px', height: '52px', borderRadius: '14px',
            background: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(139,92,246,0.08))',
            border: '1px solid rgba(168,85,247,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px',
            animation: 'float 3s ease-in-out infinite',
          }}>🤖</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#a855f7', fontSize: '14px', fontWeight: 900, letterSpacing: '2px' }}>
              CHALLENGE AI
            </div>
            <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '3px' }}>
              PvP wager matches vs Markov-1 — RPS, Dice & more
            </div>
          </div>
          <div style={{
            padding: '8px 16px', borderRadius: '10px', fontSize: '10px', fontWeight: 700,
            background: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(168,85,247,0.1))',
            border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc',
          }}>ENTER</div>
        </div>

        {/* ── Bottom Navigation ──────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          <button onClick={() => navigate('/leaderboard')} className="play-btn" style={{
            flex: 1, padding: '14px',
            background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)',
            borderRadius: '12px', color: '#f59e0b', fontSize: '11px', fontWeight: 700,
            letterSpacing: '2px', cursor: 'pointer', fontFamily: 'Orbitron, monospace',
          }}>LEADERBOARD</button>
          <a href="https://www.gooddollar.org" target="_blank" rel="noopener noreferrer" className="play-btn" style={{
            flex: 1, padding: '14px', textAlign: 'center', textDecoration: 'none',
            background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)',
            borderRadius: '12px', color: '#10b981', fontSize: '11px', fontWeight: 700,
            letterSpacing: '2px', fontFamily: 'Orbitron, monospace',
          }}>WHAT IS G$</a>
        </div>

        {/* ── Live Activity ──────────────────────────────────────────── */}
        {activity.length > 0 && (
          <div style={{
            padding: '14px 16px', marginBottom: '12px',
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.04)',
            borderRadius: '14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: '#10b981', boxShadow: '0 0 8px #10b981',
                animation: 'pulseGlow 2s ease-in-out infinite',
              }} />
              <span style={{ color: '#374151', fontSize: '9px', letterSpacing: '2px', fontWeight: 700 }}>LIVE</span>
            </div>
            {activity.slice(0, 4).map((item, i) => (
              <div key={`${item.player}-${item.timestamp}-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 8px', borderRadius: '8px', marginBottom: '4px',
                background: i === newIdx ? 'rgba(16,185,129,0.06)' : 'transparent',
              }}>
                <span style={{ fontSize: '14px' }}>{item.game === 'rhythm' ? '🎵' : '🧠'}</span>
                <span style={{ color: '#6b7280', fontSize: '10px', flex: 1 }}>
                  <span style={{ color: '#9ca3af' }}>{item.username || fmt(item.player)}</span>
                  <span style={{ color: '#374151' }}> · </span>
                  <span style={{ color: GAME_ACCENT[item.game], fontWeight: 700 }}>{item.score} pts</span>
                </span>
                <span style={{ color: '#1f2937', fontSize: '8px' }}>{timeAgo(item.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
