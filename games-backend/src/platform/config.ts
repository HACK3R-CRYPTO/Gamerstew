// ─── Configuration ───────────────────────────────────────────────────────────
// Every setting the platform layer reads from the environment, read ONCE and
// given a type. This server signs live scores, so a bad setting must never stop
// it from starting: a value that is missing or malformed falls back to a safe
// default and is reported in `warnings`, loudly, at boot.

type Env = Record<string, string | undefined>;

export interface Config {
  port: number;
  allowedOrigins: string[];
  /** a request slower than this is logged as slow */
  slowRequestMs: number;
  /** a request with no reply after this long is answered with a 504 */
  requestTimeoutMs: number;
  /** a database call that has not answered by now is abandoned */
  dbTimeoutMs: number;
  /** how long in-flight requests get to finish when the platform stops us */
  shutdownGraceMs: number;
  /** things that were tolerated but should be fixed */
  warnings: string[];
}

export function loadConfig(env: Env = process.env): Config {
  const warnings: string[] = [];
  const int = (key: string, fallback: number, min: number, max: number): number => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= min && n <= max) return n;
    warnings.push(`${key}="${raw}" is not a whole number from ${min} to ${max}; using ${fallback}`);
    return fallback;
  };

  // Origins are tidied, never rejected: a hand-typed entry with a trailing slash
  // or a path is what a person means. Anything that is not an http(s) origin is
  // kept exactly as typed, so an unusual scheme that worked before still works.
  const rawOrigins = env.ALLOWED_ORIGINS?.trim();
  if (!rawOrigins) warnings.push('ALLOWED_ORIGINS is not set: every browser request will be refused');
  const allowedOrigins = (rawOrigins ?? '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => {
    try {
      const u = new URL(o);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return o;
      if (u.origin !== o) warnings.push(`ALLOWED_ORIGINS entry "${o}" was read as "${u.origin}"`);
      return u.origin;
    } catch {
      warnings.push(`ALLOWED_ORIGINS entry "${o}" is not an origin (scheme://host); kept as typed`);
      return o;
    }
  });

  return {
    port: int('PORT', 3005, 1, 65535),
    allowedOrigins,
    slowRequestMs: int('SLOW_REQUEST_MS', 1500, 50, 60000),
    requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 30000, 1000, 300000),
    dbTimeoutMs: int('DB_TIMEOUT_MS', 12000, 500, 60000),
    shutdownGraceMs: int('SHUTDOWN_GRACE_MS', 10000, 0, 60000),
    warnings,
  };
}
