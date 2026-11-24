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
export { createOutbox } from './modules/outbox/service';
export { supabaseOutbox, ethersOutboxChain } from './modules/outbox/adapters';
export { createBatchSender } from './modules/outbox/sender';
export { playCounts, ledgerCounts, mergeCounts, supabaseLedgerBoard, mergeBoards } from './modules/board/plays';
export { supabaseStreaks, subgraphSeasonPlayers } from './modules/board/adapters';
export { registerSeasonsRoutes } from './modules/seasons/routes';
export { supabaseTopActivity, supabaseSealedSeasons } from './modules/seasons/adapters';
export { catchAsync, hardenApp, installErrorHandlers, fetchWithTimeout } from './platform/http';
export { guardWalletParams, guardWalletFields, isWallet } from './platform/validate';
export { createJobs } from './platform/jobs';
export { checkEnv, describeEnv, envExample, SETTINGS } from './platform/env';
export { createProgression } from './modules/progression/service';
export { registerProgressionRoutes } from './modules/progression/routes';
export { supabaseProgression } from './modules/progression/store';
export * as progressionCatalog from './modules/progression/catalog';
export { createResultCache, eventTtl } from './platform/resultCache';
