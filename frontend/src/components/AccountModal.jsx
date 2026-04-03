import { useState } from 'react';
import { useAccount, useBalance, useReadContract } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { useSelfVerification } from '../contexts/SelfVerificationContext';
import { CONTRACT_ADDRESSES, ERC20_ABI } from '../config/contracts';
import { formatUnits } from 'viem';

export default function AccountModal({ isOpen, onClose }) {
  const { address: wagmiAddress } = useAccount();
  const { logout, exportWallet, user } = usePrivy();
  const { isVerified, claimG$, entitlement } = useSelfVerification();
  const [copied, setCopied] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(!entitlement);

  // Use wagmi address (active connected wallet) for all balance queries
  // user?.wallet?.address is the embedded wallet which may differ
  const address = wagmiAddress || user?.wallet?.address;

  const { data: celoBalance } = useBalance({ address });
  const { data: gRaw } = useReadContract({
    address: CONTRACT_ADDRESSES.G_TOKEN,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  if (!isOpen || !address) return null;

  const isEmbedded = user?.wallet?.walletClientType === 'privy';
  const celoVal = celoBalance ? parseFloat(formatUnits(celoBalance.value, 18)).toFixed(3) : '0';
  const gVal = gRaw != null ? parseFloat(formatUnits(gRaw, 18)).toFixed(2) : '0';

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '380px',
          background: '#0d0d1a', border: '1px solid rgba(168,85,247,0.2)',
          borderRadius: '20px', padding: '28px',
          fontFamily: 'Orbitron, monospace',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img
              src={`https://api.dicebear.com/9.x/pixel-art/svg?seed=${address}`}
              alt="avatar"
              style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#1a1a2e' }}
            />
            <span style={{ color: '#fff', fontSize: '14px', fontWeight: 900, letterSpacing: '1px' }}>YOUR ACCOUNT</span>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px', color: '#6b7280', fontSize: '16px',
            width: '32px', height: '32px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>x</button>
        </div>

        {/* Wallet address */}
        <button onClick={copyAddress} style={{
          width: '100%', padding: '12px 14px', marginBottom: '16px',
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ color: '#6b7280', fontSize: '8px', letterSpacing: '1px', marginBottom: '4px' }}>WALLET ADDRESS</div>
            <div style={{ color: '#fff', fontSize: '12px', fontWeight: 700, fontFamily: 'monospace' }}>
              {address.slice(0, 6)}...{address.slice(-4)}
            </div>
          </div>
          <span style={{ color: copied ? '#10b981' : '#6b7280', fontSize: '10px', fontWeight: 700 }}>
            {copied ? 'COPIED' : 'COPY'}
          </span>
        </button>

        {/* Balances */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
          <div style={{
            flex: 1, padding: '14px', borderRadius: '12px',
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ color: '#6b7280', fontSize: '8px', letterSpacing: '1px', marginBottom: '6px' }}>CELO</div>
            <div style={{ color: '#fff', fontSize: '18px', fontWeight: 900 }}>{celoVal}</div>
          </div>
          <div style={{
            flex: 1, padding: '14px', borderRadius: '12px',
            background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)',
          }}>
            <div style={{ color: '#f59e0b', fontSize: '8px', letterSpacing: '1px', marginBottom: '6px' }}>G$</div>
            <div style={{ color: '#f59e0b', fontSize: '18px', fontWeight: 900 }}>{gVal}</div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* View on explorer */}
          <a
            href={`https://celoscan.io/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              width: '100%', padding: '12px', borderRadius: '10px',
              background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)',
              color: '#a855f7', fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
              textDecoration: 'none', textAlign: 'center',
              fontFamily: 'Orbitron, monospace', display: 'block',
            }}
          >
            VIEW ON CELOSCAN
          </a>

          {/* Export key - only for Privy embedded wallets */}
          {isEmbedded && (
            <button onClick={exportWallet} style={{
              width: '100%', padding: '12px', borderRadius: '10px',
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
              color: '#f59e0b', fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
              cursor: 'pointer', fontFamily: 'Orbitron, monospace',
            }}>
              EXPORT PRIVATE KEY
            </button>
          )}

          {/* Claim G$ */}
          <button
            onClick={async () => {
              if (claimed) return;
              setClaiming(true);
              try {
                const timeout = new Promise((_, reject) => setTimeout(() => reject('timeout'), 30000));
                await Promise.race([claimG$(), timeout]);
                setClaimed(true);
              } catch (_) {
                // If it threw but the claim actually went through, still mark claimed
                setClaimed(true);
              }
              setClaiming(false);
            }}
            disabled={claiming || claimed}
            style={{
              width: '100%', padding: '12px', borderRadius: '10px',
              background: claimed ? 'rgba(16,185,129,0.05)' : 'rgba(16,185,129,0.12)',
              border: `1px solid rgba(16,185,129,${claimed ? '0.15' : '0.3'})`,
              color: claimed ? '#6b7280' : '#10b981',
              fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
              cursor: claiming || claimed ? 'default' : 'pointer',
              fontFamily: 'Orbitron, monospace',
              opacity: claiming ? 0.6 : 1,
            }}
          >
            {claimed ? 'CLAIMED TODAY' : claiming ? 'CLAIMING...' : entitlement ? `CLAIM ${parseFloat(formatUnits(entitlement, 18)).toFixed(2)} G$` : 'CLAIM DAILY G$'}
          </button>

          {/* Logout */}
          <button onClick={() => { logout(); onClose(); }} style={{
            width: '100%', padding: '12px', borderRadius: '10px',
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
            color: '#ef4444', fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
            cursor: 'pointer', fontFamily: 'Orbitron, monospace',
          }}>
            LOG OUT
          </button>
        </div>
      </div>
    </div>
  );
}
