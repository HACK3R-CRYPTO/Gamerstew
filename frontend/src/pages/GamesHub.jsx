import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { useIsMiniPay } from '../hooks/useMiniPay';
import { parseUnits, formatUnits } from 'viem';
import { CONTRACT_ADDRESSES, ERC20_ABI, SOLO_WAGER_ABI, SOLO_WAGER_ADDRESS, GAME_PASS_ABI } from '../config/contracts';
import { useSelfVerification } from '../contexts/SelfVerificationContext';
import { toast } from 'react-hot-toast';
import { checkNewHighScores, getPlayStreak } from '../utils/gameUtils';

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
  const { address: wagmiAddress } = useAccount();
  const { login, authenticated, ready, user } = usePrivy();

  const isMiniPay = useIsMiniPay();
  // In MiniPay, treat injected wallet as connected even without Privy auth
  const isConnected = (ready && authenticated) || (isMiniPay && !!wagmiAddress);
  const privyAddr   = user?.wallet?.address;
  const address     = wagmiAddress || privyAddr;

  const { isVerified, isVerifying, verifyIdentity, claimG$, entitlement } = useSelfVerification();

  const [wagerMode,   setWagerMode]   = useState({});
  const [wagerAmount, setWagerAmount] = useState({});
  const [pending,     setPending]     = useState(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [mintingPass,   setMintingPass]   = useState(false);
  const [playStreak, setPlayStreak] = useState({ streak: 0, playedToday: false });

  // Fetch streak from backend
  useEffect(() => {
    if (address) getPlayStreak(address).then(setPlayStreak);
  }, [address]);

  // Live score notifications
  useEffect(() => {
    const interval = setInterval(() => {
      checkNewHighScores(BACKEND_URL, (msg) => {
        toast(msg, { icon: '🎯', duration: 4000, style: { background: '#1a1a2e', color: '#fff', border: '1px solid rgba(168,85,247,0.3)', fontFamily: 'Orbitron, monospace', fontSize: '11px' } });
      });
    }, 15000);
    return () => clearInterval(interval);
  }, []);

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
        ...(isMiniPay && { type: 'legacy' }),
      });
      toast.success(`Welcome, ${usernameInput}!`, { id: 'mint-pass' });
      // Wait for chain state to update before refetching
      setTimeout(() => {
        refetchPass();
        refetchUsername();
      }, 3000);
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

  // CELO balance for gas check
  const [requestingGas, setRequestingGas] = useState(false);
  const [gasReceived, setGasReceived] = useState(false);

  const handlePlay = async (game, forceWager = false) => {
    const isWager = forceWager || wagerMode[game.id];
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
        ...(isMiniPay && { type: 'legacy' }),
      });

      toast.loading('Locking wager on-chain...', { id: 'wager' });
      const txHash = await writeContractAsync({
        address: SOLO_WAGER_ADDRESS,
        abi:     SOLO_WAGER_ABI,
        functionName: 'createWager',
        args:    [amountWei, game.gameType],
        ...(isMiniPay && { type: 'legacy' }),
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
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .gc:hover { transform: translateY(-3px) !important; box-shadow: 0 8px 30px rgba(0,0,0,0.3) !important; }
        .gb:hover { filter: brightness(1.15); transform: scale(1.01); }
        .gc, .gb { transition: all 0.25s ease; }
      `}</style>

      <div style={{ fontFamily: 'Orbitron, monospace', maxWidth: '520px', margin: '0 auto' }}>

        {/* ── Player Bar (compact) ──────────────────────────────────── */}
        {isConnected && username ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px',
            padding: '10px 14px', borderRadius: '14px',
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <img
              src={`https://api.dicebear.com/9.x/pixel-art/svg?seed=${address}`}
              alt="avatar"
              style={{
                width: '34px', height: '34px', borderRadius: '10px',
                background: 'linear-gradient(135deg, #a855f7, #06b6d4)',
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#fff', fontSize: '13px', fontWeight: 900 }}>{username}</span>
                {playStreak.streak >= 1 && (
                  <span style={{
                    padding: '1px 6px', borderRadius: '8px', fontSize: '8px', fontWeight: 700,
                    background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
                    color: '#f59e0b',
                  }}>
                    🔥 {playStreak.streak}d
                  </span>
                )}
              </div>
              <div style={{ color: '#4b5563', fontSize: '8px', marginTop: '1px' }}>{gBal} G$</div>
            </div>
            {isVerified ? (
              <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '8px', fontWeight: 700, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981' }}>VERIFIED</span>
            ) : (
              <button onClick={verifyIdentity} disabled={isVerifying} className="gb" style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '8px', fontWeight: 700, cursor: 'pointer', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', fontFamily: 'Orbitron, monospace' }}>{isVerifying ? '...' : 'VERIFY'}</button>
            )}
            {canClaim && (
              <button onClick={claimG$} className="gb" style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '8px', fontWeight: 700, cursor: 'pointer', background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.35)', color: '#c084fc', fontFamily: 'Orbitron, monospace' }}>CLAIM</button>
            )}
          </div>
        ) : !isConnected ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '14px', padding: '12px 16px', borderRadius: '14px',
            background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)',
          }}>
            <div>
              <div style={{ color: '#fff', fontSize: '13px', fontWeight: 900, letterSpacing: '2px' }}>GAME<span style={{ color: '#a855f7' }}>_</span>ARENA</div>
              <div style={{ color: '#4b5563', fontSize: '9px', marginTop: '2px' }}>Play · Earn G$ · Fund UBI</div>
            </div>
            <button onClick={() => login()} className="gb" style={{
              padding: '10px 20px', borderRadius: '12px', cursor: 'pointer',
              background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
              border: 'none', color: '#fff', fontSize: '10px', fontWeight: 700,
              fontFamily: 'Orbitron, monospace', letterSpacing: '1px',
            }}>CONNECT</button>
          </div>
        ) : isConnected && !!!wagmiAddress ? (
          /* Privy authenticated but wallet connector not ready yet — per Privy docs, wait for wallet.isConnected */
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px',
            padding: '12px 16px', borderRadius: '14px',
            background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)',
          }}>
            <div style={{
              width: '16px', height: '16px', borderRadius: '50%',
              border: '2px solid #a855f7', borderTopColor: 'transparent',
              animation: 'spin 0.8s linear infinite', flexShrink: 0,
            }} />
            <div style={{ color: '#9ca3af', fontSize: '10px', letterSpacing: '1px' }}>SETTING UP WALLET...</div>
          </div>
        ) : null}

        {/* ── Season Strip ──────────────────────────────────────────── */}
        {stats && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0', marginBottom: '16px',
            borderRadius: '12px', overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.05)',
          }}>
            {[
              { val: totalUsers ? Number(totalUsers) : (stats.totalUsers ?? 0), lab: 'PLAYERS', col: '#10b981' },
              { val: stats.totalGames ?? 0, lab: 'GAMES', col: '#a855f7' },
              { val: stats.estimatedPrizePot, lab: 'POT G$', col: '#f59e0b' },
              { val: countdown || '—', lab: `WK ${stats.currentSeason}`, col: '#06b6d4' },
            ].map((s, i) => (
              <div key={s.lab} style={{
                flex: 1, textAlign: 'center', padding: '10px 4px',
                background: 'rgba(0,0,0,0.2)',
                borderRight: i < 3 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              }}>
                <div style={{ color: s.col, fontSize: '15px', fontWeight: 900 }}>{s.val}</div>
                <div style={{ color: '#2a2a3a', fontSize: '7px', letterSpacing: '0.5px', marginTop: '2px' }}>{s.lab}</div>
              </div>
            ))}
          </div>
        )}

        {/* Badges inline */}
        {badges && badges.badges.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginBottom: '14px' }}>
            {badges.summary.streakLabel && (
              <span style={{ padding: '3px 8px', borderRadius: '8px', fontSize: '8px', fontWeight: 900, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}>{badges.summary.streakLabel}</span>
            )}
            {badges.badges.slice(0, 5).map((b, i) => <MiniChip key={i} badge={b} />)}
          </div>
        )}

        {/* ── Gas Faucet ──────────────────────────────────────────────── */}
        {isConnected && !!wagmiAddress && !gasReceived && (
          <div style={{
            marginBottom: '14px', padding: '12px 16px',
            background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.15)',
            borderRadius: '12px', display: 'flex', gap: '12px', alignItems: 'center',
          }}>
            <span style={{ fontSize: '18px' }}>⛽</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#06b6d4', fontSize: '10px', fontWeight: 700, letterSpacing: '1px' }}>
                NEED GAS?
              </div>
              <div style={{ color: '#4b5563', fontSize: '9px', marginTop: '2px' }}>
                {isVerified 
                  ? 'Get free 0.025 CELO for transactions (one time)' 
                  : 'Verify your humanity to unlock free gas'}
              </div>
            </div>
            <button
              onClick={async () => {
                if (!isVerified) {
                  toast('Please verify your humanity first to prevent spam.', { icon: '🛡️' });
                  return;
                }
                setRequestingGas(true);
                try {
                  const res = await fetch(`${BACKEND_URL}/api/faucet`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address }),
                  });
                  const data = await res.json();
                  if (data.success) {
                    toast.success('0.025 CELO sent to your wallet!');
                    setGasReceived(true);
                  } else {
                    toast(data.reason || 'Already received', { icon: 'ℹ️' });
                    setGasReceived(true);
                  }
                } catch (_) {
                  toast.error('Faucet failed');
                }
                setRequestingGas(false);
              }}
              disabled={requestingGas}
              className="gb"
              style={{
                padding: '6px 14px', borderRadius: '10px', cursor: 'pointer',
                background: isVerified ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.05)', 
                border: isVerified ? '1px solid rgba(6,182,212,0.3)' : '1px solid rgba(255,255,255,0.1)',
                color: isVerified ? '#06b6d4' : '#9ca3af', 
                fontSize: '10px', fontWeight: 700,
                fontFamily: 'Orbitron, monospace',
                opacity: requestingGas ? 0.5 : 1,
              }}
            >
              {requestingGas ? '...' : isVerified ? 'GET GAS' : 'VERIFY TO CLAIM'}
            </button>
          </div>
        )}

        {/* ── Game Pass Gate ─────────────────────────────────────────── */}
        {/* !!wagmiAddress = wallet.isConnected per Privy docs — the official ready signal */}
        {isConnected && !!wagmiAddress && !hasPass && (
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '14px' }}>
          {GAMES.map((game, gi) => {
            const loading  = pending === game.id;
            const canWager = isConnected && isVerified && !game.noWager;
            const myBest = address
              ? activity.filter(a => a.game === game.id && a.player === address.toLowerCase())
                  .sort((a, b) => b.score - a.score)[0]?.score
              : null;

            return (
              <div key={game.id} className="gc" style={{
                position: 'relative', overflow: 'hidden',
                borderRadius: '16px', padding: '22px 20px 18px',
                background: `linear-gradient(145deg, ${game.accent}14 0%, rgba(6,6,14,0.97) 60%)`,
                border: `1px solid ${game.border}`,
                animation: `slideUp 0.35s ease-out ${gi * 0.1}s both`,
              }}>
                {/* Accent glow top-left */}
                <div style={{
                  position: 'absolute', top: '-30px', left: '-30px', width: '120px', height: '120px',
                  borderRadius: '50%', background: `radial-gradient(circle, ${game.accent}12 0%, transparent 70%)`,
                  pointerEvents: 'none',
                }} />

                <div style={{ position: 'relative', zIndex: 1 }}>
                  {/* Top row: icon + info */}
                  <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{
                      width: '52px', height: '52px', borderRadius: '14px',
                      background: `${game.accent}15`, border: `1px solid ${game.accent}25`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '26px', flexShrink: 0,
                      animation: `float 3.5s ease-in-out infinite ${gi * 0.6}s`,
                    }}>{game.emoji}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#fff', fontSize: '15px', fontWeight: 900, letterSpacing: '1.5px' }}>
                          {game.title}
                        </span>
                        {myBest != null && (
                          <span style={{
                            padding: '2px 8px', borderRadius: '10px', fontSize: '8px', fontWeight: 900,
                            background: `${game.accent}15`, color: game.accent,
                          }}>PB {myBest}</span>
                        )}
                      </div>
                      <div style={{ color: '#4b5563', fontSize: '10px', marginTop: '3px' }}>{game.desc}</div>
                    </div>
                  </div>

                  {/* Action buttons — PLAY (always) + WAGER (if eligible) */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => navigate(game.path)}
                      disabled={loading}
                      className="gb"
                      style={{
                        flex: 2, padding: '14px',
                        background: `linear-gradient(135deg, ${game.accent}30, ${game.accent}12)`,
                        border: `1px solid ${game.accent}40`,
                        borderRadius: '12px', color: game.accent,
                        fontSize: '12px', fontWeight: 900, letterSpacing: '2px',
                        cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                      }}
                    >
                      {game.id === 'rhythm' ? 'TAP TO PLAY' : 'START GAME'}
                    </button>
                    {canWager && (
                      <button
                        onClick={() => setWagerMode(p => ({ ...p, [game.id]: !p[game.id] }))}
                        disabled={loading}
                        className="gb"
                        style={{
                          flex: 1, padding: '14px',
                          background: wagerMode[game.id]
                            ? `${game.accent}30`
                            : `linear-gradient(135deg, ${game.accent}, ${game.accent}aa)`,
                          border: wagerMode[game.id] ? `1px solid ${game.accent}` : 'none',
                          borderRadius: '12px', color: '#fff',
                          fontSize: '10px', fontWeight: 900, letterSpacing: '1px',
                          cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                          boxShadow: `0 4px 15px ${game.accent}25`,
                        }}
                      >
                        {loading ? '...' : 'WAGER G$'}
                      </button>
                    )}
                  </div>

                  {/* Wager amount picker — shown when WAGER G$ is toggled */}
                  {wagerMode[game.id] && (
                    <div style={{
                      marginTop: '10px', padding: '12px',
                      background: 'rgba(0,0,0,0.3)', border: `1px solid ${game.accent}30`,
                      borderRadius: '12px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ color: '#6b7280', fontSize: '9px', letterSpacing: '1px' }}>WAGER AMOUNT</span>
                        <span style={{ color: '#10b981', fontSize: '10px', fontWeight: 700 }}>
                          WIN: {(parseFloat(wagerAmount[game.id] || '5') * 1.3).toFixed(1)} G$
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                        {['1', '5', '10', '25', '50'].map(amt => (
                          <button key={amt}
                            onClick={() => setWagerAmount(p => ({ ...p, [game.id]: amt }))}
                            style={{
                              flex: 1, padding: '8px 4px', borderRadius: '8px', cursor: 'pointer',
                              background: (wagerAmount[game.id] || '5') === amt ? `${game.accent}25` : 'rgba(255,255,255,0.03)',
                              border: `1px solid ${(wagerAmount[game.id] || '5') === amt ? game.accent : 'rgba(255,255,255,0.06)'}`,
                              color: (wagerAmount[game.id] || '5') === amt ? game.accent : '#4b5563',
                              fontSize: '11px', fontWeight: 700, fontFamily: 'Orbitron, monospace',
                            }}
                          >{amt}</button>
                        ))}
                      </div>
                      <button
                        onClick={() => handlePlay({ ...game }, true)}
                        disabled={loading}
                        className="gb"
                        style={{
                          width: '100%', padding: '12px', borderRadius: '10px', cursor: 'pointer',
                          background: `linear-gradient(135deg, ${game.accent}, ${game.accent}cc)`,
                          border: 'none', color: '#fff',
                          fontSize: '11px', fontWeight: 900, letterSpacing: '1px',
                          fontFamily: 'Orbitron, monospace',
                          boxShadow: `0 4px 15px ${game.accent}30`,
                        }}
                      >
                        {loading ? 'LOCKING...' : `LOCK ${wagerAmount[game.id] || '5'} G$ & PLAY`}
                      </button>
                    </div>
                  )}

                  {/* Wager info hint */}
                  {!game.noWager && (
                    <div style={{ display: 'flex', gap: '12px', marginTop: '10px', justifyContent: 'center' }}>
                      <span style={{ color: '#2a2a3a', fontSize: '8px' }}>WIN: <span style={{ color: '#4b5563' }}>{game.winAt}</span></span>
                      <span style={{ color: '#2a2a3a', fontSize: '8px' }}>PAYOUT: <span style={{ color: '#10b981' }}>{game.payout}</span></span>
                      <span style={{ color: '#2a2a3a', fontSize: '8px' }}>2% → UBI</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── AI + Nav row ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <div onClick={() => navigate('/arena')} className="gc" style={{
            flex: 2, padding: '14px 16px', cursor: 'pointer',
            background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)',
            borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <span style={{ fontSize: '22px' }}>🤖</span>
            <div>
              <div style={{ color: '#a855f7', fontSize: '11px', fontWeight: 900, letterSpacing: '1px' }}>CHALLENGE AI</div>
              <div style={{ color: '#374151', fontSize: '8px', marginTop: '2px' }}>PvP vs Markov-1</div>
            </div>
          </div>
          <button onClick={() => navigate('/leaderboard')} className="gb" style={{
            flex: 1, padding: '14px',
            background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.12)',
            borderRadius: '14px', color: '#f59e0b', fontSize: '10px', fontWeight: 700,
            letterSpacing: '1px', cursor: 'pointer', fontFamily: 'Orbitron, monospace',
          }}>SCORES</button>
        </div>

        {/* Live Activity — removed to reduce clutter */}
      </div>
    </>
  );
}
