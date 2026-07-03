// ─── Arena match share card ──────────────────────────────────────────────────
// Renders a shareable 1080×1080 result card on a canvas — no server, no
// dependencies. Free forever by design: every shared "I beat the AI" card
// is an ad. Uses Web Share API (files) on mobile, falls back to a PNG
// download on desktop.

type ShareCardInput = {
  outcome: 'player_won' | 'ai_won' | 'tie';
  playerScore: number;
  aiScore: number;
  calledCount?: number;
  totalRounds?: number;
  favoriteMove?: string | null;
  favoritePct?: number | null;
};

const MARKOV_ART = '/games/challenge-ai-v2/ai-bot-medium.png';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function renderArenaShareCard(input: ShareCardInput): Promise<Blob> {
  const S = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  const won = input.outcome === 'player_won';
  const tied = input.outcome === 'tie';

  // Background — the app's purple night gradient
  const bg = ctx.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, '#2a0d6e'); bg.addColorStop(0.4, '#1a0552'); bg.addColorStop(1, '#0a0226');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  // Accent glow behind the bot
  const glow = ctx.createRadialGradient(S / 2, 360, 40, S / 2, 360, 420);
  glow.addColorStop(0, won ? 'rgba(34,197,94,0.35)' : tied ? 'rgba(167,139,250,0.3)' : 'rgba(251,191,36,0.3)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  // Sparkles
  ctx.fillStyle = 'rgba(253,230,138,0.8)';
  for (const [x, y, r] of [[140, 180, 5], [920, 150, 4], [180, 760, 4], [900, 700, 5], [540, 120, 3]] as const) {
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2); ctx.quadraticCurveTo(x + r * 0.5, y - r * 0.5, x + r * 2, y);
    ctx.quadraticCurveTo(x + r * 0.5, y + r * 0.5, x, y + r * 2);
    ctx.quadraticCurveTo(x - r * 0.5, y + r * 0.5, x - r * 2, y);
    ctx.quadraticCurveTo(x - r * 0.5, y - r * 0.5, x, y - r * 2);
    ctx.fill();
  }

  // MARKOV art
  try {
    const bot = await loadImage(MARKOV_ART);
    const bw = 380;
    ctx.save();
    if (!won && !tied) { /* MARKOV won — he stands proud */ }
    else if (won) { ctx.filter = 'grayscale(0.5) brightness(0.75)'; } // beaten bot
    ctx.drawImage(bot, S / 2 - bw / 2, 170, bw, bw);
    ctx.restore();
  } catch { /* card still works without the art */ }

  // Headline
  ctx.textAlign = 'center';
  ctx.fillStyle = won ? '#86efac' : tied ? '#c4b5fd' : '#fbbf24';
  ctx.font = '900 92px system-ui, -apple-system, sans-serif';
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 40;
  ctx.fillText(won ? 'I BEAT THE AI' : tied ? 'DEAD EVEN' : 'MARKOV WINS', S / 2, 660);
  ctx.shadowBlur = 0;

  // Score line
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 58px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${input.playerScore} — ${input.aiScore}`, S / 2, 740);

  // Model stat — the hook
  ctx.fillStyle = 'rgba(220,210,255,0.85)';
  ctx.font = '600 34px system-ui, -apple-system, sans-serif';
  const stat = won
    ? (input.calledCount && input.calledCount > 0
        ? `It read my mind ${input.calledCount}× and I still won.`
        : 'It models your patterns. I broke mine.')
    : input.favoriteMove && input.favoritePct
      ? `It learned I throw ${input.favoriteMove} ${input.favoritePct}% of the time.`
      : 'It learns your patterns. Bring your best.';
  ctx.fillText(stat, S / 2, 810);

  // Challenge line
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '800 40px system-ui, -apple-system, sans-serif';
  ctx.fillText('Think you can do better?', S / 2, 900);

  // Footer — brand + URL
  ctx.fillStyle = '#fbbf24';
  ctx.font = '900 44px system-ui, -apple-system, sans-serif';
  ctx.fillText('⚔️ gamearenahq.xyz', S / 2, 990);
  ctx.fillStyle = 'rgba(220,210,255,0.45)';
  ctx.font = '700 24px system-ui, -apple-system, sans-serif';
  ctx.fillText('FREE · INSTANT · PROVABLY FAIR · ON CELO', S / 2, 1035);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
}

export async function shareArenaCard(input: ShareCardInput): Promise<'shared' | 'downloaded'> {
  const blob = await renderArenaShareCard(input);
  const file = new File([blob], 'gamearena-markov.png', { type: 'image/png' });

  // Web Share API with files (mobile) — the one-tap path to WhatsApp/TG/X.
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'GameArena',
        text: 'I fought MARKOV, the AI that learns your patterns ⚔️ gamearenahq.xyz',
      });
      return 'shared';
    } catch { /* user cancelled → fall through to download */ }
  }

  // Desktop fallback: download the PNG.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'gamearena-markov.png';
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
