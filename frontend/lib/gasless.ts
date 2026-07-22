// Whether skill-game scoring is gasless (backend submits recordScore and pays
// the gas). Mirrors the backend's GASLESS_SKILL_GAMES flag. When on (the
// default), the player needs NO CELO to play or save a score, so every gas
// gate/banner in the game lobbies must stand down — a low-CELO player can still
// play and their score still saves.
//
// Keep this in sync with the backend flag: if you ever set the backend
// GASLESS_SKILL_GAMES=false (revert to player-pays), also set
// NEXT_PUBLIC_GASLESS_SKILL_GAMES=false so the gas gate returns.
export const GASLESS_SKILL_GAMES =
  String(process.env.NEXT_PUBLIC_GASLESS_SKILL_GAMES ?? "true").toLowerCase() !== "false";
