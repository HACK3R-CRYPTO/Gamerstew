// ─── progression ───────────────────────────────────────────────────────────────
// XP, daily missions, achievements, streaks and saved scores now live in
// src/modules/progression (TypeScript, tested). This file only builds that
// module with the live database and chain, registers its routes, and publishes
// the names the remaining legacy files still read from `core`.

module.exports = [
// ── build the module and publish its names ──
function* (core) {
  let progression;
  const cat = () => core.platform.progressionCatalog;
  Object.defineProperties(core, {
    progression: { get: () => progression, enumerable: true, configurable: true },
    VALID_GAMES: { get: () => cat().VALID_GAMES, enumerable: true, configurable: true },
    GAME_TYPE: { get: () => cat().GAME_TYPE, enumerable: true, configurable: true },
    GAME_LABEL: { get: () => cat().GAME_LABEL, enumerable: true, configurable: true },
    WIN_THRESHOLD: { get: () => cat().WIN_THRESHOLD, enumerable: true, configurable: true },
    XP_PLAYED: { get: () => cat().XP_PLAYED, enumerable: true, configurable: true },
    XP_WIN: { get: () => cat().XP_WIN, enumerable: true, configurable: true },
    XP_NEW_PB: { get: () => cat().XP_NEW_PB, enumerable: true, configurable: true },
    ACHIEVEMENT_CATALOG: { get: () => cat().ACHIEVEMENT_CATALOG, enumerable: true, configurable: true },
    MISSION_TEMPLATES: { get: () => cat().MISSION_TEMPLATES, enumerable: true, configurable: true },
    CHALLENGE_AI_GAME_TYPE: { get: () => cat().CHALLENGE_AI_GAME_TYPE, enumerable: true, configurable: true },
    xpProgress: { get: () => cat().xpProgress, enumerable: true, configurable: true },
    levelFromXp: { get: () => cat().levelFromXp, enumerable: true, configurable: true },
    saveScore: { get: () => progression.saveScore, enumerable: true, configurable: true },
    awardXp: { get: () => progression.awardXp, enumerable: true, configurable: true },
    updateMissionProgress: { get: () => progression.updateMissionProgress, enumerable: true, configurable: true },
    checkAndUnlockAchievements: { get: () => progression.checkAndUnlockAchievements, enumerable: true, configurable: true },
    ensureTodayMissions: { get: () => progression.ensureTodayMissions, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

  progression = core.platform.createProgression({
    store: core.platform.supabaseProgression(core.supabase),
    badges: (wallet) => core.getBadges(wallet),
    // total games on-chain; null when the contract is not loaded or the call fails
    gamesPlayed: async (wallet) => (core.passContract ? Number(await core.passContract.gamesPlayed(wallet)) : null),
  });
},

// ── routes ──
function* (core) {
  yield;
  core.platform.registerProgressionRoutes(core.app, core.progression, { requireSecret: core.requireSecret, limiter: core.gameSubmitLimiter });
},

// ── (the streak route is registered with the others above) ──
function* () {
  yield;
},
];
