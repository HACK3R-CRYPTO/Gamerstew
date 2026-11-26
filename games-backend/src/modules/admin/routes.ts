import type { Application, Request, RequestHandler, Response } from 'express';
import type { AdminService, Reply } from './service';

/** Every route needs the internal secret: only the site's own server calls
 *  these. It has checked the admin's signed cookie and passes their email in
 *  `x-admin-email`; the service looks the admin up again before doing anything. */
export function registerAdminRoutes(app: Application, deps: { admin: AdminService; requireSecret: RequestHandler }) {
  const body = (req: Request): Record<string, unknown> => (typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {});
  const me = (req: Request) => req.headers['x-admin-email'];
  const send = (fn: (req: Request) => Promise<Reply>): RequestHandler => (req: Request, res: Response) => {
    fn(req).then((r) => res.status(r.status).set('Cache-Control', 'no-store').json(r.body)).catch((e) => { console.error('admin route failed:', e); if (!res.headersSent) res.status(500).json({ error: 'server_error' }); });
  };
  const s = deps.requireSecret; const a = deps.admin;
  app.post('/internal/admin/login', s, send((req) => a.login(body(req))));
  app.get('/internal/admin/q/:what', s, send((req) => a.read(me(req), String(req.params.what ?? ''), req.query as Record<string, unknown>)));
  app.post('/internal/admin/announce', s, send((req) => a.announce(me(req), body(req))));
  app.post('/internal/admin/payouts', s, send((req) => a.recordPayout(me(req), body(req))));
  app.post('/internal/admin/payouts/status', s, send((req) => a.setPayoutStatus(me(req), body(req))));
  app.post('/internal/admin/admins', s, send((req) => a.saveAdmin(me(req), body(req))));
  app.post('/internal/admin/admins/disable', s, send((req) => a.disableAdmin(me(req), body(req))));
  app.post('/internal/track', s, send((req) => a.track(body(req))));
}
