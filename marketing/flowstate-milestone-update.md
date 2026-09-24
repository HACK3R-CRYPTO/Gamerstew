# Flow State milestone update

Status checked against the repo, not against the deck. Rael scores percentage
against the milestones we set ourselves, so an honest number beats a flattering
one: he can read the code.

The four we declared as "next" on Demo Day 5:

| Milestone | Real status | Suggested % |
|---|---|---|
| BlockSlide live as a 2nd on-chain game | Partner Game SDK built, documented at `/sdk`, `lib/partner.js` shipped. Inert until `PARTNER_GAMES` + `PARTNER_KEY_*` are set. The rail is done, the partner is not live. | 60% |
| Engagement rewards (GoodDollar) integrated | Not built. Applied and designed only. Nothing in the codebase. | 10% |
| Verification drive after the flow fix | Running now. Verification context rewritten this week, Tug of War live for 7 days with verification as the entry condition. | 70% |
| Dune analytics for GoodDollar: claims, invites, retention, spend | Not built. The existing dashboard covers players, games, segments, habitats and UBI. No GoodDollar claims/invites/retention/spend panel. | 0% |

## Not on the list, worth reporting

The verification work this week produced a finding that affects GoodDollar's
own reporting, not just ours.

`IdentityV4` on Celo, read on-chain:

    reverifyDaysOptions[0] = 3 days      first-time verifiers
    reverifyDaysOptions[1] = 180 days    after re-verifying
    authenticationPeriod() = 180         deprecated, but the obvious field to read

A first-time verifier lapses after 3 days, not 180. Anything reading
`authenticationPeriod()` will overcount verified users badly. We had 313 players
silently drop out of verified status before we traced it.

Our verification flow was also rebuilt: it treated an unreadable RPC as "not
verified", so players flickered in and out of verified state.

## Current numbers, live from chain

    788    players (GamePass holders, Celo)
    127    verified right now (16%), live isWhitelisted check
    59,360 games, each an on-chain tx
    21,385 G$ routed to the UBI pool
    87,976 G$ player spend through perks

## The Dune gap

The GoodDollar-specific dashboard is a milestone we set and have not delivered.
It is very likely why Rael is asking. Say so plainly rather than pointing at the
general dashboard, which does not answer his question.
