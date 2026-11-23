// ─── Score routes: HTTP only ─────────────────────────────────────────────────
//   POST /api/start-game   { wallet, game }                    → { sessionToken, seed? }
//   POST /api/sign-score   { playerAddress, game, sessionToken, … } → signature or gasless tx
//   POST /api/submit-score { playerAddress, scoreData }        → saved score, XP, rank

import type { Application, Request, RequestHandler, Response } from 'express';
import type { ScoreDeps } from './ports';
import { createScoreService, type Reply, type ScoreService } from './service';
import { createSubmitService, type SubmitDeps } from './submit';

export interface ScoreRouteDeps extends ScoreDeps {
  requireSecret: RequestHandler;
  limiter: RequestHandler;
}

export function registerScoreRoutes(app: Application, deps: ScoreRouteDeps): ScoreService {
  const service = createScoreService(deps);
  const body = (req: Request): Record<string, unknown> => (typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {});
  // A handler that throws answers with the route's own failure message, so the
  // player is never left waiting on a request that will not be answered.
  const route = (fn: (b: Record<string, unknown>) => Promise<Reply>, onCrash: string): RequestHandler => (req: Request, res: Response) => {
    Promise.resolve()
      .then(() => fn(body(req)))
      .then((out) => res.status(out.status).json(out.body))
      .catch((e) => { console.error(`${req.path} crashed:`, e); if (!res.headersSent) res.status(500).json({ error: onCrash }); });
  };
  app.post('/api/start-game', deps.requireSecret, deps.limiter, route(service.startGame, 'Failed to start session'));
  app.post('/api/sign-score', deps.requireSecret, deps.limiter, route(service.signScore, 'Failed to sign score'));
  return service;
}

export interface SubmitRouteDeps extends SubmitDeps {
  requireSecret: RequestHandler;
  limiter: RequestHandler;
  /** the configured internal secret, read at request time */
  internalSecret(): string | undefined;
}

//   POST /api/submit-score  { playerAddress, scoreData: { game, score, gameTime, txHash, … } }
export function registerSubmitRoute(app: Application, deps: SubmitRouteDeps) {
  const submit = createSubmitService(deps);
  app.post('/api/submit-score', deps.requireSecret, deps.limiter, (req: Request, res: Response) => {
    const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const secret = deps.internalSecret();
    const trusted = !!secret && req.headers['x-internal-secret'] === secret;
    Promise.resolve()
      .then(() => submit(body, trusted))
      .then((out) => res.status(out.status).json(out.body))
      .catch((e) => { console.error('/api/submit-score crashed:', e); if (!res.headersSent) res.status(500).json({ error: 'Failed to submit score' }); });
  });
  return submit;
}
