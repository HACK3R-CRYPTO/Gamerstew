// ─── Input rules that hold for every route ───────────────────────────────────
// A wallet address is the one value almost every route takes, and it reaches
// database filters (some of them pattern matches, where "%" means "anything").
// Checking it route by route meant some routes checked and some did not.
//
// So the rule lives here, once: anything that is NAMED like a wallet must BE a
// wallet, wherever it arrives (path, query string or body), before any route
// sees it. A route can still apply stricter checks of its own.

import type { Application, NextFunction, Request, Response } from 'express';

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
export const isWallet = (v: unknown): v is string => typeof v === 'string' && WALLET_RE.test(v);

/** Path parameters that carry a wallet, e.g. /api/user/:address */
export const WALLET_PARAMS = ['address', 'wallet'] as const;
/** Body and query fields that carry a wallet */
export const WALLET_FIELDS = ['playerAddress', 'wallet', 'walletAddress', 'player'] as const;

const refuse = (res: Response, where: string, name: string) => res.status(400).json({ error: 'Invalid wallet address', field: name, in: where });

/** Every route with :address or :wallet in its path refuses anything that is not one. */
export function guardWalletParams(app: Application, names: readonly string[] = WALLET_PARAMS): void {
  for (const name of names) {
    app.param(name, (_req: Request, res: Response, next: NextFunction, value: unknown) => {
      if (isWallet(value)) next();
      else refuse(res, 'path', name);
    });
  }
}

/** Mount after the body parser. A wallet field that is present must be valid;
 *  a field that is absent is left for the route to complain about in its own words. */
export function guardWalletFields(fields: readonly string[] = WALLET_FIELDS) {
  const present = (v: unknown) => v !== undefined && v !== null && v !== '';
  return (req: Request, res: Response, next: NextFunction) => {
    const body = typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : null;
    const query = req.query as Record<string, unknown>;
    for (const f of fields) {
      if (body && present(body[f]) && !isWallet(body[f])) return void refuse(res, 'body', f);
      if (present(query[f]) && !isWallet(query[f])) return void refuse(res, 'query', f);
    }
    next();
  };
}
