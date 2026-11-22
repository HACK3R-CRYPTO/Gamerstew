# Restore the Light: design research and decisions

Researched 2026-11-22. Numbers marked [S] are stated in the source, [I] are inference.

## What the code was doing
- About twelve systems in a 45 to 90 second run: timing tap, traffic, lives, dodge streak, flip chain, breaker decay, hospital breaker, raids, brownout meter, pickups, time-pressure ramp, mega-surge finale.
- Tap window shrank from 372 ms at the start to 115 ms at 90% lit. A far miss cost a life.
- A car hit stuns for 2.38 s with 3 s of invulnerability.

## Findings
1. **Timing meters.** Reward a perfect, forgive a miss. Dead by Daylight (PC) uses a 13% good zone on a 1.1 s check [S], roughly 143 ms [I], and that is tuned for a mouse. Android touch latency is 10 to 35 ms [S] and audio output about 39 ms [S]. Suggested for touch: about 300 ms at the start, floor near 160 ms, a perfect zone of 70 to 90 ms, 1 to 2 frames of late forgiveness, a miss costing about 0.5 s [I].
   Sources: deadbydaylight.wiki.gg/wiki/Skill_Checks · android-developers.googleblog.com/2021/03/an-update-on-androids-audio-latency.html · destructoid.com (Bleszinski on active reload)
2. **Near misses** motivate only when skill-based. Hitboxes 10 to 15% smaller than visuals, telegraph erratic moves at least 0.5 s ahead [I].
   Sources: gamedeveloper.com (near-miss) · maddymakesgames.com/articles/celeste_and_forgiveness
3. **One more run.** Restart time is the real death penalty (Super Meat Boy). Crossy Road restarts in 0.5 to 1 s with at most two taps [S]. Show the gap to the next grade and to personal best.
   Sources: gamedeveloper.com (McMillen; Crossy Road lessons)
4. **Juice.** Hit-stop 2 to 4 frames light, 5 to 8 medium [S, low authority]; pitch up per chain link; keep hit-stop off the meter clock.
   Sources: gdcvault.com/play/1016487/Juice-It-or-Lose
5. **Onboarding.** Understood in under 10 seconds; first step hard to fail; no separate tutorial.
   Sources: gameanalytics.com (hyper-casual mistakes; Voodoo guide)
6. **Pacing.** Build up, peak, relax instead of constant pressure (Left 4 Dead Director).
7. **Pitfalls.** Unavoidable stuns raise frustration (QUT study, secondary summary). Extra features over the core mechanic cause drop-off. Touch targets at least 48dp [S].

## Applied (this commit)
- Tap tuned in milliseconds: 360 ms at 0% lit down to a 170 ms floor, plus 50 ms late-tap forgiveness.
- Perfect zone never narrower than about 80 ms.
- A miss costs time (lockout) and the perfect streak, never a life.
- Result screen shows the gap to the next grade.

## Proposed, awaiting a decision
- Shorten the 2.38 s stun (research suggests under about 0.8 s); needs a check against the knock-down animation.
- Three-act pacing: light it, hold it, surge. One threat introduced at a time.
- Remove or gate the brownout meter, raids and the standing-in-road life penalty.
- First breaker on the spawn kerb with no traffic for 5 seconds.
- Hospital breaker as a bonus to protect, not an instant life loss.
- Ghost of best run, WhatsApp challenge link carrying the sharer's time.

## Not verified
No play-test yet. Tuning is from the code and the sources above, not from feel.

## Round 2: what makes it feel good (motivation and reward research)

| Finding | Source | What we built |
|---|---|---|
| Dopamine neurons respond to reward that is BETTER THAN PREDICTED; a fully predicted reward produces no response and no learning | Schultz, "Dopamine reward prediction error coding" (pmc.ncbi.nlm.nih.gov/articles/PMC4826767) | NEPA blessing: a flip sometimes carries down the line and lights the next breaker by itself. 10% on a normal flip, 30% on a PERFECT, never on the last breaker |
| Anticipation and the peak recruit different reward circuits; the build-up is part of the pleasure | Salimpoor et al. 2011, Nature Neuroscience (doi.org/10.1038/NN.2726) | Each breaker plays the next note up a pentatonic ladder, so a run is a rising tune that resolves only on the last one. The blessing lands half a second after the flip that earned it |
| Competence, autonomy and relatedness each independently predict enjoyment and future play | Ryan, Rigby and Przybylski 2006 (doi.org/10.1007/S11031-006-9051-8) | Fair tap window (round 1); the street cheers every breaker, louder as more is lit; route choice left free |
| Effort accelerates near a visible goal; visible partial progress raises completion | Kivetz, Urminsky and Zheng 2006; Nunes and Dreze 2006 | Lit count shown as a row of ten bulbs; the last three pulse |
| Experiences are remembered by their peak and their ending | Fredrickson and Kahneman; Gutwin et al. CHI 2016 (dx.doi.org/10.1145/2858036.2858419) | A loss now ends on what you achieved or how close you were, not on "NEPA cut the light again" |
| Juicy feedback works through legible action-outcome links and graded success | Kao et al. CHI 2024 | PERFECT / good grading kept; reward appears at the breaker you touched |
| Video-game play releases striatal dopamine, more with better performance | Koepp et al. 1998, Nature (pubmed.ncbi.nlm.nih.gov/9607763); later critiqued for confounds | Supports rewarding skill, not time spent |

Limits to state plainly: most reward-prediction evidence is from animals; the 1998 imaging study has known confounds; peak-end evidence in games is mixed for "want to replay". None of this replaces a play-test.

Ethical line kept: the surprise reward is tied to skill and costs nothing. Random paid rewards (loot boxes) are the pattern regulators treat as gambling-like, and we use none.

Verified by stepping a full run frame by frame: all ten breakers lit, blessings fired, tightest live tap window 189 ms, no errors.
