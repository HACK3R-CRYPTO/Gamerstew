import type { Application, Request, RequestHandler, Response } from 'express';
import type { Friends, Reply } from './service';

/** Reached only through the app's own server, which has checked the sign-in:
 *  `:address` is the wallet that sign-in proved, never one a browser chose. */
export function registerFriendRoutes(app: Application, deps: { friends: Friends; requireSecret: RequestHandler }): void {
  const body = (req: Request): Record<string, unknown> => (typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {});
  const send = (fn: (req: Request) => Promise<Reply>): RequestHandler => (req: Request, res: Response) => {
    fn(req).then((r) => res.status(r.status).json(r.body)).catch((err) => { console.error('friends route failed:', err); if (!res.headersSent) res.status(500).json({ error: 'server_error' }); });
  };
  app.get('/api/friends/:address', deps.requireSecret, send((req) => deps.friends.list(req.params.address)));
  app.post('/api/friends/:address/ping', deps.requireSecret, send(async (req) => deps.friends.ping(req.params.address)));
  app.post('/api/friends/:address/request', deps.requireSecret, send((req) => deps.friends.request(req.params.address, body(req).to)));
  app.post('/api/friends/:address/accept', deps.requireSecret, send((req) => deps.friends.accept(req.params.address, body(req).wallet)));
  app.post('/api/friends/:address/remove', deps.requireSecret, send((req) => deps.friends.remove(req.params.address, body(req).wallet)));
  app.post('/api/friends/:address/invite', deps.requireSecret, send((req) => deps.friends.invite(req.params.address, body(req).wallet, body(req).game, body(req).code)));
}
