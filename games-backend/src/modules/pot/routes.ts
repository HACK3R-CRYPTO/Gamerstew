import type { Application, Request, RequestHandler, Response } from 'express';
import type { Pot } from './service';

/** Today's pot is public: anyone may see the number and the board. `?wallet=` adds where that player stands. */
export function registerPotRoutes(app: Application, deps: { pot: Pot | null; requireSecret: RequestHandler }): void {
  app.get('/api/pot', (req: Request, res: Response) => {
    if (!deps.pot) { res.json({ on: false }); return; }
    const w = typeof req.query.wallet === 'string' && /^0x[0-9a-fA-F]{40}$/.test(req.query.wallet) ? req.query.wallet : undefined;
    deps.pot.today(w).then((view) => res.set('cache-control', 'public, max-age=20').json({ on: true, ...view })).catch((err) => { console.error('pot route failed:', err); if (!res.headersSent) res.status(500).json({ error: 'server_error' }); });
  });
  app.post('/internal/pot/settle', deps.requireSecret, (_req: Request, res: Response) => {
    if (!deps.pot) { res.json({ on: false }); return; }
    deps.pot.settleDue().then((out) => res.json(out)).catch(() => res.status(500).json({ error: 'server_error' }));
  });
}
