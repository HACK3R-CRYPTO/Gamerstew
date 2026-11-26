import type { Application, Request, Response } from 'express';
import type { Cashouts } from './service';

/** GoodCash calls this from its own servers: no browser, no Origin, no secret of ours.
 *  The signature on the exact bytes is the proof (checked in the service). */
export function registerCashoutRoutes(app: Application, deps: { cashouts: Cashouts }): void {
  app.post('/api/goodcash/webhook', (req: Request, res: Response) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    deps.cashouts.webhook(raw, req.headers['goodcash-signature'])
      .then((r) => res.status(r.status).json(r.body))
      .catch((err) => { console.error('goodcash webhook failed:', err); if (!res.headersSent) res.status(500).json({ error: 'server_error' }); });
  });
}
