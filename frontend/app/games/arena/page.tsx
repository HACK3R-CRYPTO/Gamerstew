'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useReadContract, useWriteContract, usePublicClient, useBalance } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { BookOpen } from 'lucide-react';
import { parseUnits, formatUnits, encodeAbiParameters } from 'viem';
import { CONTRACT_ADDRESSES, ARENA_PLATFORM_ABI, ERC8004_REGISTRY_ABI, ERC20_ABI } from '@/lib/contracts';
import { rollDice } from '@/app/actions/game';
import { toast } from 'react-hot-toast';
import { useArenaEvents } from '@/hooks/useArenaEvents';
import { MATCH_STATUS, GAME_TYPES, MOVES, getMoveDisplay } from '@/lib/gameLogic';
import { useSelfVerification } from '@/contexts/SelfVerificationContext';

interface Match {
  id: number;
  challenger: string;
  opponent: string;
  wager: bigint;
  gameType: number;
  status: number;
  winner: string;
  createdAt: number;
  challengerMove: number | null;
  opponentMove: number | null;
}

interface AgentProfile {
  name?: string;
  model?: string;
  description?: string;
  wallet?: string;
  active: boolean;
}

export default function ArenaGame() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance({
    address,
    query: { refetchInterval: false, staleTime: 30000 },
  });
  const { login, getAccessToken } = usePrivy();
  const publicClient = usePublicClient();

  const { isVerified, isVerifying, verifyIdentity, cancelVerification, claimG$, entitlement } = useSelfVerification();
  const [wager, setWager] = useState('0.1');
  const [selectedGameType, setSelectedGameType] = useState(0);
  const [matches, setMatches] = useState<Match[]>([]);
  const [globalMatches, setGlobalMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeMatch, setActiveMatch] = useState<Match | null>(null);
  const [leaderboard, setLeaderboard] = useState<{ address: string; count: number; isAi: boolean }[]>([]);
  const [waitingMatchId, setWaitingMatchId] = useState<number | null>(null);
  const [playedMoveIds, setPlayedMoveIds] = useState<Set<number>>(new Set());

  const agentTokenId = CONTRACT_ADDRESSES.AGENT_TOKEN_ID ? BigInt(CONTRACT_ADDRESSES.AGENT_TOKEN_ID) : null;

  const { data: agentTokenURI } = useReadContract({
    address: CONTRACT_ADDRESSES.ERC8004_REGISTRY as `0x${string}`,
    abi: ERC8004_REGISTRY_ABI,
    functionName: 'tokenURI',
    args: agentTokenId ? [agentTokenId] : undefined,
    query: { enabled: !!agentTokenId },
  });

  const { data: agentWallet } = useReadContract({
    address: CONTRACT_ADDRESSES.ERC8004_REGISTRY as `0x${string}`,
    abi: ERC8004_REGISTRY_ABI,
    functionName: 'getAgentWallet',
    args: agentTokenId ? [agentTokenId] : undefined,
    query: { enabled: !!agentTokenId },
  });

  const [agentProfile, setAgentProfile] = useState<AgentProfile>({ active: false });

  useEffect(() => {
    if (!agentTokenURI) return;
    try {
      let meta: { name?: string; model?: string; description?: string };
      if ((agentTokenURI as string).startsWith('data:application/json;base64,')) {
        meta = JSON.parse(atob((agentTokenURI as string).split(',')[1]));
      } else if ((agentTokenURI as string).startsWith('{')) {
        meta = JSON.parse(agentTokenURI as string);
      } else {
        fetch(agentTokenURI as string)
          .then(r => r.json())
          .then(m => {
            setAgentProfile({ name: m.name || 'Markov-1', model: m.model || 'Celo AI', description: m.description || '', wallet: (agentWallet as string) || CONTRACT_ADDRESSES.AI_AGENT, active: true });
          })
          .catch(() => { });
        return;
      }
      setAgentProfile({ name: meta.name || 'Markov-1', model: meta.model || 'Celo AI', description: meta.description || '', wallet: (agentWallet as string) || CONTRACT_ADDRESSES.AI_AGENT, active: true });
    } catch {
      setAgentProfile({ active: !!agentTokenId });
    }
  }, [agentTokenURI, agentWallet, agentTokenId]);

  const { writeContractAsync: writeArena } = useWriteContract();

  const fetchMatchDetails = useCallback(async (ids: readonly bigint[] | bigint[]) => {
    if (!ids || !publicClient) return;
    try {
      const matchContracts = ids.map(id => ({
        address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
        abi: ARENA_PLATFORM_ABI,
        functionName: 'matches' as const,
        args: [id] as const,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matchResults = await publicClient.multicall({ contracts: matchContracts as any });
      const moveContractCalls: { address: `0x${string}`; abi: typeof ARENA_PLATFORM_ABI; functionName: 'hasPlayed'; args: [bigint, string] }[] = [];
      const moveChecksMap: { index: number; isChallenger: boolean }[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      matchResults.forEach((res: any, index: number) => {
        if (res.status === 'success') {
          const m = res.result;
          const id = ids[index];
          const status = Number(m[5]);
          if (status === 1 || status === 2) {
            moveChecksMap.push({ index, isChallenger: true });
            moveChecksMap.push({ index, isChallenger: false });
            moveContractCalls.push({ address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_PLATFORM_ABI, functionName: 'hasPlayed', args: [id, m[1]] });
            moveContractCalls.push({ address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_PLATFORM_ABI, functionName: 'hasPlayed', args: [id, m[2]] });
          }
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let moveResults: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (moveContractCalls.length > 0) moveResults = [...await publicClient.multicall({ contracts: moveContractCalls as any })];

      const actualMoveCalls: { address: `0x${string}`; abi: typeof ARENA_PLATFORM_ABI; functionName: 'playerMoves'; args: [bigint, string] }[] = [];
      const actualMoveIndices: { index: number; isChallenger: boolean }[] = [];
      let moveResultIndex = 0;
      const matchesWithMoves = new Map<number, { challengerPlayed: boolean; opponentPlayed: boolean }>();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      matchResults.forEach((res: any, index: number) => {
        if (res.status !== 'success') return;
        const m = res.result;
        const id = ids[index];
        const status = Number(m[5]);
        if (status === 1 || status === 2) {
          const challengerPlayed = moveResults[moveResultIndex]?.status === 'success' && moveResults[moveResultIndex]?.result;
          moveResultIndex++;
          const opponentPlayed = moveResults[moveResultIndex]?.status === 'success' && moveResults[moveResultIndex]?.result;
          moveResultIndex++;
          matchesWithMoves.set(index, { challengerPlayed, opponentPlayed });
          if (challengerPlayed) { actualMoveIndices.push({ index, isChallenger: true }); actualMoveCalls.push({ address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_PLATFORM_ABI, functionName: 'playerMoves', args: [id, m[1]] }); }
          if (opponentPlayed) { actualMoveIndices.push({ index, isChallenger: false }); actualMoveCalls.push({ address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_PLATFORM_ABI, functionName: 'playerMoves', args: [id, m[2]] }); }
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let actualMovesResults: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (actualMoveCalls.length > 0) actualMovesResults = [...await publicClient.multicall({ contracts: actualMoveCalls as any })];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matchDetails: Match[] = matchResults.map((res: any, index: number) => {
        if (res.status !== 'success') return null;
        const m = res.result;
        const id = ids[index];
        let challengerMove: number | null = null;
        let opponentMove: number | null = null;
        if (matchesWithMoves.has(index)) {
          const cMoveIdx = actualMoveIndices.findIndex(x => x.index === index && x.isChallenger);
          if (cMoveIdx !== -1 && actualMovesResults[cMoveIdx]?.status === 'success') challengerMove = Number(actualMovesResults[cMoveIdx].result);
          const oMoveIdx = actualMoveIndices.findIndex(x => x.index === index && !x.isChallenger);
          if (oMoveIdx !== -1 && actualMovesResults[oMoveIdx]?.status === 'success') opponentMove = Number(actualMovesResults[oMoveIdx].result);
        }
        return { id: Number(id), challenger: m[1], opponent: m[2], wager: m[3], gameType: Number(m[4]), status: Number(m[5]), winner: m[6], createdAt: Number(m[7]), challengerMove, opponentMove };
      }).filter((m: Match | null): m is Match => m !== null);

      setMatches(matchDetails.sort((a, b) => b.id - a.id));
    } catch (error) {
      console.error('Error fetching matches:', error);
    }
  }, [publicClient]);

  const fetchGlobalMatches = useCallback(async () => {
    if (!publicClient) return;
    try {
      const count = await publicClient.readContract({ address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_PLATFORM_ABI, functionName: 'matchCounter' });
      const total = Number(count);
      const start = Math.max(0, total - 100);
      const ids = Array.from({ length: total - start }, (_, i) => BigInt(total - 1 - i));
      if (ids.length === 0) return;

      const matchContracts = ids.map(id => ({ address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_PLATFORM_ABI, functionName: 'matches' as const, args: [id] as const }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = [...await publicClient.multicall({ contracts: matchContracts as any })];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matchDetails: Match[] = results.reduce((acc: Match[], res: any, index: number) => {
        if (res.status === 'failure' || !res.result) return acc;
        const m = res.result;
        acc.push({ id: Number(ids[index]), challenger: m[1], opponent: m[2], wager: m[3], gameType: Number(m[4]), status: Number(m[5]), winner: m[6], createdAt: Number(m[7]), challengerMove: null, opponentMove: null });
        return acc;
      }, []);

      setGlobalMatches(matchDetails);
    } catch { /* ignore */ }
  }, [publicClient]);

  useEffect(() => {
    if (globalMatches.length === 0) return;
    const wins: Record<string, number> = {};
    globalMatches.forEach(m => {
      if (m.status === 2 && m.winner && m.winner !== '0x0000000000000000000000000000000000000000') {
        const winner = m.winner.toLowerCase();
        wins[winner] = (wins[winner] || 0) + 1;
      }
    });
    const sorted = Object.entries(wins)
      .map(([addr, count]) => ({ address: addr, count, isAi: addr.toLowerCase() === CONTRACT_ADDRESSES.AI_AGENT.toLowerCase() }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    setLeaderboard(sorted);
  }, [globalMatches]);

  useEffect(() => { fetchGlobalMatches(); }, [fetchGlobalMatches]);

  const { data: playerMatchIds, refetch: refetchMatches } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: 'getPlayerMatches',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: false, staleTime: 10000 },
  });

  const playerMatchIdsRef = useRef(playerMatchIds);

  useEffect(() => {
    const prevIds = playerMatchIdsRef.current;
    const currentIds = playerMatchIds;
    const hasChanged = !prevIds || !currentIds || prevIds.length !== currentIds.length || !(prevIds as bigint[]).every((val, index) => val === (currentIds as bigint[])[index]);
    playerMatchIdsRef.current = playerMatchIds;

    if (playerMatchIds && (matches.length === 0 || hasChanged)) fetchMatchDetails(playerMatchIds as bigint[]);
  }, [playerMatchIds, matches.length, fetchMatchDetails]);

  useEffect(() => {
    if (!waitingMatchId || activeMatch) return;
    const ready = matches.find(m => m.id === waitingMatchId && m.status === 1);
    if (ready) { setActiveMatch(ready); setWaitingMatchId(null); toast.success('AI accepted! Make your move!', { duration: 3000 }); }
  }, [matches, waitingMatchId, activeMatch]);

  useEffect(() => {
    const completedIds = matches.filter(m => m.status === 2).map(m => m.id);
    if (completedIds.length > 0) {
      setPlayedMoveIds(prev => {
        const next = new Set(prev);
        completedIds.forEach(id => next.delete(id));
        return next.size !== prev.size ? next : prev;
      });
    }
  }, [matches]);

  useEffect(() => {
    if (!waitingMatchId) return;
    const fast = setInterval(() => {
      refetchMatches().then(({ data: freshIds }) => { if (freshIds) fetchMatchDetails(freshIds as bigint[]); });
    }, 3000);
    return () => clearInterval(fast);
  }, [waitingMatchId, refetchMatches, fetchMatchDetails]);

  useArenaEvents({
    onMatchUpdate: async () => {
      const { data: freshIds } = await refetchMatches();
      if (freshIds) fetchMatchDetails(freshIds as bigint[]);
    },
    onGlobalUpdate: fetchGlobalMatches,
    address,
    matches,
  });

  useEffect(() => {
    if (!isConnected || !address) return;
    const interval = setInterval(() => {
      refetchMatches().then(({ data: freshIds }) => { if (freshIds) fetchMatchDetails(freshIds as bigint[]); });
      fetchGlobalMatches();
    }, 30000);
    return () => clearInterval(interval);
  }, [address, isConnected, refetchMatches, fetchMatchDetails, fetchGlobalMatches]);

  useEffect(() => {
    const handleVisibilityChange = () => { if (!document.hidden && isConnected) refetchMatches(); };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refetchMatches, isConnected]);

  const handlePlayMove = async (matchId: number, move: number) => {
    if (!publicClient || !activeMatch) return;
    setLoading(true);
    const toastId = toast.loading('Submitting move...');
    try {
      const hash = await writeArena({ address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_PLATFORM_ABI, functionName: 'playMove', args: [BigInt(matchId), move] });
      toast.loading('Confirming transaction...', { id: toastId });
      await publicClient.waitForTransactionReceipt({ hash });

      let moveLabel = '';
      if (activeMatch.gameType === 0) moveLabel = ['Rock', 'Paper', 'Scissors'][move];
      else if (activeMatch.gameType === 1) moveLabel = `Dice ${move}`;
      else if (activeMatch.gameType === 3) moveLabel = ['Heads', 'Tails'][move];

      toast.success(`${moveLabel} played! Waiting for result...`, { id: toastId });
      setPlayedMoveIds(prev => new Set([...prev, activeMatch.id]));
      setActiveMatch(null);
      setWaitingMatchId(null);
      await refetchMatches();

      const isAgentMatch = activeMatch.opponent?.toLowerCase() === CONTRACT_ADDRESSES.AI_AGENT?.toLowerCase() || activeMatch.challenger?.toLowerCase() === CONTRACT_ADDRESSES.AI_AGENT?.toLowerCase();
      if (isAgentMatch) toast.loading('🤖 AI is analyzing your move...', { duration: 4000 });
    } catch (error) {
      console.error(error);
      toast.error('Failed to play move', { id: toastId });
    } finally { setLoading(false); }
  };

  const handleChallengeAgent = async () => {
    if (!isConnected) { toast.error('Please connect your wallet'); return; }
    if (!isVerified) { toast.error('Identity verification required'); verifyIdentity(); return; }
    if (!publicClient) return;
    setLoading(true);
    const toastId = toast.loading('Initiating challenge...');
    try {
      const encodedArgs = encodeAbiParameters(
        [{ type: 'uint8' }, { type: 'address' }, { type: 'uint8' }],
        [0, CONTRACT_ADDRESSES.AI_AGENT as `0x${string}`, selectedGameType]
      );
      const hash = await writeArena({ address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`, abi: ERC20_ABI, functionName: 'transferAndCall', args: [CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, parseUnits(wager, 18), encodedArgs] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const matchLog = receipt.logs.find(l => l.address.toLowerCase() === CONTRACT_ADDRESSES.ARENA_PLATFORM.toLowerCase() && l.topics.length >= 2);
      const newMatchId = matchLog ? Number(BigInt(matchLog.topics[1] as string)) : null;
      if (newMatchId) setWaitingMatchId(newMatchId);
      toast.success('Challenge sent! AI is responding...', { id: toastId });
      await refetchMatches();
    } catch (error) {
      console.error(error);
      toast.error('Failed to challenge AI', { id: toastId });
    } finally { setLoading(false); }
  };

  return (
    <div className="font-mono text-gray-300 max-w-[560px] mx-auto" style={{ fontFamily: 'Orbitron, monospace' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🤖</span>
          <div>
            <h1 className="text-lg font-black text-white tracking-wide">MARKOV-1</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${agentProfile?.active ? 'bg-green-500' : 'bg-red-500'}`}></span>
              <span className="text-[9px] text-gray-500">{agentProfile?.active ? 'ONLINE' : 'OFFLINE'}</span>
              <span className="text-[9px] text-gray-600">·</span>
              <span className="text-[9px] text-purple-400">{balance ? Number(formatUnits(balance.value, 18)).toFixed(2) : '0'} G$</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {isConnected && entitlement > 0n && (
            <button onClick={claimG$} className="px-3 py-1.5 rounded-lg text-[9px] font-bold bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 transition-all" style={{ fontFamily: 'Orbitron, monospace' }}>
              CLAIM G$
            </button>
          )}
          <button className="px-3 py-1.5 rounded-lg text-[9px] font-bold bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-all" style={{ fontFamily: 'Orbitron, monospace' }}>
            <BookOpen size={10} className="inline mr-1" />DOCS
          </button>
        </div>
      </div>

      {/* Waiting banner */}
      {waitingMatchId && !activeMatch && (
        <div style={{ padding: '16px 20px', borderRadius: '14px', marginBottom: '14px', background: 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(168,85,247,0.06))', border: '1px solid rgba(245,158,11,0.25)', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>🤖</div>
          <div style={{ color: '#f59e0b', fontSize: '13px', fontWeight: 900, letterSpacing: '2px' }}>AI IS RESPONDING...</div>
          <div style={{ color: '#4b5563', fontSize: '9px', marginTop: '4px' }}>Match #{waitingMatchId} · The move selector will open automatically</div>
        </div>
      )}

      {/* Playable matches */}
      {!activeMatch && matches.filter(m => m.status === 1).length > 0 && (
        <div style={{ marginBottom: '14px' }}>
          {matches.filter(m => m.status === 1).map(m => {
            const alreadyPlayed = playedMoveIds.has(m.id);
            return alreadyPlayed ? (
              <div key={m.id} style={{ width: '100%', padding: '16px 20px', borderRadius: '14px', background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(6,6,14,0.95))', border: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'Orbitron, monospace', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '20px' }}>⏳</span>
                  <div>
                    <div style={{ color: '#f59e0b', fontSize: '12px', fontWeight: 900 }}>WAITING FOR RESULT</div>
                    <div style={{ color: '#4b5563', fontSize: '9px', marginTop: '2px' }}>Match #{m.id} · {formatUnits(m.wager, 18)} G$</div>
                  </div>
                </div>
                <span style={{ padding: '5px 12px', borderRadius: '10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', fontSize: '9px', fontWeight: 700 }}>PENDING</span>
              </div>
            ) : (
              <button key={m.id} onClick={() => setActiveMatch(m)} style={{ width: '100%', padding: '16px 20px', borderRadius: '14px', cursor: 'pointer', background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(139,92,246,0.06))', border: '2px solid rgba(168,85,247,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'Orbitron, monospace', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '24px' }}>{GAME_TYPES.find(g => g.id === m.gameType)?.icon}</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ color: '#fff', fontSize: '13px', fontWeight: 900 }}>YOUR TURN — MATCH #{m.id}</div>
                    <div style={{ color: '#6b7280', fontSize: '9px', marginTop: '2px' }}>{formatUnits(m.wager, 18)} G$ wager · {GAME_TYPES.find(g => g.id === m.gameType)?.label}</div>
                  </div>
                </div>
                <div style={{ padding: '8px 18px', borderRadius: '10px', background: 'linear-gradient(135deg, #a855f7, #7c3aed)', color: '#fff', fontSize: '11px', fontWeight: 900, letterSpacing: '1px' }}>PLAY NOW</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Game Type Selection — Dice hidden until Phase 2 signed oracle */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {GAME_TYPES.filter(g => g.id !== 1).map(g => (
          <button key={g.id} onClick={() => setSelectedGameType(g.id)} className="transition-all hover:scale-[1.02]" style={{ padding: '14px 8px', borderRadius: '14px', cursor: 'pointer', background: selectedGameType === g.id ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.03)', border: `1.5px solid ${selectedGameType === g.id ? '#a855f7' : 'rgba(255,255,255,0.06)'}`, textAlign: 'center', fontFamily: 'Orbitron, monospace' }}>
            <div className="text-2xl mb-1">{g.icon}</div>
            <div style={{ fontSize: '9px', fontWeight: 900, letterSpacing: '1px', color: selectedGameType === g.id ? '#c084fc' : '#4b5563' }}>{g.label}</div>
          </button>
        ))}
      </div>

      {/* Wager + Action */}
      <div style={{ padding: '18px', borderRadius: '16px', marginBottom: '14px', background: 'linear-gradient(160deg, rgba(168,85,247,0.08), rgba(6,6,14,0.95))', border: '1px solid rgba(168,85,247,0.15)' }}>
        {!isVerified && isConnected && (
          <div className="mb-4 p-3 rounded-xl text-center" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)' }}>
            <span className="text-[10px] text-yellow-400 font-bold">VERIFY IDENTITY TO WAGER </span>
            <button onClick={verifyIdentity} disabled={isVerifying} className="ml-2 px-3 py-1 rounded-lg text-[9px] font-bold bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/25 transition-all" style={{ fontFamily: 'Orbitron, monospace' }}>
              {isVerifying ? '...' : 'VERIFY'}
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <span style={{ color: '#a855f7', fontSize: '13px', fontWeight: 900 }}>G$</span>
          <input type="number" value={wager} onChange={(e) => setWager(e.target.value)} className="bg-transparent border-none text-white text-2xl font-black w-full focus:ring-0 focus:outline-none placeholder-gray-700" style={{ fontFamily: 'Orbitron, monospace' }} placeholder="0.00" />
          <div className="text-right flex-shrink-0">
            <div style={{ color: '#374151', fontSize: '8px', letterSpacing: '1px' }}>POTENTIAL WIN</div>
            <div style={{ color: '#10b981', fontSize: '14px', fontWeight: 900 }}>{(parseFloat(wager || '0') * 2 * 0.95).toFixed(2)} G$</div>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {['0.1', '1', '5', '10', '25'].map(amt => (
            <button key={amt} onClick={() => setWager(amt)} className="transition-all hover:scale-105" style={{ flex: 1, padding: '6px', borderRadius: '8px', cursor: 'pointer', background: wager === amt ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.03)', border: `1px solid ${wager === amt ? '#a855f7' : 'rgba(255,255,255,0.05)'}`, color: wager === amt ? '#c084fc' : '#4b5563', fontSize: '11px', fontWeight: 700, fontFamily: 'Orbitron, monospace' }}>{amt}</button>
          ))}
        </div>

        {!isConnected ? (
          <button onClick={() => login()} className="w-full py-3.5 rounded-xl text-sm font-black uppercase tracking-wider transition-all hover:scale-[1.01]" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', fontFamily: 'Orbitron, monospace' }}>
            CONNECT WALLET
          </button>
        ) : !isVerified ? (
          <button onClick={verifyIdentity} className="w-full py-3.5 rounded-xl text-sm font-black uppercase tracking-wider transition-all" style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.25)', color: '#a855f7', fontFamily: 'Orbitron, monospace', cursor: 'pointer' }}>
            VERIFY TO PLAY
          </button>
        ) : (
          <button onClick={handleChallengeAgent} disabled={loading || !wager} className="w-full py-3.5 rounded-xl text-sm font-black uppercase tracking-wider transition-all hover:scale-[1.01] hover:brightness-110 disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #a855f7, #7c3aed)', border: 'none', color: '#fff', fontFamily: 'Orbitron, monospace', boxShadow: '0 4px 20px rgba(168,85,247,0.3)' }}>
            {loading ? 'PROCESSING...' : `CHALLENGE — ${wager} G$`}
          </button>
        )}

        <div className="text-center mt-3" style={{ color: '#2a2a3a', fontSize: '8px', letterSpacing: '0.5px' }}>
          2% fee → GoodDollar UBI Pool · Winner takes 95%
        </div>
      </div>

      {/* Your Matches */}
      {matches.length > 0 && (
        <div style={{ padding: '14px', borderRadius: '14px', marginBottom: '14px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="flex items-center justify-between mb-3">
            <span style={{ color: '#6b7280', fontSize: '10px', fontWeight: 700, letterSpacing: '2px' }}>YOUR MATCHES</span>
            <span style={{ color: '#10b981', fontSize: '9px', fontWeight: 700 }}>{matches.length} ACTIVE</span>
          </div>
          <div className="space-y-2 max-h-[180px] overflow-y-auto">
            {matches.map(m => {
              const isWinner = m.status === 2 && m.winner?.toLowerCase() === address?.toLowerCase();
              const isLoser = m.status === 2 && m.winner?.toLowerCase() !== address?.toLowerCase() && m.winner !== '0x0000000000000000000000000000000000000000';
              const isChallenger = m.challenger?.toLowerCase() === address?.toLowerCase();
              const myMove = getMoveDisplay(m.gameType, isChallenger ? m.challengerMove : m.opponentMove);
              const oppMove = getMoveDisplay(m.gameType, isChallenger ? m.opponentMove : m.challengerMove);

              return (
                <div key={m.id} className="flex items-center justify-between p-2.5 rounded-xl transition-all hover:bg-white/[0.03]" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{GAME_TYPES.find(g => g.id === m.gameType)?.icon || '❓'}</span>
                    <div>
                      <div className="text-xs font-bold text-gray-300 flex items-center gap-2">
                        #{m.id}
                        {m.status === 2 && <span style={{ color: '#4b5563', fontSize: '9px' }}>{myMove.icon} vs {oppMove.icon}</span>}
                      </div>
                      <div style={{ fontSize: '9px', color: '#374151' }}>{MATCH_STATUS[m.status]}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div style={{ color: '#a855f7', fontSize: '11px', fontWeight: 900 }}>{formatUnits(m.wager, 18)} G$</div>
                    {m.status === 1 && !playedMoveIds.has(m.id) && (
                      <button onClick={() => setActiveMatch(m)} style={{ marginTop: '2px', padding: '2px 10px', borderRadius: '8px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc', fontSize: '9px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Orbitron, monospace' }}>PLAY</button>
                    )}
                    {m.status === 1 && playedMoveIds.has(m.id) && (
                      <span style={{ display: 'inline-block', marginTop: '2px', padding: '2px 8px', borderRadius: '8px', fontSize: '8px', fontWeight: 900, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>PENDING</span>
                    )}
                    {m.status === 2 && (
                      <span style={{ display: 'inline-block', marginTop: '2px', padding: '2px 8px', borderRadius: '8px', fontSize: '8px', fontWeight: 900, background: isWinner ? 'rgba(16,185,129,0.12)' : isLoser ? 'rgba(239,68,68,0.12)' : 'rgba(234,179,8,0.12)', border: `1px solid ${isWinner ? 'rgba(16,185,129,0.3)' : isLoser ? 'rgba(239,68,68,0.3)' : 'rgba(234,179,8,0.3)'}`, color: isWinner ? '#10b981' : isLoser ? '#ef4444' : '#eab308' }}>{isWinner ? 'WON' : isLoser ? 'LOST' : 'TIE'}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mini leaderboard */}
      {leaderboard.length > 0 && (
        <div style={{ padding: '14px', borderRadius: '14px', marginBottom: '14px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="mb-3" style={{ color: '#6b7280', fontSize: '10px', fontWeight: 700, letterSpacing: '2px' }}>TOP ARENA PLAYERS</div>
          {leaderboard.map((entry, i) => (
            <div key={entry.address} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2">
                <span style={{ color: i === 0 ? '#f59e0b' : i === 1 ? '#9ca3af' : i === 2 ? '#b45309' : '#4b5563', fontSize: '10px', fontWeight: 900, width: '14px' }}>#{i + 1}</span>
                <span style={{ color: entry.isAi ? '#a855f7' : '#9ca3af', fontSize: '10px', fontFamily: 'monospace' }}>{entry.isAi ? '🤖 Markov-1' : `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`}</span>
              </div>
              <span style={{ color: '#10b981', fontSize: '10px', fontWeight: 700 }}>{entry.count}W</span>
            </div>
          ))}
        </div>
      )}

      {/* Quick links */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={() => router.push('/leaderboard')} style={{ flex: 1, padding: '12px', borderRadius: '12px', cursor: 'pointer', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.12)', color: '#f59e0b', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', fontFamily: 'Orbitron, monospace' }}>LEADERBOARD</button>
        <button onClick={() => router.push('/')} style={{ flex: 1, padding: '12px', borderRadius: '12px', cursor: 'pointer', background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.12)', color: '#a855f7', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', fontFamily: 'Orbitron, monospace' }}>SOLO GAMES</button>
      </div>

      {/* Verification overlay */}
      {isVerifying && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0a0a0a] border border-blue-500/50 rounded w-full max-w-lg shadow-[0_0_50px_rgba(37,99,235,0.1)]">
            <div className="bg-blue-900/10 border-b border-blue-500/20 p-4 flex justify-between items-center">
              <h3 className="text-blue-400 font-bold tracking-wider">{`>> VERIFY_IDENTITY`}</h3>
              <button onClick={cancelVerification} className="text-gray-500 hover:text-white">✕</button>
            </div>
            <div className="p-6 text-center text-gray-400">Verification in progress...</div>
          </div>
        </div>
      )}

      {/* Active match modal */}
      {!isVerifying && activeMatch && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div style={{ width: '100%', maxWidth: '420px', borderRadius: '20px', overflow: 'hidden', background: 'linear-gradient(160deg, rgba(168,85,247,0.1), rgba(6,6,14,0.98))', border: '1px solid rgba(168,85,247,0.25)', boxShadow: '0 0 60px rgba(168,85,247,0.15)', position: 'relative' }}>
            <div style={{ padding: '20px 24px 16px', textAlign: 'center' }}>
              <button onClick={() => setActiveMatch(null)} style={{ position: 'absolute', top: '16px', right: '20px', background: 'none', border: 'none', color: '#4b5563', fontSize: '18px', cursor: 'pointer' }}>✕</button>
              <div style={{ color: '#a855f7', fontSize: '10px', fontWeight: 700, letterSpacing: '2px', marginBottom: '4px' }}>MATCH #{activeMatch.id}</div>
              <div style={{ color: '#fff', fontSize: '22px', fontWeight: 900, letterSpacing: '2px', fontFamily: 'Orbitron, monospace' }}>MAKE YOUR MOVE</div>
              <div style={{ display: 'inline-block', marginTop: '10px', padding: '5px 16px', borderRadius: '20px', background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.25)', color: '#c084fc', fontSize: '12px', fontWeight: 900, fontFamily: 'Orbitron, monospace' }}>
                {formatUnits(activeMatch.wager, 18)} G$ AT STAKE
              </div>
            </div>
            <div style={{ padding: '16px 24px 28px' }}>
              {activeMatch.gameType === 1 ? (
                <button onClick={async () => { const token = await getAccessToken(); const roll = await rollDice(token ?? '', activeMatch.id); if (roll) handlePlayMove(activeMatch.id, roll); }} className="hover:scale-[1.02] transition-all" style={{ width: '100%', padding: '28px', borderRadius: '16px', cursor: 'pointer', background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(168,85,247,0.05))', border: '1px solid rgba(168,85,247,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', fontFamily: 'Orbitron, monospace' }}>
                  <span style={{ fontSize: '48px' }}>🎲</span>
                  <span style={{ color: '#c084fc', fontSize: '14px', fontWeight: 900, letterSpacing: '2px' }}>ROLL DICE</span>
                </button>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${(activeMatch.gameType === 0 ? MOVES.RPS : MOVES.COIN).length}, 1fr)`, gap: '10px' }}>
                  {(activeMatch.gameType === 0 ? MOVES.RPS : MOVES.COIN).map((m) => (
                    <button key={m.id} onClick={() => handlePlayMove(activeMatch.id, m.id)} className="hover:scale-[1.05] transition-all" style={{ padding: '20px 12px', borderRadius: '14px', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', fontFamily: 'Orbitron, monospace' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#a855f7'; (e.currentTarget as HTMLElement).style.background = 'rgba(168,85,247,0.1)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
                    >
                      <span style={{ fontSize: '36px' }}>{m.icon}</span>
                      <span style={{ color: '#9ca3af', fontSize: '10px', fontWeight: 900, letterSpacing: '1px' }}>{m.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
