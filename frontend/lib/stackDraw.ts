// How a Stack Tower block is drawn. Shared by the game (app/games/stack) and by
// the spectator's replay (components/StackReplay), so a watcher sees the same
// blocks the player does.

export const BLOCK_H = 28;                 // pixel height of each stacked slab
export const HUES = [195, 215, 245, 275, 300, 330, 0, 30, 50];

// Blocks cosmetic swaps in an icy-glass palette — a fixed cyan face with a
// brighter top gloss and a translucent inner highlight that reads as glass.
// `hue` is kept for the default skin; crystal ignores it so the whole tower
// stays a single cohesive material.
export function drawSlab(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, hue: number, crystal: boolean, moving: boolean,
) {
  // Every slab is a solid block seen slightly from above and to the left: a lit
  // top face and a shaded right side are drawn behind the front face. The front
  // face is still the one that counts for alignment, so the game plays exactly
  // as before; the tower just looks like a real stack with ledges where a block
  // was cut short.
  const DX = 13, DY = 8;
  ctx.fillStyle = crystal ? "hsl(188 90% 78%)" : `hsl(${hue} 88% ${moving ? 74 : 70}%)`;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w + DX, y - DY); ctx.lineTo(x + DX, y - DY); ctx.closePath(); ctx.fill();
  ctx.fillStyle = crystal ? "hsl(200 70% 18%)" : `hsl(${hue} 78% 20%)`;
  ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w + DX, y - DY); ctx.lineTo(x + w + DX, y - DY + BLOCK_H); ctx.lineTo(x + w, y + BLOCK_H); ctx.closePath(); ctx.fill();
  if (crystal) {
    const fh = BLOCK_H - 3;                           // face height
    ctx.fillStyle = "hsl(200 65% 24%)";              // deep ice shadow
    ctx.fillRect(x, y + 3, w, BLOCK_H);
    ctx.fillStyle = "hsl(190 80% 56%)";              // cyan glass face
    ctx.fillRect(x, y, w, fh);
    // Cut-gem facets — a bright upper-left triangle and a darker lower-right
    // one split the face diagonally, so it reads as a faceted crystal, not a
    // flat cyan slab. This is the "I clearly paid for this" difference.
    ctx.fillStyle = "rgba(236,254,255,0.22)";        // lit facet
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x, y + fh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(8,42,64,0.28)";            // shaded facet
    ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + fh); ctx.lineTo(x, y + fh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(230,252,255,0.7)";         // bright top edge
    ctx.fillRect(x, y, w, 3);
    // Specular sparkle — a small 4-point glint near the top-left corner
    const gx = x + Math.min(14, w * 0.22), gy = y + 7, s = 3.2;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.moveTo(gx, gy - s * 1.8); ctx.lineTo(gx + s * 0.7, gy); ctx.lineTo(gx + s * 1.8, gy);
    ctx.lineTo(gx + s * 0.7, gy + s * 0.4); ctx.lineTo(gx, gy + s * 1.8); ctx.lineTo(gx - s * 0.7, gy + s * 0.4);
    ctx.lineTo(gx - s * 1.8, gy); ctx.lineTo(gx - s * 0.7, gy); ctx.closePath(); ctx.fill();
    return;
  }
  ctx.fillStyle = `hsl(${hue} 80% 28%)`;
  ctx.fillRect(x, y + 3, w, BLOCK_H);
  ctx.fillStyle = `hsl(${hue} 78% 56%)`;
  ctx.fillRect(x, y, w, BLOCK_H - 3);
  ctx.fillStyle = `rgba(255,255,255,${moving ? 0.3 : 0.25})`;
  ctx.fillRect(x, y, w, 4);
}

