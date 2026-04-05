'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from '@/lib/contracts';
import { toast } from 'react-hot-toast';

export default function GamePassGate({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const { login } = usePrivy();
  const { writeContractAsync } = useWriteContract();
  const [usernameInput, setUsernameInput] = useState('');
  const [minting, setMinting] = useState(false);

  const { data: hasPass, refetch } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: 'hasMinted',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  if (isConnected && hasPass) return <>{children}</>;

  const mintPass = async () => {
    if (!usernameInput || usernameInput.length < 3) {
      toast.error('Username must be 3-16 characters');
      return;
    }
    setMinting(true);
    try {
      toast.loading('Minting Game Pass...', { id: 'gate-mint' });
      await writeContractAsync({
        address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
        abi: GAME_PASS_ABI,
        functionName: 'mint',
        args: [usernameInput],
      });
      toast.success(`Welcome, ${usernameInput}!`, { id: 'gate-mint' });
      refetch();
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      const msg = e.shortMessage || e.message || 'Mint failed';
      if (msg.includes('Username taken')) toast.error('Username taken, try another', { id: 'gate-mint' });
      else if (msg.includes('Already minted')) { toast.success('You already have a pass!', { id: 'gate-mint' }); refetch(); }
      else toast.error(msg, { id: 'gate-mint' });
    } finally {
      setMinting(false);
    }
  };

  return (
    <div style={{ fontFamily: 'Orbitron, monospace', maxWidth: '440px', margin: '60px auto', textAlign: 'center', padding: '0 20px' }}>
      <img src="/logo.png" alt="GameArena" style={{ width: '72px', height: '72px', borderRadius: '16px', marginBottom: '16px' }} />
      <h2 style={{ color: '#fff', fontSize: '18px', fontWeight: 900, letterSpacing: '3px', margin: '0 0 8px' }}>GAME PASS REQUIRED</h2>
      <p style={{ color: '#6b7280', fontSize: '11px', lineHeight: '1.6', marginBottom: '24px' }}>
        Mint a free Game Pass NFT to play. Pick a username — it shows on the leaderboard.
      </p>

      {!isConnected ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
          <button onClick={() => login()} style={{
            width: '100%', padding: '14px 32px', borderRadius: '12px', cursor: 'pointer',
            background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
            border: 'none', color: '#fff', fontSize: '13px', fontWeight: 700,
            fontFamily: 'Orbitron, monospace', letterSpacing: '2px',
            boxShadow: '0 4px 20px rgba(168,85,247,0.3)',
          }}>CONNECT WALLET</button>
          <Link href="/" style={{
            padding: '10px 24px', borderRadius: '10px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#6b7280', fontSize: '10px', textDecoration: 'none',
            fontFamily: 'Orbitron, monospace', letterSpacing: '1px',
          }}>← BACK TO GAMES</Link>
        </div>
      ) : (
        <div style={{ padding: '20px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '14px' }}>
          <div style={{ color: '#10b981', fontSize: '10px', letterSpacing: '2px', fontWeight: 700, marginBottom: '12px' }}>CHOOSE YOUR USERNAME</div>
          <input
            type="text"
            placeholder="Enter username..."
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16))}
            onKeyDown={(e) => e.key === 'Enter' && mintPass()}
            style={{
              width: '100%', padding: '12px 16px', marginBottom: '12px',
              background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(16,185,129,0.3)',
              borderRadius: '10px', color: '#fff', fontSize: '14px',
              fontFamily: 'Orbitron, monospace', outline: 'none',
              textAlign: 'center', letterSpacing: '1px', boxSizing: 'border-box',
            }}
          />
          <button onClick={mintPass} disabled={minting || usernameInput.length < 3} style={{
            width: '100%', padding: '12px', borderRadius: '10px', cursor: 'pointer',
            background: usernameInput.length >= 3 ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.05)',
            border: 'none', color: '#fff', fontSize: '12px', fontWeight: 700,
            fontFamily: 'Orbitron, monospace', letterSpacing: '2px',
            opacity: minting || usernameInput.length < 3 ? 0.5 : 1,
          }}>{minting ? 'MINTING...' : 'MINT GAME PASS (FREE)'}</button>
          <div style={{ color: '#374151', fontSize: '9px', marginTop: '10px' }}>3-16 chars · letters, numbers, underscore · soulbound NFT</div>
          <Link href="/" style={{
            display: 'inline-block', marginTop: '16px', padding: '8px 20px',
            borderRadius: '8px', background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#6b7280', fontSize: '10px', textDecoration: 'none',
            fontFamily: 'Orbitron, monospace', letterSpacing: '1px',
          }}>← BACK TO GAMES</Link>
        </div>
      )}
    </div>
  );
}
