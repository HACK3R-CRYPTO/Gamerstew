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
    title:    'RHYTHM_RUSH',
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
    title:    'SIMON_MEMORY',
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

const GAME_LABELS = { rhythm: 'RHYTHM_RUSH', simon: 'SIMON_MEMORY' };
const GAME_ACCENT = { rhythm: '#a855f7', simon: '#06b6d4' };

// ── Live Activity Feed ───────────────────────────────────────────────────────
function ActivityFeed({ activity, newIdx }) {
  if (!activity.length) return null;
  return (
    <div style={{
      marginBottom: '14px', padding: '12px 14px',
      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '10px', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
        <span style={{
          display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%',
          background: '#10b981', boxShadow: '0 0 6px #10b981',
          animation: 'pulse 1.5s ease-in-out infinite',
        }} />
        <span style={{ color: '#4b5563', fontSize: '9px', letterSpacing: '2px', fontWeight: 700 }}>
          LIVE ACTIVITY
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {activity.slice(0, 5).map((item, i) => (
          <div key={`${item.player}-${item.timestamp}-${i}`} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '5px 8px', borderRadius: '6px',
            background: i === 0 && i === newIdx ? 'rgba(16,185,129,0.08)' : 'transparent',
            transition: 'background 0.5s',
            animation: i === newIdx ? 'slideIn 0.4s ease-out' : 'none',
          }}>
            <span style={{ fontSize: '13px' }}>{item.game === 'rhythm' ? '🎵' : '🧠'}</span>
            <span style={{ color: '#6b7280', fontSize: '10px', flex: 1, minWidth: 0 }}>
              <span style={{ color: '#9ca3af' }}>{fmt(item.player)}</span>
              <span style={{ color: '#4b5563' }}> scored </span>
              <span style={{ color: GAME_ACCENT[item.game], fontWeight: 700 }}>{item.score}</span>
              <span style={{ color: '#374151' }}> in {GAME_LABELS[item.game]}</span>
              {item.wagered && (
                <span style={{ color: '#a855f7', fontSize: '9px' }}> · {item.wagered} G$</span>
              )}
            </span>
            <span style={{ color: '#1f2937', fontSize: '9px' }}>
              {timeAgo(item.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── Stats Bar ────────────────────────────────────────────────────────────────
function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div style={{
      marginBottom: '16px', padding: '10px 14px',
      background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: '8px', display: 'flex', gap: '0', justifyContent: 'space-around',
    }}>
      {[
        { label: 'PLAYERS',         value: stats.totalUsers ?? 0,    accent: '#10b981' },
        { label: 'THIS WEEK',      value: stats.seasonUsers ?? 0,   accent: '#f59e0b' },
        { label: 'GAMES PLAYED',   value: stats.totalGames ?? 0,    accent: '#a855f7' },
        { label: 'G$ WAGERED',     value: stats.totalWagered ?? '0', accent: '#06b6d4' },
      ].map(({ label, value, accent }) => (
        <div key={label} style={{ textAlign: 'center' }}>
          <div style={{ color: accent, fontSize: '13px', fontWeight: 900 }}>{value}</div>
          <div style={{ color: '#374151', fontSize: '8px', letterSpacing: '1px', marginTop: '2px' }}>{label}</div>
        </div>
      ))}
    </div>
  );
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

      // 1. Approve G$
      toast.loading('Approving G$...', { id: 'wager' });
      await writeContractAsync({
        address: CONTRACT_ADDRESSES.G_TOKEN,
        abi:     ERC20_ABI,
        functionName: 'approve',
        args:    [SOLO_WAGER_ADDRESS, amountWei],
      });

      // 2. Create wager
      toast.loading('Locking wager on-chain...', { id: 'wager' });
      const txHash = await writeContractAsync({
        address: SOLO_WAGER_ADDRESS,
        abi:     SOLO_WAGER_ABI,
        functionName: 'createWager',
        args:    [amountWei, game.gameType],
      });

      // 3. Get wagerId from receipt logs
      let wagerId = null;
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        // WagerCreated event: topics[0] = event sig, topics[1] = wagerId, topics[2] = player
        // Find the log from our contract with indexed wagerId
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

  return (
    <>
      {/* Keyframe injector */}
      <style>{`
        @keyframes pulse {
          0%,100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.85); }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes glow {
          0%,100% { box-shadow: 0 0 4px currentColor; }
          50%      { box-shadow: 0 0 14px currentColor; }
        }
      `}</style>

      <div style={{ fontFamily: 'Orbitron, monospace', maxWidth: '560px', margin: '0 auto' }}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '10px', color: '#6b7280', letterSpacing: '3px', marginBottom: '6px' }}>
            SOLO GAMES — POWERED BY GOODDOLLAR
          </div>
          <h1 style={{ color: '#fff', fontSize: '24px', fontWeight: 900, margin: 0, letterSpacing: '2px' }}>
            GAME_ARENA
          </h1>
          <p style={{ color: '#4b5563', fontSize: '11px', marginTop: '6px', margin: '6px 0 0' }}>
            Play free or wager G$ — 2% of every wager funds GoodDollar UBI pool
          </p>
        </div>

        {/* ── Live Stats Bar ──────────────────────────────────────────── */}
        <StatsBar stats={stats} />

        {/* ── Season Countdown + Prize Pot ────────────────────────────── */}
        {stats && (
          <div style={{
            marginBottom: '16px', padding: '10px 16px',
            background: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(168,85,247,0.08) 100%)',
            border: '1px solid rgba(245,158,11,0.25)', borderRadius: '10px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ color: '#f59e0b', fontSize: '9px', letterSpacing: '2px', fontWeight: 700 }}>
                WEEK {stats.currentSeason} PRIZE POT
              </div>
              <div style={{ color: '#fff', fontSize: '18px', fontWeight: 900, marginTop: '2px' }}>
                {stats.estimatedPrizePot} <span style={{ color: '#a855f7', fontSize: '13px' }}>G$</span>
              </div>
              <div style={{ color: '#6b7280', fontSize: '9px', marginTop: '2px' }}>
                Top 3 split 60% / 30% / 10% per game
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#9ca3af', fontSize: '9px', letterSpacing: '1px' }}>ENDS IN</div>
              <div style={{ color: '#f59e0b', fontSize: '20px', fontWeight: 900 }}>
                {countdown || '—'}
              </div>
              <div style={{ color: '#374151', fontSize: '8px', marginTop: '2px' }}>
                then prizes auto-distribute
              </div>
            </div>
          </div>
        )}

        {/* ── Wallet / Identity strip ─────────────────────────────────── */}
        {isConnected ? (
          <div style={{
            marginBottom: '16px', padding: '12px 16px',
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
              <span style={{ color: '#9ca3af', fontSize: '11px' }}>{fmt(address)}</span>
            </div>
            <span style={{ color: '#a855f7', fontSize: '11px', fontWeight: 700 }}>{gBal} G$</span>
            {isVerified ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '3px 10px', borderRadius: '12px',
                background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)',
              }}>
                <span style={{ color: '#10b981', fontSize: '10px', fontWeight: 700 }}>✓ VERIFIED</span>
              </div>
            ) : (
              <button
                onClick={verifyIdentity}
                disabled={isVerifying}
                style={{
                  padding: '4px 12px', borderRadius: '12px', cursor: 'pointer',
                  background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.4)',
                  color: '#fbbf24', fontSize: '10px', fontWeight: 700, fontFamily: 'Orbitron, monospace',
                }}
              >
                {isVerifying ? 'VERIFYING...' : 'VERIFY IDENTITY'}
              </button>
            )}
            {canClaim && (
              <button
                onClick={claimG$}
                style={{
                  padding: '4px 12px', borderRadius: '12px', cursor: 'pointer',
                  background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)',
                  color: '#a855f7', fontSize: '10px', fontWeight: 700, fontFamily: 'Orbitron, monospace',
                }}
              >
                CLAIM {claimable} G$
              </button>
            )}

            {/* Badge row — full-width inside the strip */}
            {badges && badges.badges.length > 0 && (
              <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                {badges.summary.streakLabel && (
                  <span style={{
                    padding: '2px 8px', borderRadius: '8px', fontSize: '8px', fontWeight: 900, letterSpacing: '1px',
                    background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', color: '#f59e0b',
                  }}>
                    🔥 {badges.summary.streakLabel}
                  </span>
                )}
                {badges.badges.slice(0, 5).map((b, i) => <MiniChip key={i} badge={b} />)}
                {badges.badges.length > 5 && (
                  <span style={{ color: '#374151', fontSize: '9px' }}>+{badges.badges.length - 5}</span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{
            marginBottom: '16px', padding: '16px',
            background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(16,185,129,0.08))',
            border: '1px solid rgba(168,85,247,0.25)',
            borderRadius: '10px',
          }}>
            <div style={{ color: '#a855f7', fontSize: '12px', fontWeight: 900, letterSpacing: '2px', marginBottom: '8px' }}>
              GET STARTED
            </div>
            <div style={{ color: '#9ca3af', fontSize: '11px', lineHeight: '1.5', marginBottom: '12px' }}>
              1. Connect your wallet<br />
              2. Verify your identity via GoodDollar face scan<br />
              3. Claim free G$ (daily UBI) to play and wager
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => connect({ connector: injected() })}
                style={{
                  padding: '8px 18px', borderRadius: '8px', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
                  border: 'none', color: '#fff', fontSize: '11px', fontWeight: 700,
                  fontFamily: 'Orbitron, monospace', letterSpacing: '1px',
                }}
              >
                CONNECT WALLET
              </button>
              <a
                href="https://www.gooddollar.org/claim"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '8px 18px', borderRadius: '8px', textDecoration: 'none',
                  background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)',
                  color: '#10b981', fontSize: '11px', fontWeight: 700,
                  fontFamily: 'Orbitron, monospace', letterSpacing: '1px',
                }}
              >
                LEARN ABOUT G$
              </a>
            </div>
          </div>
        )}

        {/* ── Game Pass gate ──────────────────────────────────────────── */}
        {isConnected && !hasPass && (
          <div style={{
            marginBottom: '14px', padding: '16px',
            background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(6,182,212,0.08))',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: '10px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span style={{ fontSize: '28px' }}>🎮</span>
              <div>
                <div style={{ color: '#10b981', fontSize: '12px', fontWeight: 900, letterSpacing: '2px' }}>
                  MINT YOUR GAME PASS
                </div>
                <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '2px' }}>
                  Free NFT — pick a username to appear on the leaderboard
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Choose username..."
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16))}
                style={{
                  flex: 1, padding: '10px 14px',
                  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(16,185,129,0.3)',
                  borderRadius: '8px', color: '#fff', fontSize: '13px',
                  fontFamily: 'Orbitron, monospace', outline: 'none',
                }}
              />
              <button
                onClick={mintGamePass}
                disabled={mintingPass || usernameInput.length < 3}
                style={{
                  padding: '10px 20px', borderRadius: '8px', cursor: 'pointer',
                  background: usernameInput.length >= 3
                    ? 'linear-gradient(135deg, #10b981, #059669)'
                    : 'rgba(255,255,255,0.05)',
                  border: 'none', color: '#fff', fontSize: '11px', fontWeight: 700,
                  fontFamily: 'Orbitron, monospace', letterSpacing: '1px',
                  opacity: mintingPass || usernameInput.length < 3 ? 0.5 : 1,
                }}
              >
                {mintingPass ? 'MINTING...' : 'MINT PASS'}
              </button>
            </div>
            <div style={{ color: '#374151', fontSize: '9px', marginTop: '8px' }}>
              3-16 characters · letters, numbers, underscore only · soulbound (non-transferable)
            </div>
          </div>
        )}

        {/* Show username if they have a pass */}
        {isConnected && hasPass && username && (
          <div style={{
            marginBottom: '14px', padding: '8px 14px',
            background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span style={{ fontSize: '14px' }}>🎮</span>
            <span style={{ color: '#10b981', fontSize: '12px', fontWeight: 700 }}>{username}</span>
            <span style={{ color: '#374151', fontSize: '10px' }}>Game Pass #{totalUsers ? Number(totalUsers) : '...'}</span>
          </div>
        )}

        {/* ── Identity notice ─────────────────────────────────────────── */}
        {isConnected && !isVerified && (
          <div style={{
            marginBottom: '14px', padding: '10px 14px',
            background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: '8px', display: 'flex', gap: '10px', alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: '16px' }}>👤</span>
            <div>
              <div style={{ color: '#fbbf24', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', marginBottom: '2px' }}>
                GOODDOLLAR IDENTITY REQUIRED FOR WAGER MODE
              </div>
              <div style={{ color: '#6b7280', fontSize: '10px' }}>
                Verify once via face scan — prevents bots and protects your G$ wagers.
              </div>
            </div>
          </div>
        )}

        {/* ── Game cards ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px' }}>
          {GAMES.map((game) => {
            const isWager  = wagerMode[game.id];
            const amount   = wagerAmount[game.id] || '5';
            const loading  = pending === game.id;
            const canWager = isConnected && isVerified;

            // Find this player's best score for this game from activity
            const myBest = address
              ? activity.filter(a => a.game === game.id && a.player === address.toLowerCase())
                  .sort((a, b) => b.score - a.score)[0]?.score
              : null;

            return (
              <div key={game.id} style={{
                background:   game.faint,
                border:       `1px solid ${isWager ? game.accent : game.border}`,
                borderRadius: '12px', padding: '18px', transition: 'border-color 0.2s',
              }}>
                {/* Top row */}
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '36px' }}>{game.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: game.accent, fontSize: '14px', fontWeight: 900, letterSpacing: '2px' }}>
                      {game.title}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '11px', marginTop: '3px' }}>{game.desc}</div>
                  </div>
                  {/* Personal best badge */}
                  {myBest != null && (
                    <div style={{
                      textAlign: 'center', padding: '4px 8px',
                      background: `${game.accent}15`, border: `1px solid ${game.accent}40`,
                      borderRadius: '6px', minWidth: '50px',
                    }}>
                      <div style={{ color: game.accent, fontSize: '14px', fontWeight: 900 }}>{myBest}</div>
                      <div style={{ color: '#4b5563', fontSize: '8px', letterSpacing: '1px' }}>MY BEST</div>
                    </div>
                  )}
                </div>

                {/* Mode toggle */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                  <button
                    onClick={() => setWagerMode(p => ({ ...p, [game.id]: false }))}
                    style={{
                      flex: 1, padding: '7px',
                      background:   !isWager ? 'rgba(255,255,255,0.07)' : 'transparent',
                      border:       `1px solid ${!isWager ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}`,
                      borderRadius: '6px', color: !isWager ? '#e5e7eb' : '#4b5563',
                      fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
                      cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                    }}
                  >
                    FREE PLAY
                  </button>
                  {!game.noWager && (
                    <button
                      onClick={() => {
                        if (!canWager && isConnected) {
                          toast('Verify your GoodDollar identity first', { icon: '👤' });
                          return;
                        }
                        setWagerMode(p => ({ ...p, [game.id]: true }));
                      }}
                      style={{
                        flex: 1, padding: '7px',
                        background:   isWager ? `${game.accent}22` : 'transparent',
                        border:       `1px solid ${isWager ? game.accent : 'rgba(255,255,255,0.05)'}`,
                        borderRadius: '6px',
                        color:        isWager ? game.accent : canWager ? '#6b7280' : '#374151',
                        fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
                        cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                        opacity: !canWager ? 0.6 : 1,
                      }}
                    >
                      {!canWager && isConnected ? '🔒 WAGER G$' : 'WAGER G$'}
                    </button>
                  )}
                </div>

                {/* Wager config */}
                {isWager && (
                  <div style={{
                    marginBottom: '12px', padding: '10px 12px',
                    background: 'rgba(0,0,0,0.25)', borderRadius: '8px',
                    border: `1px solid ${game.accent}25`,
                  }}>
                    <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px', marginBottom: '8px' }}>
                      SELECT WAGER (G$)
                    </div>
                    <div style={{ display: 'flex', gap: '5px', marginBottom: '10px', flexWrap: 'wrap' }}>
                      {WAGER_AMOUNTS.map(amt => (
                        <button key={amt}
                          onClick={() => setWagerAmount(p => ({ ...p, [game.id]: amt }))}
                          style={{
                            padding: '4px 10px',
                            background:   amount === amt ? `${game.accent}33` : 'rgba(255,255,255,0.04)',
                            border:       `1px solid ${amount === amt ? game.accent : 'rgba(255,255,255,0.07)'}`,
                            borderRadius: '4px', color: amount === amt ? game.accent : '#6b7280',
                            fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                            fontFamily: 'Orbitron, monospace',
                          }}
                        >{amt}</button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                      <span style={{ color: '#6b7280' }}>
                        Win if: <span style={{ color: '#e5e7eb' }}>{game.winAt}</span>
                      </span>
                      <span style={{ color: '#6b7280' }}>
                        Payout: <span style={{ color: '#10b981', fontWeight: 700 }}>
                          {(parseFloat(amount) * 1.3).toFixed(1)} G$
                        </span>
                      </span>
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '9px', color: '#374151' }}>
                      2% of wager → GoodDollar UBI Pool
                    </div>
                  </div>
                )}

                {/* Play button */}
                <button
                  onClick={() => handlePlay(game)}
                  disabled={loading}
                  style={{
                    width: '100%', padding: '11px',
                    background:   isWager
                      ? `linear-gradient(135deg, ${game.accent}cc, ${game.accent}88)`
                      : 'rgba(255,255,255,0.05)',
                    border:       `1px solid ${isWager ? game.accent : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: '8px',
                    color:        isWager ? '#fff' : '#d1d5db',
                    fontSize:     '12px', fontWeight: 900, letterSpacing: '2px',
                    cursor:       loading ? 'not-allowed' : 'pointer',
                    fontFamily:   'Orbitron, monospace',
                    opacity:      loading ? 0.7 : 1,
                    animation:    isWager ? 'glow 2.5s ease-in-out infinite' : 'none',
                  }}
                >
                  {loading
                    ? 'PROCESSING...'
                    : isWager
                      ? `WAGER ${amount} G$ — PLAY`
                      : 'FREE PLAY →'}
                </button>
              </div>
            );
          })}
        </div>

        {/* ── Live Activity Feed ───────────────────────────────────────── */}
        <ActivityFeed activity={activity} newIdx={newIdx} />

        {/* ── AI Agent banner ─────────────────────────────────────────── */}
        <div
          onClick={() => navigate('/')}
          style={{
            marginBottom: '12px', padding: '14px 18px',
            background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.18)',
            borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '14px',
            cursor: 'pointer', transition: 'border-color 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(168,85,247,0.45)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(168,85,247,0.18)'}
        >
          <span style={{ fontSize: '26px' }}>🤖</span>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#a855f7', fontSize: '12px', fontWeight: 900, letterSpacing: '1px' }}>
              MARKOV-1 — PvP WAGER MATCHES
            </div>
            <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '2px' }}>
              Challenge the AI agent in RPS, Dice, Coin Flip or Strategy Battle.
            </div>
          </div>
          <span style={{ color: '#a855f7', fontSize: '18px' }}>›</span>
        </div>

        {/* ── Bottom row ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { label: 'LEADERBOARD', path: '/leaderboard' },
            { label: '← ARENA',    path: '/' },
          ].map(b => (
            <button key={b.path} onClick={() => navigate(b.path)} style={{
              flex: 1, padding: '11px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '8px', color: '#6b7280', fontSize: '11px', fontWeight: 700,
              letterSpacing: '1px', cursor: 'pointer', fontFamily: 'Orbitron, monospace',
            }}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
