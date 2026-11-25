# Sign-in costs: moving new players off Privy

> Status: PLAN, written 2026-11-26. Nothing is changed yet. It needs a Magic account and its keys from the owner, and it must be tested with real accounts before it goes live.

## Why

Privy bills by monthly active users: every person who signs in through it at least once in a month. Third-party price lists (checked November 2026, not confirmed on Privy's own page) put the free tier at 499 users, then $299 a month up to 2,499, then $499 up to 9,999. GameArena has about 970 players, so a good month crosses the free line.

Magic, the kit GoodDrops uses (`magic-sdk` with its wagmi connector, in `dapp/src/lib/`), is listed as free to 1,000 active wallets a month, then about $0.045 each, or $99 a month for 2,500. Twice the free room and about a third of the price. GoodDrops also ships a one-time `migrate` app that links a wallet from Privy or Web3Auth to the new one, which shows they made this same move.

Both sets of prices come from third-party pages. Confirm on privy.io/pricing and magic.link/pricing before budgeting.

## What the code does today

- `components/providers.tsx`: Privy with `loginMethods: ['google', 'email', 'wallet']` and `embeddedWallets.createOnLogin: 'all-users'`.
- 30 files import Privy; `usePrivy` is called 47 times.
- **MiniPay players never touch Privy.** They are signed in by their MiniPay address (`useAuthStatus`). They cost nothing.
- **Players with their own wallet (MetaMask, Rabby) do sign in through Privy**, are billed as active users, and are given an embedded wallet they do not need.
- The server proves who a player is with a Privy token (`lib/server/roomWallet.ts`, `app/actions/*`).

## The one thing that cannot be moved

A player who signed up by email or Google has a wallet that Privy holds the key to. Their GamePass, their G$, their scores and their GoodDollar verification all belong to that wallet's address. Another provider cannot open it. So those players stay on Privy for as long as they play. Only new sign-ups can start somewhere else.

## The plan

| Who | Signs in with | Cost |
|---|---|---|
| MiniPay | MiniPay, as now | nothing |
| Own wallet (MetaMask, Rabby, WalletConnect) | The wallet directly, proved by a signed message. No provider in between | nothing |
| Email or Google, already a GameArena player | Privy, as now | counts on Privy only in months they play |
| Email or Google, new | Magic | counts on Magic |

**How the app knows which is which.** The sign-in sheet asks for the email first. The server asks Privy whether that email already has an account (a lookup, not a sign-in, so it is not billed). Yes: the Privy sign-in opens. No: the Magic sign-in opens. A device that has signed in before remembers which, so a returning player is not asked.

For "Continue with Google" the email is not known in advance. A device that has used Privy before goes to Privy. A new device is asked for the email first, then offered Google on the right provider.

## Steps

1. **One sign-in layer.** Every page asks one hook (`useAuth`) for "who is this, and sign this message", instead of calling Privy. No behaviour changes. This is the large, careful step: 30 files.
2. **Own wallets leave Privy.** Connect straight through wagmi, with a signed message as the proof the server checks. Saves money on its own, with no new provider.
3. **Server accepts three proofs:** a Privy token, a Magic token, or a wallet signature.
4. **Magic for new email and Google sign-ups,** with the email-first check.
5. **Turn off `createOnLogin: 'all-users'`** once own-wallet players no longer pass through Privy.

Each step ships separately and can be rolled back.

## Risks

- **Sign-in is the front door.** A mistake locks players out. Each step needs a real test with a real email account, a real own-wallet account and MiniPay. This cannot be tested from a script.
- **Signing.** Room entries use a signed permit, and ranked runs use signed messages. Both must work on Magic wallets exactly as on Privy's.
- **Two providers at once** is more to maintain until old Privy players fade. It never reaches zero: an old player can return any month.
- **Magic holds new players' keys** the way Privy holds old ones. Moving later has the same limit.

## What is needed from the owner

1. A Magic account, and its publishable key and secret key (as environment variables, never pasted in chat).
2. The current Privy active-user count from the Privy dashboard, to know how urgent this is.
3. A yes to step 2 first, since it saves money by itself.
