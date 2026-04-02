import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useReadContract, useWriteContract, usePublicClient, useWatchContractEvent, useBalance, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { BookOpen } from 'lucide-react';
import { parseUnits, formatUnits, parseAbiItem, encodeAbiParameters } from 'viem';
import { CONTRACT_ADDRESSES, ARENA_PLATFORM_ABI, ERC8004_REGISTRY_ABI, ERC20_ABI } from '../config/contracts';
import { toast } from 'react-hot-toast';
import { useArenaEvents } from '../hooks/useArenaEvents';
import { MATCH_STATUS, GAME_TYPES, MOVES, getMoveDisplay } from '../utils/gameLogic';
import DocsModal from '../components/DocsModal';
import MoltbookFeed from '../components/MoltbookFeed';
import { useSelfVerification } from '../contexts/SelfVerificationContext';

const ArenaGame = () => {
    const { address, isConnected, chainId } = useAccount();
    const { data: balance, isError, isLoading } = useBalance({
        address,
        token: CONTRACT_ADDRESSES.G_TOKEN,
        query: {
            refetchInterval: false,
            staleTime: 30000 // Cache for 30s to prevent spam
        }
    });
    const { connect } = useConnect();
    const open = () => connect({ connector: injected() });
    const publicClient = usePublicClient();

    const { isVerified, isVerifying, verifyIdentity, cancelVerification, SelfVerificationComponent, claimG$, entitlement } = useSelfVerification();
    const [wager, setWager] = useState('0.1');
    const [selectedGameType, setSelectedGameType] = useState(0);
    const [matches, setMatches] = useState([]);
    const [globalMatches, setGlobalMatches] = useState([]); // New State for Global Feed
    const [loading, setLoading] = useState(false);
    const [activeMatch, setActiveMatch] = useState(null);
    const [selectedMove, setSelectedMove] = useState(null);
    const [showDocs, setShowDocs] = useState(false);
    const [activeTab, setActiveTab] = useState('chain'); // 'chain', 'social', or 'fame'
    const [leaderboard, setLeaderboard] = useState([]);

    // Fetch Agent Identity — ERC-8004 official Celo Mainnet registry
    const agentTokenId = CONTRACT_ADDRESSES.AGENT_TOKEN_ID
        ? BigInt(CONTRACT_ADDRESSES.AGENT_TOKEN_ID)
        : null;

    const { data: agentTokenURI } = useReadContract({
        address: CONTRACT_ADDRESSES.ERC8004_REGISTRY,
        abi: ERC8004_REGISTRY_ABI,
        functionName: 'tokenURI',
        args: [agentTokenId],
        query: { enabled: !!agentTokenId },
    });

    const { data: agentWallet } = useReadContract({
        address: CONTRACT_ADDRESSES.ERC8004_REGISTRY,
        abi: ERC8004_REGISTRY_ABI,
        functionName: 'getAgentWallet',
        args: [agentTokenId],
        query: { enabled: !!agentTokenId },
    });

    // Parse tokenURI (data URI or IPFS JSON) into a profile object
    const [agentProfile, setAgentProfile] = React.useState({ active: false });
    React.useEffect(() => {
        if (!agentTokenURI) return;
        try {
            let meta;
            if (agentTokenURI.startsWith('data:application/json;base64,')) {
                meta = JSON.parse(atob(agentTokenURI.split(',')[1]));
            } else if (agentTokenURI.startsWith('{')) {
                meta = JSON.parse(agentTokenURI);
            } else {
                // IPFS or HTTP — fetch it
                fetch(agentTokenURI).then(r => r.json()).then(meta => {
                    setAgentProfile({
                        name: meta.name || 'Markov-1',
                        model: meta.model || 'Celo AI',
                        description: meta.description || '',
                        wallet: agentWallet || CONTRACT_ADDRESSES.AI_AGENT,
                        active: true,
                    });
                }).catch(() => {});
                return;
            }
            setAgentProfile({
                name: meta.name || 'Markov-1',
                model: meta.model || 'Celo AI',
                description: meta.description || '',
                wallet: agentWallet || CONTRACT_ADDRESSES.AI_AGENT,
                active: true,
            });
        } catch (_) {
            setAgentProfile({ active: !!agentTokenId });
        }
    }, [agentTokenURI, agentWallet, agentTokenId]);

    const { writeContractAsync: writeArena } = useWriteContract();

    const fetchMatchDetails = useCallback(async (ids) => {
        if (!ids || !publicClient) return;
        try {
            const uniqueIds = [...new Set(ids)];
            const matchContracts = ids.map(id => ({
                address: CONTRACT_ADDRESSES.ARENA_PLATFORM,
                abi: ARENA_PLATFORM_ABI,
                functionName: 'matches',
                args: [id]
            }));

            const matchResults = await publicClient.multicall({ contracts: matchContracts });
            const moveChecks = [];
            const moveContractCalls = [];

            matchResults.forEach((res, index) => {
                if (res.status === 'success') {
                    const m = res.result;
                    const id = ids[index];
                    const status = Number(m[5]);
                    if (status === 1 || status === 2) {
                        moveChecks.push({ index, type: 'hasPlayed', player: m[1], isChallenger: true });
                        moveChecks.push({ index, type: 'hasPlayed', player: m[2], isChallenger: false });
                        moveContractCalls.push({
                            address: CONTRACT_ADDRESSES.ARENA_PLATFORM,
                            abi: ARENA_PLATFORM_ABI,
                            functionName: 'hasPlayed',
                            args: [id, m[1]]
                        });
                        moveContractCalls.push({
                            address: CONTRACT_ADDRESSES.ARENA_PLATFORM,
                            abi: ARENA_PLATFORM_ABI,
                            functionName: 'hasPlayed',
                            args: [id, m[2]]
                        });
                    }
                }
            });

            let moveResults = [];
            if (moveContractCalls.length > 0) {
                moveResults = await publicClient.multicall({ contracts: moveContractCalls });
            }

            const actualMoveCalls = [];
            const actualMoveIndices = [];
            let moveResultIndex = 0;
            const matchesWithMoves = new Map();

            matchResults.forEach((res, index) => {
                if (res.status !== 'success') return;
                const m = res.result;
                const id = ids[index];
                const status = Number(m[5]);
                if (status === 1 || status === 2) {
                    const challengerPlayedRes = moveResults[moveResultIndex++];
                    const opponentPlayedRes = moveResults[moveResultIndex++];
                    const challengerPlayed = challengerPlayedRes?.status === 'success' && challengerPlayedRes.result;
                    const opponentPlayed = opponentPlayedRes?.status === 'success' && opponentPlayedRes.result;
                    matchesWithMoves.set(index, { challengerPlayed, opponentPlayed });

                    if (challengerPlayed) {
                        actualMoveIndices.push({ index, isChallenger: true });
                        actualMoveCalls.push({
                            address: CONTRACT_ADDRESSES.ARENA_PLATFORM,
                            abi: ARENA_PLATFORM_ABI,
                            functionName: 'playerMoves',
                            args: [id, m[1]]
                        });
                    }
                    if (opponentPlayed) {
                        actualMoveIndices.push({ index, isChallenger: false });
                        actualMoveCalls.push({
                            address: CONTRACT_ADDRESSES.ARENA_PLATFORM,
                            abi: ARENA_PLATFORM_ABI,
                            functionName: 'playerMoves',
                            args: [id, m[2]]
                        });
                    }
                }
            });

            let actualMovesResults = [];
            if (actualMoveCalls.length > 0) {
                actualMovesResults = await publicClient.multicall({ contracts: actualMoveCalls });
            }

            const matchDetails = matchResults.map((res, index) => {
                if (res.status !== 'success') return null;
                const m = res.result;
                const id = ids[index];
                let challengerMove = null;
                let opponentMove = null;
                if (matchesWithMoves.has(index)) {
                    const cMoveIdx = actualMoveIndices.findIndex(x => x.index === index && x.isChallenger);
                    if (cMoveIdx !== -1 && actualMovesResults[cMoveIdx].status === 'success') {
                        challengerMove = Number(actualMovesResults[cMoveIdx].result);
                    }
                    const oMoveIdx = actualMoveIndices.findIndex(x => x.index === index && !x.isChallenger);
                    if (oMoveIdx !== -1 && actualMovesResults[oMoveIdx].status === 'success') {
                        opponentMove = Number(actualMovesResults[oMoveIdx].result);
                    }
                }
                return {
                    id: Number(id),
                    challenger: m[1],
                    opponent: m[2],
                    wager: m[3],
                    gameType: Number(m[4]),
                    status: Number(m[5]),
                    winner: m[6],
                    createdAt: Number(m[7]),
                    challengerMove,
                    opponentMove
                };
            }).filter(m => m !== null);

            setMatches(matchDetails.sort((a, b) => b.id - a.id));
        } catch (error) {
            console.error('Error fetching matches:', error);
        }
    }, [publicClient]);

    const fetchGlobalMatches = useCallback(async () => {
        if (!publicClient) return;
        try {
            const count = await publicClient.readContract({
                address: CONTRACT_ADDRESSES.ARENA_PLATFORM,
                abi: ARENA_PLATFORM_ABI,
                functionName: 'matchCounter'
            });
            const total = Number(count);
            const start = Math.max(0, total - 100);
            const ids = Array.from({ length: total - start }, (_, i) => BigInt(total - 1 - i));
            if (ids.length === 0) return;

            const matchContracts = ids.map(id => ({
                address: CONTRACT_ADDRESSES.ARENA_PLATFORM,
                abi: ARENA_PLATFORM_ABI,
                functionName: 'matches',
                args: [id]
            }));

            const results = await publicClient.multicall({ contracts: matchContracts });
            const matchDetails = results.map((res, index) => {
                if (res.status === 'failure' || !res.result) return null;
                const m = res.result;
                return {
                    id: Number(ids[index]),
                    challenger: m[1],
                    opponent: m[2],
                    wager: m[3],
                    gameType: Number(m[4]),
                    status: Number(m[5]),
                    winner: m[6],
                    createdAt: Number(m[7])
                };
            }).filter(m => m !== null);

            setGlobalMatches(matchDetails);
        } catch (e) { }
    }, [publicClient]);

    useEffect(() => {
        if (globalMatches.length === 0) return;
        const wins = {};
        globalMatches.forEach(m => {
            if (m.status === 2 && m.winner && m.winner !== '0x0000000000000000000000000000000000000000') {
                const winner = m.winner.toLowerCase();
                wins[winner] = (wins[winner] || 0) + 1;
            }
        });
        const sorted = Object.entries(wins)
            .map(([addr, count]) => ({
                address: addr,
                count,
                isAi: addr.toLowerCase() === CONTRACT_ADDRESSES.AI_AGENT.toLowerCase()
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        setLeaderboard(sorted);
    }, [globalMatches, address]);

    useEffect(() => {
        fetchGlobalMatches();
    }, [fetchGlobalMatches]);

    const { data: playerMatchIds, refetch: refetchMatches } = useReadContract({
        address: CONTRACT_ADDRESSES.ARENA_PLATFORM,
        abi: ARENA_PLATFORM_ABI,
        functionName: 'getPlayerMatches',
        args: [address],
        query: {
            enabled: !!address,
            refetchInterval: false,
            staleTime: 10000
        }
    });

    const playerMatchIdsRef = useRef(playerMatchIds);
    const matchesRef = useRef(matches);

    useEffect(() => {
        const prevIds = playerMatchIdsRef.current;
        const currentIds = playerMatchIds;
        const hasChanged = !prevIds || !currentIds ||
            prevIds.length !== currentIds.length ||
            !prevIds.every((val, index) => val === currentIds[index]);

        playerMatchIdsRef.current = playerMatchIds;
        matchesRef.current = matches;

        if (playerMatchIds && (matches.length === 0 || hasChanged)) {
            fetchMatchDetails(playerMatchIds);
        }
    }, [playerMatchIds, matches.length, fetchMatchDetails]);

    useArenaEvents({
        onMatchUpdate: async () => {
            const { data: freshIds } = await refetchMatches();
            if (freshIds) fetchMatchDetails(freshIds);
        },
        onGlobalUpdate: () => fetchGlobalMatches(),
        address,
        matches
    });

    useEffect(() => {
        if (!isConnected || !address) return;
        const interval = setInterval(() => {
            refetchMatches().then(({ data: freshIds }) => {
                if (freshIds) fetchMatchDetails(freshIds);
            });
            fetchGlobalMatches();
        }, 30000);
        return () => clearInterval(interval);
    }, [address, isConnected, refetchMatches, fetchMatchDetails, fetchGlobalMatches]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden && isConnected) refetchMatches();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [refetchMatches, isConnected]);

    const handlePlayMove = async (matchId, move) => {
        setLoading(true);
        const toastId = toast.loading('Submitting move...');
        try {
            const hash = await writeArena({
                address: CONTRACT_ADDRESSES.ARENA_PLATFORM,
                abi: ARENA_PLATFORM_ABI,
                functionName: 'playMove',
                args: [BigInt(matchId), move]
            });
            toast.loading('Confirming transaction...', { id: toastId });
            await publicClient.waitForTransactionReceipt({ hash });

            let moveLabel = '';
            if (activeMatch.gameType === 0) moveLabel = ['Rock', 'Paper', 'Scissors'][move];
            else if (activeMatch.gameType === 1) moveLabel = `Dice ${move}`;
            else if (activeMatch.gameType === 3) moveLabel = ['Heads', 'Tails'][move];
            else if (activeMatch.gameType === 4) {
                const positions = ['Top-Left', 'Top-Center', 'Top-Right', 'Mid-Left', 'Center', 'Mid-Right', 'Bot-Left', 'Bot-Center', 'Bot-Right'];
                moveLabel = positions[move];
            }

            toast.success(`Selected ${moveLabel}! Move confirmed on chain.`, { id: toastId });
            setActiveMatch(null);
            setSelectedMove(null);
            await refetchMatches();

            const isAgentMatch = activeMatch.opponent?.toLowerCase() === CONTRACT_ADDRESSES.AI_AGENT?.toLowerCase() ||
                activeMatch.challenger?.toLowerCase() === CONTRACT_ADDRESSES.AI_AGENT?.toLowerCase();
            if (isAgentMatch) toast.loading("🤖 AI is analyzing your move...", { duration: 4000 });
        } catch (error) {
            console.error(error);
            toast.error('Failed to play move', { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    const handleChallengeAgent = async () => {
        if (!isConnected) { toast.error('Please connect your wallet'); return; }
        if (!isVerified) { toast.error('Identity verification required'); verifyIdentity(); return; }
        setLoading(true);
        const toastId = toast.loading('Initiating challenge...');
        try {
            const encodedArgs = encodeAbiParameters(
                [{ type: 'uint8' }, { type: 'address' }, { type: 'uint8' }],
                [0, CONTRACT_ADDRESSES.AI_AGENT, selectedGameType]
            );
            const hash = await writeArena({
                address: CONTRACT_ADDRESSES.G_TOKEN,
                abi: ERC20_ABI,
                functionName: 'transferAndCall',
                args: [CONTRACT_ADDRESSES.ARENA_PLATFORM, parseUnits(wager, 18), encodedArgs]
            });
            await publicClient.waitForTransactionReceipt({ hash });
            toast.success('Duel initiated! Waiting for AI to accept...', { id: toastId });
            await refetchMatches();
        } catch (error) {
            console.error(error);
            toast.error('Failed to challenge AI', { id: toastId });
        } finally { setLoading(false); }
    };

    const handleCreateMatch = async () => {
        if (!isConnected) { toast.error('Please connect your wallet'); return; }
        if (!isVerified) { toast.error('Identity verification required'); verifyIdentity(); return; }
        setLoading(true);
        const toastId = toast.loading('Proposing match...');
        try {
            const encodedArgs = encodeAbiParameters(
                [{ type: 'uint8' }, { type: 'address' }, { type: 'uint8' }],
                [0, '0x0000000000000000000000000000000000000000', selectedGameType]
            );
            const hash = await writeArena({
                address: CONTRACT_ADDRESSES.G_TOKEN,
                abi: ERC20_ABI,
                functionName: 'transferAndCall',
                args: [CONTRACT_ADDRESSES.ARENA_PLATFORM, parseUnits(wager, 18), encodedArgs]
            });
            await publicClient.waitForTransactionReceipt({ hash });
            toast.success('Open Match proposed! Waiting for opponent...', { id: toastId });
            await refetchMatches();
        } catch (error) {
            console.error(error);
            toast.error('Failed to propose match', { id: toastId });
        } finally { setLoading(false); }
    };

    const handleAcceptMatch = async (matchId, wagerAmount) => {
        if (!isConnected) { toast.error('Please connect your wallet'); return; }
        if (!isVerified) { toast.error('Identity verification required'); verifyIdentity(); return; }
        setLoading(true);
        const toastId = toast.loading('Accepting match...');
        try {
            const encodedArgs = encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }], [1, BigInt(matchId)]);
            const hash = await writeArena({
                address: CONTRACT_ADDRESSES.G_TOKEN,
                abi: ERC20_ABI,
                functionName: 'transferAndCall',
                args: [CONTRACT_ADDRESSES.ARENA_PLATFORM, wagerAmount, encodedArgs]
            });
            await publicClient.waitForTransactionReceipt({ hash });
            toast.success('Match accepted! Game starting...', { id: toastId });
            await refetchMatches();
        } catch (error) {
            console.error(error);
            toast.error('Failed to accept match', { id: toastId });
        } finally { setLoading(false); }
    };

    return (
        <div className="font-mono text-gray-300">
            <DocsModal isOpen={showDocs} onClose={() => setShowDocs(false)} />
            <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tighter">🦞 ARENA_1v1</h1>
                    <div className="flex items-center gap-4 mt-1">
                        <p className="text-xs text-gray-500">PROTOCOL_ID: {CONTRACT_ADDRESSES.ARENA_PLATFORM.slice(0, 8)}...</p>
                        <button onClick={() => setShowDocs(true)} className="flex items-center gap-1.5 text-[10px] text-purple-400 hover:text-purple-300 transition-colors uppercase font-bold border border-purple-500/30 px-2 py-0.5 rounded bg-purple-900/10 hover:bg-purple-900/30">
                            <BookOpen size={12} /> [ SYSTEM_DOCS ]
                        </button>
                    </div>
                </div>
                <div className="flex gap-4">
                    <div className="bg-[#0a0a0a] border border-white/10 px-4 py-2 rounded min-w-[140px]">
                        <span className="text-[10px] text-gray-500 block uppercase">Balance</span>
                        <div className="text-white font-bold text-sm font-mono">
                            {balance ? Number(formatUnits(balance.value, 18)).toFixed(4) : '--'} <span className="text-blue-400">G$</span>
                        </div>
                    </div>
                    <div className="bg-[#0a0a0a] border border-white/10 px-4 py-2 rounded flex flex-col items-end">
                        <span className="text-[10px] text-gray-500 block uppercase flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${agentProfile?.active ? 'bg-green-500' : 'bg-red-500'}`}></span> AGENT_STATUS
                        </span>
                        <div className={`font-bold text-sm font-mono ${agentProfile?.active ? 'text-green-400' : 'text-purple-500'}`}>
                            {agentProfile?.active ? 'ONLINE' : 'OFFLINE'}
                        </div>
                    </div>
                    <div className="flex flex-col items-center gap-2 min-w-[140px]">
                        <div className="w-full min-h-[40px] flex items-center justify-center">
                            {isConnected ? (
                                <button
                                    onClick={claimG$}
                                    disabled={!entitlement || entitlement === 0n}
                                    className={`h-10 w-full px-4 rounded font-bold text-xs transition-all flex flex-col items-center justify-center leading-tight ${entitlement > 0n
                                        ? 'bg-linear-to-r from-green-500 to-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:scale-[1.02] active:scale-[0.98]'
                                        : 'bg-white/5 text-gray-500 border border-white/10 cursor-not-allowed'
                                        }`}
                                >
                                    <span>CLAIM_G$</span>
                                    {entitlement > 0n && (
                                        <span className="text-[9px] opacity-80">
                                            +{Number(formatUnits(entitlement, 18)).toFixed(2)} AVAILABLE
                                        </span>
                                    )}
                                </button>
                            ) : (
                                <div className="h-10 w-full bg-white/5 border border-white/10 rounded flex items-center justify-center text-[10px] text-gray-600 font-bold uppercase">WALLET_NOT_CONNECTED</div>
                            )}
                        </div>
                        <a href="https://gooddollar.org" target="_blank" className="text-[10px] text-purple-400 hover:text-purple-300 transition-colors uppercase font-bold">LEARN_ABOUT_G$</a>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6 relative overflow-hidden group hover:border-purple-500/30 transition-colors">
                        <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-purple-500 to-blue-500 opacity-20"></div>
                        <div className="mb-8 text-center">
                            <div className="w-16 h-16 mx-auto bg-purple-900/20 rounded-full border border-purple-500/20 flex items-center justify-center text-3xl mb-4">🤖</div>
                            <h2 className="text-xl font-bold text-white mb-2 uppercase">Challenge_The_AI</h2>
                            <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed mb-6">{agentProfile.description || "Autonomous agent initialized. Select game type to begin."}</p>
                            {!isVerified && isConnected && (
                                <div className="mb-8 p-4 bg-purple-900/10 border border-purple-500/20 rounded text-center">
                                    <div className="text-2xl mb-2">🛡️</div>
                                    <p className="text-xs text-purple-300 mb-4 uppercase tracking-wider font-bold">Identity Verification Required</p>
                                    <p className="text-[10px] text-gray-500 mb-6 leading-relaxed">To ensure fair gameplay and secure your G$ wagers, we require one-time Face Verification via GoodDollar.</p>
                                    <button onClick={verifyIdentity} disabled={isVerifying} className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-[10px] font-bold transition-all uppercase disabled:opacity-50">
                                        {isVerifying ? 'INITIALIZING...' : 'START_VERIFICATION'}
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-3 gap-3 mb-6">
                            {GAME_TYPES.map(g => (
                                <button key={g.id} onClick={() => setSelectedGameType(g.id)} className={`p-4 rounded border transition-all ${selectedGameType === g.id ? 'bg-purple-900/20 border-purple-500 text-white' : 'bg-black border-white/5 text-gray-500 hover:border-white/20 hover:text-gray-300'}`}>
                                    <div className="text-2xl mb-2">{g.icon}</div>
                                    <div className="text-[10px] uppercase tracking-wider font-bold">{g.label}</div>
                                </button>
                            ))}
                        </div>
                        <div className="bg-black/50 border border-white/5 rounded p-4 mb-6">
                            <div className="flex justify-between text-[10px] text-gray-500 uppercase mb-2">
                                <span>Wager Amount</span>
                                <span>Potential Win: <span className="text-green-400">{(parseFloat(wager || '0') * 2 * 0.95).toFixed(3)} G$</span></span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-blue-400 font-bold">G$</span>
                                <input type="number" value={wager} onChange={(e) => setWager(e.target.value)} className="bg-transparent border-none text-white text-xl font-bold w-full focus:ring-0 placeholder-gray-700" placeholder="0.00" />
                            </div>
                        </div>
                        {!isConnected ? (
                            <button onClick={open} className="w-full py-4 bg-white/5 border border-white/10 rounded text-sm font-bold hover:bg-white/10 transition-all uppercase">Connect Wallet</button>
                        ) : !isVerified ? (
                            <button onClick={verifyIdentity} className="w-full py-4 bg-purple-900/40 border border-purple-500/30 text-purple-300 rounded text-sm font-bold transition-all uppercase cursor-help" title="Verify identity to unlock wagering">VERIFICATION_LOCKED</button>
                        ) : (
                            <button onClick={handleChallengeAgent} disabled={loading || !wager} className="w-full py-4 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm font-bold transition-all uppercase disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(147,51,234,0.3)]">{loading ? 'PROCESSING...' : 'INITIATE_CHALLENGE'}</button>
                        )}
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 h-[200px] overflow-y-auto">
                        <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 flex items-center justify-between">
                            <span>Your_Matches</span> {matches.length > 0 && <span className="text-green-500 text-[10px]">{matches.length} ACTIVE</span>}
                        </h3>
                        {matches.length === 0 ? <div className="h-full flex items-center justify-center text-[10px] text-gray-600 italic">NO_ACTIVE_MATCHES</div> : (
                            <div className="space-y-2">
                                {matches.map(m => {
                                    const isWinner = m.status === 2 && m.winner?.toLowerCase() === address?.toLowerCase();
                                    const isLoser = m.status === 2 && m.winner?.toLowerCase() !== address?.toLowerCase() && m.winner !== '0x0000000000000000000000000000000000000000';
                                    const isTie = m.status === 2 && m.winner === '0x0000000000000000000000000000000000000000';
                                    const isChallenger = m.challenger?.toLowerCase() === address?.toLowerCase();
                                    const myMoveId = isChallenger ? m.challengerMove : m.opponentMove;
                                    const oppMoveId = isChallenger ? m.opponentMove : m.challengerMove;
                                    const myMove = getMoveDisplay(m.gameType, myMoveId);
                                    const oppMove = getMoveDisplay(m.gameType, oppMoveId);

                                    return (
                                        <div key={m.id} className="bg-white/5 border border-white/5 rounded p-2 text-xs flex justify-between items-center group hover:border-white/20 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="flex flex-col items-center gap-1 min-w-[20px]">
                                                    <span className="text-base">{GAME_TYPES.find(g => g.id === m.gameType)?.icon || '❓'}</span>
                                                </div>
                                                <div>
                                                    <div className="font-bold text-gray-300 flex items-center gap-2">
                                                        <span>#{m.id}</span> {m.status === 2 && <span className="text-gray-500 font-mono text-[10px] bg-black/30 px-1 rounded border border-white/5">{myMove.icon} vs {oppMove.icon}</span>}
                                                    </div>
                                                    <div className="text-[10px] text-gray-500">{MATCH_STATUS[m.status]}</div>
                                                </div>
                                            </div>
                                            <div className="text-right flex flex-col items-end">
                                                <div className="text-blue-400 font-bold">{formatUnits(m.wager, 18)} G$</div>
                                                {m.status === 1 && <button onClick={() => setActiveMatch(m)} className="text-[9px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded mt-0.5 hover:bg-purple-500/40 border border-purple-500/30 font-bold">PLAY_MOVE</button>}
                                                {m.status === 2 && <span className={`text-[9px] px-1.5 py-0.5 rounded mt-0.5 font-bold border ${isWinner ? 'bg-green-500/20 text-green-400 border-green-500/30' : isLoser ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'}`}>{isWinner ? 'YOU WON' : isLoser ? 'YOU LOST' : 'TIE GAME'}</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="bg-[#0a0a0a] border border-white/10 rounded-lg h-[450px] overflow-hidden flex flex-col">
                        <div className="flex border-b border-white/5">
                            <button onClick={() => setActiveTab('chain')} className={`flex-1 py-3 text-[10px] uppercase font-bold tracking-widest transition-all ${activeTab === 'chain' ? 'text-purple-400 bg-purple-900/10 border-b-2 border-purple-500' : 'text-gray-500 hover:text-gray-300'}`}>On_Chain_Events</button>
                            <button onClick={() => setActiveTab('social')} className={`flex-1 py-3 text-[10px] uppercase font-bold tracking-widest transition-all ${activeTab === 'social' ? 'text-purple-400 bg-purple-900/10 border-b-2 border-purple-500' : 'text-gray-500 hover:text-gray-300'}`}>Social_Hub</button>
                            <button onClick={() => setActiveTab('fame')} className={`flex-1 py-3 text-[10px] uppercase font-bold tracking-widest transition-all ${activeTab === 'fame' ? 'text-purple-400 bg-purple-900/10 border-b-2 border-purple-500' : 'text-gray-500 hover:text-gray-300'}`}>Hall_of_Fame</button>
                        </div>
                        <div className="flex-1 overflow-hidden p-4">
                            {activeTab === 'chain' ? (
                                <div className="h-full overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                    <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> Live_History</h3>
                                    {globalMatches.map(m => (
                                        <div key={m.id} className="text-[10px] font-mono border-l-2 border-white/10 pl-2 py-2 hover:border-purple-500 transition-colors bg-white/[0.02] rounded-r">
                                            <div className="flex justify-between"><span className="text-gray-500">#{m.id}</span> <span>{GAME_TYPES.find(g => g.id === m.gameType)?.label}</span></div>
                                            <div className="text-gray-300 truncate font-bold text-xs my-0.5">{m.challenger.slice(0, 6)}... vs {m.opponent.slice(0, 6)}...</div>
                                            <div className="flex justify-between mt-1 items-center"><span className="text-gray-500 font-bold">{formatUnits(m.wager, 18)} G$</span> <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${m.status === 2 ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-gray-500'}`}>{m.status === 2 ? 'COMPLETED' : 'WAITING...'}</span></div>
                                        </div>
                                    ))}
                                </div>
                            ) : activeTab === 'social' ? (
                                <div className="h-full overflow-y-auto px-1 custom-scrollbar"><MoltbookFeed agentAddress={CONTRACT_ADDRESSES.AI_AGENT} /></div>
                            ) : activeTab === 'fame' ? (
                                <div className="h-full overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                                    {leaderboard.map((champ, i) => (
                                        <div key={champ.address} className={`flex items-center justify-between p-3 rounded border ${i === 0 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-white/5 border-white/5'}`}>
                                            <div className="flex items-center gap-3"><div className="w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center font-bold text-xs">{i + 1}</div><div className="text-[10px] font-bold text-white">{champ.address.slice(0, 8)}...</div></div>
                                            <div className="text-right"><div className="text-sm font-bold text-white">{champ.count}</div><div className="text-[8px] text-gray-600 uppercase">Wins</div></div>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>

            {isVerifying ? (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-[#0a0a0a] border border-blue-500/50 rounded w-full max-w-lg shadow-[0_0_50px_rgba(37,99,235,0.1)]">
                        <div className="bg-blue-900/10 border-b border-blue-500/20 p-4 flex justify-between items-center">
                            <h3 className="text-blue-400 font-bold tracking-wider">{">> "} VERIFY_IDENTITY</h3>
                            <button onClick={cancelVerification} className="text-gray-500 hover:text-white">✕</button>
                        </div>
                        <SelfVerificationComponent />
                    </div>
                </div>
            ) : activeMatch && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-[#0a0a0a] border border-purple-500/50 rounded w-full max-w-lg shadow-[0_0_50px_rgba(139,92,246,0.1)]">
                        <div className="bg-purple-900/10 border-b border-purple-500/20 p-4 flex justify-between items-center">
                            <h3 className="text-purple-400 font-bold tracking-wider">{">> "} EXECUTE_MOVE</h3>
                            <button onClick={() => setActiveMatch(null)} className="text-gray-500 hover:text-white">✕</button>
                        </div>
                        <div className="p-8">
                            <div className="text-center mb-8">
                                <div className="text-sm text-gray-500 mb-1">MATCH_ID: #{activeMatch.id}</div>
                                <div className="text-2xl font-bold text-white mb-2">{GAME_TYPES.find(g => g.id === activeMatch.gameType)?.label}</div>
                                <div className="inline-block bg-blue-500/10 text-blue-300 px-3 py-1 rounded text-xs border border-blue-500/20">STAKE: {formatUnits(activeMatch.wager, 18)} G$</div>
                            </div>
                            {activeMatch.gameType === 1 ? (
                                <button onClick={() => handlePlayMove(activeMatch.id, Math.floor(Math.random() * 6) + 1)} className="w-full py-6 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-purple-500/50 rounded flex flex-col items-center gap-2 transition-all"><span className="text-4xl">🎲</span> ROLL_DICE_RNG</button>
                            ) : (
                                <div className="grid grid-cols-3 gap-3">
                                    {(activeMatch.gameType === 0 ? MOVES.RPS : MOVES.COIN).map((m) => (
                                        <button key={m.id} onClick={() => handlePlayMove(activeMatch.id, m.id)} className="p-4 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-purple-500/50 rounded flex flex-col items-center gap-2 transition-all"><span className="text-2xl">{m.icon}</span> <span className="text-[10px] font-bold uppercase">{m.label}</span></button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ArenaGame;
