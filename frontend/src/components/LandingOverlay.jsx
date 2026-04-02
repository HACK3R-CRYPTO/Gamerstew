import { useState, useEffect } from 'react';

const LandingOverlay = ({ onEnter }) => {
    const [text, setText] = useState('');
    const fullText = ">> SYSTEM_INITIALIZING...\n>> CONNECTING_TO_CELO_NETWORK...\n>> ESTABLISHING_SECURE_LINK...\n>> ACCESSING_ARENA_PROTOCOL...";
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
        }, 30);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center p-4 font-mono text-gray-300">
            <div className="max-w-2xl w-full border border-white/10 p-8 rounded-lg bg-black/50 backdrop-blur shadow-[0_0_50px_rgba(139,92,246,0.1)]">
                <div className="flex justify-between items-center mb-8 border-b border-white/10 pb-4">
                    <span className="text-xs text-gray-600">TERMINAL_V.3.0.1</span>
                    <div className="flex gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500/20"></div>
                        <div className="w-3 h-3 rounded-full bg-yellow-500/20"></div>
                        <div className="w-3 h-3 rounded-full bg-green-500/20"></div>
                    </div>
                </div>

                <div className="min-h-[120px] mb-8 font-bold text-sm md:text-base leading-relaxed whitespace-pre-line text-purple-400">
                    {text}
                    <span className="animate-pulse">_</span>
                </div>

                <div className={`transition-opacity duration-1000 ${showButton ? 'opacity-100' : 'opacity-0'}`}>
                    <div className="text-6xl mb-4 animate-bounce">
                        🦞
                    </div>
                    <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-600">
                        ARENA_CHAMPION
                    </h1>
                    <p className="text-gray-400 mb-8 max-w-lg">
                        You are entering a sovereign autonomous zone.
                        Your mission: Outsmart the Markov-1 AI Agent in high-stakes games.
                    </p>

                    <div className="flex flex-col gap-4">
                        <button
                            onClick={onEnter}
                            className="w-full py-4 bg-purple-600 hover:bg-purple-500 text-white font-bold tracking-widest uppercase transition-all hover:scale-[1.02] shadow-[0_0_20px_rgba(147,51,234,0.3)]"
                        >
                            [ ENTER_ARENA ] — PvP vs AI
                        </button>

                        <button
                            onClick={() => { onEnter(); setTimeout(() => window.location.href = '/games', 50); }}
                            className="w-full py-4 bg-transparent border border-purple-500/40 hover:border-purple-400 text-purple-300 hover:text-purple-200 font-bold tracking-widest uppercase transition-all hover:scale-[1.02]"
                            style={{ fontFamily: 'Orbitron, monospace' }}
                        >
                            [ PLAY_GAMES ] — Rhythm & Memory
                        </button>

                        <div className="flex gap-4 justify-center text-xs text-gray-500">
                            <a
                                href="https://gooddollar.org"
                                target="_blank"
                                className="text-purple-400 hover:text-purple-300 underline underline-offset-4 font-bold transition-all"
                            >
                                GET_G_TOKEN
                            </a>
                            <span>|</span>
                            <a
                                href="/ARENA_SKILL.md"
                                target="_blank"
                                className="hover:text-purple-400 underline underline-offset-4 decoration-white/20 hover:decoration-purple-400"
                            >
                                READ_SKILL_DOCS
                            </a>
                            <span>|</span>
                            <a
                                href="https://celo.org"
                                target="_blank"
                                className="hover:text-purple-400 underline underline-offset-4 decoration-white/20 hover:decoration-purple-400"
                            >
                                CELO_NETWORK
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            <div className="absolute bottom-8 text-[10px] text-gray-700">
                SECURE_CONNECTION_ESTABLISHED__ENCRYPTED_V2
            </div>
        </div>
    );
};

export default LandingOverlay;
