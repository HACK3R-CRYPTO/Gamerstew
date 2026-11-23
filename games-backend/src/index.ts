// The compiled entry the legacy server.js loads. Everything new is written in
// TypeScript under src/ and reaches the old file through here, one module at a
// time, until the old file is empty.
export { loadConfig, type Config } from './platform/config';
export { installLifecycle } from './platform/lifecycle';
export { createMetrics } from './platform/metrics';
export { registerStrikeRoutes } from './modules/strike/routes';
export { registerScoreRoutes, registerSubmitRoute } from './modules/scores/routes';
export { supabaseSessions, supabaseSeason, supabaseBestThisSeason, ethersChain } from './modules/scores/adapters';
export { registerBoardRoutes } from './modules/board/routes';
export { supabaseStreaks, subgraphSeasonPlayers } from './modules/board/adapters';
export { registerSeasonsRoutes } from './modules/seasons/routes';
export { supabaseTopActivity, supabaseSealedSeasons } from './modules/seasons/adapters';
export { catchAsync, hardenApp, installErrorHandlers, fetchWithTimeout } from './platform/http';
export { guardWalletParams, guardWalletFields, isWallet } from './platform/validate';
export { createJobs } from './platform/jobs';
