import type { Application, Request, RequestHandler, Response } from 'express';
import type { Inbox, Reply } from './service';

/** Every route here needs the internal secret: reading someone's inbox is
 *  harmless, but marking read and deleting are done FOR a player, so they come
 *  through our own frontend server, which has checked who is asking. */
export function registerInboxRoutes(app: Application, deps: { inbox: Inbox; requireSecret: RequestHandler }) {
  const body = (req: Request): Record<string, unknown> => (typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {});
  const send = (fn: (req: Request) => Promise<Reply>): RequestHandler => (req: Request, res: Response) => {
    fn(req).then((r) => res.status(r.status).json(r.body)).catch((e) => { console.error('inbox route failed:', e); if (!res.headersSent) res.status(500).json({ error: 'server_error' }); });
  };
  app.get('/api/inbox/:address', deps.requireSecret, send((req) => deps.inbox.list(req.params.address, req.query as Record<string, unknown>)));
  app.post('/api/inbox/:address/read', deps.requireSecret, send((req) => deps.inbox.read(req.params.address, body(req))));
  app.post('/api/inbox/:address/delete', deps.requireSecret, send((req) => deps.inbox.remove(req.params.address, body(req))));
  app.post('/internal/announce', deps.requireSecret, send((req) => deps.inbox.announce(body(req))));
}
