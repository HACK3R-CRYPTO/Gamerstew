import { useState, useEffect } from 'react';

const LandingOverlay = ({ onEnter }) => {
    const [text, setText] = useState('');
    const fullText = ">> INITIALIZING_GAME_ARENA...\n>> CONNECTING_TO_CELO_MAINNET...\n>> LOADING_G$_PROTOCOL...\n>> READY_TO_PLAY...";
    const [showButton, setShowButton] = useState(false);

    useEffect(() => {
        let i = 0;
        const timer = setInterval(() => {
            setText(fullText.slice(0, i));
            i++;
            if (i > fullText.length) {
                clearInterval(timer);
                setShowButton(true);
            }
        }, 25);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center p-4" style={{ fontFamily: 'Orbitron, monospace' }}>
            <div style={{
                maxWidth: '480px', width: '100%', padding: '32px',
                background: 'linear-gradient(160deg, rgba(168,85,247,0.06), rgba(6,6,14,0.98))',
                border: '1px solid rgba(168,85,247,0.15)', borderRadius: '20px',
                boxShadow: '0 0 60px rgba(168,85,247,0.08)',
            }}>
                {/* Terminal header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <span style={{ fontSize: '9px', color: '#374151', letterSpacing: '2px' }}>GAME_ARENA v1.0</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', opacity: 0.4 }} />
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', opacity: 0.4 }} />
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', opacity: 0.4 }} />
                    </div>
                </div>

                {/* Boot text */}
                <div style={{ minHeight: '90px', marginBottom: '24px', fontSize: '11px', lineHeight: 1.8, whiteSpace: 'pre-line', color: '#a855f7', fontWeight: 700 }}>
                    {text}
                    <span style={{ animation: 'blink 1s step-end infinite' }}>_</span>
                </div>

                {/* Main content */}
                <div style={{ transition: 'opacity 0.8s', opacity: showButton ? 1 : 0 }}>
                    <div style={{ fontSize: '42px', marginBottom: '8px' }}>🎮</div>
                    <h1 style={{
                        fontSize: '32px', fontWeight: 900, letterSpacing: '3px', margin: '0 0 6px',
                        background: 'linear-gradient(135deg, #fff 0%, #a855f7 100%)',
                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                        lineHeight: 1.1,
                    }}>
                        GAME<span style={{ WebkitTextFillColor: '#a855f7' }}>_</span>ARENA
                    </h1>
                    <p style={{ color: '#6b7280', fontSize: '11px', lineHeight: 1.5, marginBottom: '24px', maxWidth: '360px' }}>
                        Play skill games, wager G$, compete on weekly leaderboards.
                        Every wager funds GoodDollar UBI — play to earn, play for good.
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {/* Solo games — primary CTA */}
                        <button
                            onClick={onEnter}
                            style={{
                                width: '100%', padding: '16px',
                                background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
                                border: 'none', borderRadius: '14px',
                                color: '#fff', fontSize: '13px', fontWeight: 900, letterSpacing: '2px',
                                cursor: 'pointer', transition: 'all 0.2s',
                                boxShadow: '0 4px 20px rgba(168,85,247,0.3)',
                            }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                        >
                            PLAY GAMES
                        </button>

                        {/* AI Arena — secondary */}
                        <button
                            onClick={() => { onEnter(); setTimeout(() => window.location.href = '/arena', 50); }}
                            style={{
                                width: '100%', padding: '14px',
                                background: 'transparent',
                                border: '1px solid rgba(168,85,247,0.3)', borderRadius: '14px',
                                color: '#a855f7', fontSize: '11px', fontWeight: 700, letterSpacing: '2px',
                                cursor: 'pointer', transition: 'all 0.2s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#a855f7'; e.currentTarget.style.background = 'rgba(168,85,247,0.06)'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(168,85,247,0.3)'; e.currentTarget.style.background = 'transparent'; }}
                        >
                            CHALLENGE AI AGENT
                        </button>

                        {/* Links */}
                        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '8px' }}>
                            {[
                                { label: 'GET G$', href: 'https://gooddollar.org' },
                                { label: 'CELO', href: 'https://celo.org' },
                                { label: 'LEADERBOARD', href: '/leaderboard', internal: true },
                            ].map((link, i) => (
                                <a key={i}
                                    href={link.href}
                                    target={link.internal ? undefined : '_blank'}
                                    rel={link.internal ? undefined : 'noopener noreferrer'}
                                    onClick={link.internal ? (e) => { e.preventDefault(); onEnter(); setTimeout(() => window.location.href = link.href, 50); } : undefined}
                                    style={{
                                        color: '#4b5563', fontSize: '9px', fontWeight: 700, letterSpacing: '1px',
                                        textDecoration: 'none', transition: 'color 0.2s',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.color = '#a855f7'}
                                    onMouseLeave={e => e.currentTarget.style.color = '#4b5563'}
                                >{link.label}</a>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div style={{ position: 'absolute', bottom: '24px', textAlign: 'center' }}>
                <div style={{ color: '#1f2937', fontSize: '9px', letterSpacing: '1px' }}>
                    BUILT ON CELO · POWERED BY GOODDOLLAR G$
                </div>
            </div>

            <style>{`@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }`}</style>
        </div>
    );
};

export default LandingOverlay;
