'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useWatchContractEvent } from 'wagmi';
import { toast } from 'react-hot-toast';
import { CONTRACT_ADDRESSES, ARENA_PLATFORM_ABI } from '@/lib/contracts';
import { getMoveDisplay } from '@/lib/gameLogic';

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

interface UseArenaEventsProps {
  onMatchUpdate: () => void;
  onGlobalUpdate: () => void;
  address: string | undefined;
  matches: Match[];
}

export function useArenaEvents({ onMatchUpdate, onGlobalUpdate, address, matches }: UseArenaEventsProps) {
  const matchesRef = useRef(matches);

  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);

  const triggerUpdates = useCallback(() => {
    onMatchUpdate();
    onGlobalUpdate();
  }, [onMatchUpdate, onGlobalUpdate]);

  useWatchContractEvent({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    eventName: 'MatchProposed',
    onLogs() {
      triggerUpdates();
    },
  });

  useWatchContractEvent({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    eventName: 'MatchAccepted',
    onLogs() {
      triggerUpdates();
    },
  });

  useWatchContractEvent({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    eventName: 'MovePlayed',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onLogs(logs: any[]) {
      triggerUpdates();
      const playerAddr = logs[0]?.args?.player as string | undefined;
      const move = Number(logs[0]?.args?.move);
      const matchId = Number(logs[0]?.args?.matchId);

      if (playerAddr && address && playerAddr.toLowerCase() !== address.toLowerCase()) {
        const match = matchesRef.current.find(m => m.id === matchId);
        if (match) {
          const moveDisplay = getMoveDisplay(match.gameType, move);
          const isChallenger = match.challenger.toLowerCase() === address.toLowerCase();
          const playerMoveVal = isChallenger ? match.challengerMove : match.opponentMove;
          let extraMsg = '';
          if (playerMoveVal !== null && playerMoveVal !== undefined) {
            const playerMoveDisplay = getMoveDisplay(match.gameType, playerMoveVal);
            extraMsg = ` vs Your ${playerMoveDisplay.icon}`;
          }
          toast(`Opponent played ${moveDisplay.icon}${extraMsg}`, {
            icon: '🤖',
            duration: 4000,
            style: { border: '1px solid #7c3aed', background: '#1a1f3a', color: '#fff' },
          });
        }
      }
    },
  });

  useWatchContractEvent({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    eventName: 'MatchCompleted',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onLogs(logs: any[]) {
      triggerUpdates();
      const winner = logs[0]?.args?.winner as string | undefined;
      const matchId = Number(logs[0]?.args?.matchId);
      const winnerAddr = winner ? winner.toLowerCase() : null;

      if (winnerAddr === address?.toLowerCase()) {
        toast.success('🎉 You Won a Match! Check history for details.', { duration: 5000 });
      } else if (address) {
        const match = matchesRef.current.find(m => m.id === matchId);
        if (match && (match.challenger.toLowerCase() === address.toLowerCase() || match.opponent.toLowerCase() === address.toLowerCase())) {
          toast.error('💀 Match Completed - You Lost.', { duration: 5000 });
        }
      }
    },
  });
}
