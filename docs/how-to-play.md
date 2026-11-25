# How to play

Players said they opened a game and did not know what to do. Word Ladder was the one named most. Added 2026-11-27.

## What the research says

- People skip tutorials they have to read, and those who read them do no better than those who skip. The better investment is a clearer screen. ([NN/g: mobile tutorials](https://www.nngroup.com/articles/mobile-tutorials/), [NN/g: mobile app onboarding](https://www.nngroup.com/articles/mobile-app-onboarding/))
- Tours, dialogs and videos shown before use are ignored. What works is doing the action yourself, with less text and nothing loaded up front. ([Smashing Magazine: rethinking mobile tutorials](https://www.smashingmagazine.com/2014/04/rethinking-mobile-tutorials-which-patterns-really-work/))
- Games should teach through play, and keep a "How to play" button so a player can come back to it. ([Apple: onboarding for games](https://developer.apple.com/app-store/onboarding-for-games/))
- Count each step of a tutorial to see where players drop out. ([GameAnalytics](https://gameanalytics.com/?p=4403))

## What was built

**1. A practice ladder in Word Ladder.** The first time a player presses Play they get one easy ladder, COLD to WORD, on the real board. A coach points at what to do next: the letter to tap turns yellow and the line says "Tap the letter L", then the key turns yellow and the line says "Now tap R on the keyboard". Nothing is scored, timed or ranked, it does not use a guest's free plays, and "Skip the practice" is always there. When it ends the player is back on the start screen with "You have got it" and presses Play themselves: no round starts on its own.

A player who has a score on the device, or has done or skipped the practice, never sees it again unless they ask for it from the sheet.

**2. A "How to play" sheet on every game.** One button on each start screen opens three steps, each with a small moving picture of the action and one line of text. It is never shown unasked.

| Game | The three steps |
|---|---|
| Word Ladder | Tap a letter · Tap its new letter (a real word) · Reach the target in 3 minutes |
| Stack Tower | Tap to drop · Overhang is sliced · A perfect drop keeps the width |
| Rhythm Rush | Tap on the line · Chain a combo · Hold the long notes |
| Simon Memory | Watch · Tap it back · One more each round, one mistake ends it |
| Street Strike | Swipe up to roll · Curve to hook · Five frames, pick your tyre |
| UP NEPA 3D | Two thumbs · Flip the breaker in the green · Light the street, stay off the road |

Every line is the game's real rule, taken from the game's own start screen or code. Do not add a step for something a game does not do.

## For a new game

Add an entry to `STEPS` and `ART` in `frontend/components/HowToPlay.tsx` and put `<HowToButton game="…" />` on the start screen (`howTo="…"` on `GameLobby`). A picture is laid out once on a stage 120px square and scaled to fit, so it looks the same on a phone and a desktop.

## Where to see if it works

Admin, Visits, Events: `howto_open` (with the game), `howto_practice`, `tutorial_start`, `tutorial_done`, `tutorial_skipped`. If many start the practice and few finish, the practice is the problem.

## Code

| | |
|---|---|
| The sheet, the steps, the pictures, the button | `frontend/components/HowToPlay.tsx` |
| The practice ladder and its coach | `frontend/app/games/ladder/page.tsx` (`startPractice`, `coachWord`) |
| The button in the shared lobby | `frontend/components/GameLobby.tsx` (`howTo`) |
