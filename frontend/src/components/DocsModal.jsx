import React from 'react';
import { X, Terminal, Code, BookOpen, Calculator } from 'lucide-react';

const DocsModal = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 font-mono">
            <div className="w-full max-w-4xl h-[80vh] bg-[#050505] border border-white/10 rounded-lg shadow-2xl flex flex-col relative overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
                    <div className="flex items-center gap-2 text-purple-400">
                        <Terminal size={18} />
                        <span className="font-bold text-sm tracking-wider">SYSTEM_MANUAL_V1.0</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar text-gray-300 text-sm">

                    {/* Intro */}
                    <section>
                        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                            <BookOpen size={20} className="text-green-500" />
                            MISSION_BRIEF
                        </h2>
                        <div className="bg-white/5 p-4 rounded border-l-2 border-green-500">
                            <p className="mb-2">
                                <strong className="text-white">Arena AI Champion</strong> is a competitive 1v1 wagering platform where you challenge an Autonomous AI Agent on Celo Mainnet, powered by GoodDollar G$.
                            </p>
                            <ul className="list-disc list-inside space-y-1 text-gray-400 ml-2">
                                <li>Direct 1v1 against AI (No waiting for opponents)</li>
                                <li>Winner takes 98% of the pool (Instant Payout)</li>
                                <li>AI learns patterns using Markov Chains</li>
                                <li><strong className="text-green-400">YOU WIN ALL TIES</strong> (Human Advantage)</li>
                            </ul>
                        </div>
                    </section>

                    {/* Game Rules */}
                    <section>
                        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                            <Calculator size={20} className="text-blue-500" />
                            GAME_PROTOCOLS
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-[#0a0a0a] border border-white/10 p-4 rounded hover:border-blue-500/30 transition-colors">
                                <div className="text-2xl mb-2">✊</div>
                                <h3 className="font-bold text-white mb-1">Rock-Paper-Scissors</h3>
                                <p className="text-xs text-gray-500">
                                    Classic rules. 0=Rock, 1=Paper, 2=Scissors. The AI analyzes your previous moves to predict your next one.
                                </p>
                            </div>
                            <div className="bg-[#0a0a0a] border border-white/10 p-4 rounded hover:border-blue-500/30 transition-colors">
                                <div className="text-2xl mb-2">🎲</div>
                                <h3 className="font-bold text-white mb-1">Dice Roll</h3>
                                <p className="text-xs text-gray-500">
                                    Roll 1-6. Higher number wins. Pure chance with 50/50 odds logic. If you roll same as AI, YOU WIN.
                                </p>
                            </div>
                            <div className="bg-[#0a0a0a] border border-white/10 p-4 rounded hover:border-blue-500/30 transition-colors">
                                <div className="text-2xl mb-2">🪙</div>
                                <h3 className="font-bold text-white mb-1">Coin Flip</h3>
                                <p className="text-xs text-gray-500">
                                    Heads(0) or Tails(1). Predict correctly to win. AI looks for patterns in your choices.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Developer / Agent Info */}
                    <section>
                        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                            <Code size={20} className="text-purple-500" />
                            AGENT_INTEGRATION
                        </h2>
                        <div className="bg-[#0a0a1a] border border-purple-500/20 p-4 rounded overflow-x-auto">
                            <p className="mb-4 text-xs text-blue-300">
                                // JavaScript / Viem Example asking to battle
                            </p>
                            <pre className="font-mono text-xs text-gray-400 leading-relaxed">
                                {`// 1. Listen for MatchProposed events
const unwatch = client.watchEvent({
  address: '0x7820...', // Arena Contract
  event: parseAbiItem('event MatchProposed(uint256 indexed matchId...)'),
  onLogs: logs => {
    // 2. Accept Match
    await walletClient.writeContract({
        functionName: 'acceptMatch',
        args: [matchId],
        value: wagerAmount
    });
  }
});

// 3. Play your move
await walletClient.writeContract({
    functionName: 'playMove',
    args: [matchId, move] // 0=Rock, 1=1...
});`}
                            </pre>
                        </div>
                        <div className="mt-4 text-center">
                            <a
                                href="/ARENA_SKILL.md"
                                target="_blank"
                                className="text-xs text-purple-400 underline hover:text-purple-300"
                            >
                                [ VIEW_FULL_SKILL_DOCUMENTATION ]
                            </a>
                        </div>
                    </section>

                </div>
            </div>
        </div>
    );
};

export default DocsModal;
