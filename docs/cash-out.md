# Cash out: G$ to naira in a bank account

A player turns the G$ in their wallet into naira in their own Nigerian bank account, without leaving GameArena. GoodCash (pay.goodcash.xyz) does the paying. GameArena never holds the money and never moves it: the player's wallet signs one transaction, GoodCash's router swaps the G$ and pays the bank, usually within minutes.

Built 2026-11-26. **Off until a GoodCash key is set.** Nothing shows to players before then.

## What the player sees

"Cash out to bank" in the wallet sheet (tap the G$ balance). It opens a sheet with four screens, one decision each:

1. **Amount.** They type G$ and "You get ₦…" updates as they type. "See every fee" opens the full list. "Half" and "All" fill the amount from their balance.
2. **Bank.** They pick a bank (search, popular ones first) and type the 10-digit account number. The name the bank has on that account is shown before anything moves. The last account can be remembered on that phone.
3. **Check and confirm.** What they send, every fee on its own line, the rate, what they get, to whom, and when. The button says the amount: "Cash out ₦3,243".
4. **Status.** Sent, paying your bank, paid. They can close it and find it again under "Your cash outs".

When the money lands they also get a message in the bell (and a push if they allow it).

## Why it is built this way

- The amount that arrives, the rate and every fee are shown **before** the player confirms. This is what regulators ask of money transfers and what GoodCash's go-live checklist requires. Sources: [CFPB, sending money abroad](https://www.consumerfinance.gov/consumer-tools/money-transfers/send-money-abroad-with-more-confidence/), [FCA, pricing transparency good and poor practice](https://www.fca.org.uk/publications/good-and-poor-practice/consumer-duty-international-payment-pricing-transparency-good-poor-practice/printable/print), [Mastercard, moments that matter](https://developer.mastercard.com/cross-border-services/documentation/experience-design-guide/moments-that-matter/).
- The review screen and the finished screen look nothing alike. Baymard found people leave a review screen believing they are done: [review order benchmark](https://baymard.com/mcommerce-usability/benchmark/mobile-page-types/review-order).
- Amounts and account numbers open the number pad. Baymard found it cuts typing errors: [touch keyboards](https://baymard.com/blog/mobile-touch-keyboards).
- After confirming, the player is told what is happening and can find the cash out again: [how Wise builds trust](https://raw.studio/blog/how-wise-uses-3-transparency-first-ux-principles/).
- These are GameArena's own screens on GoodCash's hooks, not their ready-made widget, so the flow looks like the rest of the app.

## Safety

- **Nothing can be closed mid-payment.** While the payment is being sent the sheet ignores the backdrop, the close button and Escape.
- **"Did it go?" is never answered with "try again".** If the wallet loses its reply (`uncertain`, `pending_confirmation`) the player is told not to send again, and the cash out is kept under "Your cash outs".
- **The transaction is checked before the wallet sees it.** GoodCash's SDK refuses anything that is not exactly a cash out of the amount asked, to their router (`0x546698368a246539Df5e641EdC2b79c5782ea359`, source published on Blockscout as `GoodCashRouterV2`). It is their contract, not ours, and we have not audited it.
- **The fee shown is the fee charged.** The quote the player saw goes back with the cash out; GoodCash refuses it if the fee changed.
- **Bank details never reach GameArena's servers.** The browser sends them straight to GoodCash. The remembered account is kept on the phone only.
- **MiniPay players** pay the network fee in the stablecoin they hold, as everywhere else in the app. Other wallets need a little CELO; the player is told how much if they are short.
- **The attribution tag is not added to this one transaction.** GoodCash checks the transaction it prepared byte for byte, so nothing is appended to it.

## The fees (GoodCash's, shown to the player line by line)

| Line | Who gets it | How much |
| --- | --- | --- |
| GoodDollar contribution | GoodDollar protocol | 10% of the G$ |
| GoodCash fee | GoodCash | 1% of the payout |
| GameArena fee | GameArena | 0 to 3% of the payout, set in the agreement with GoodCash. Paid to us monthly |
| Bank payout fee | The payout partner | about $0.02 |
| Network fee | Celo | from the wallet, not the G$ |

The GameArena fee is a decision for the owner, made with GoodCash. It is a revenue line.

## Turning it on

1. **Get test keys** at https://pay.goodcash.xyz/docs/get-test-keys/ (your email, and the sites you will test from: `https://gamearenahq.xyz`, the Vercel preview address, `http://localhost:3001`).
2. **Publishable key** (`gc_pk_test_…`): set `NEXT_PUBLIC_GOODCASH_KEY` on Vercel and redeploy. "Cash out to bank" appears in the wallet. With a test key a yellow "Test mode" bar shows and no money moves.
3. **Migration:** run `games-backend/supabase-migrations/2026-11-26d_cashouts.sql` in Supabase.
4. **Webhook:** `GOODCASH_SECRET_KEY=gc_sk_test_… ./scripts/goodcash-webhook.sh`. GoodCash answers with a `whsec_…` secret once. Set it on Railway as `GOODCASH_WEBHOOK_SECRET`.
5. **Test.** Test banks are "Test Bank A" and "Test Bank B"; any 10-digit account is "TEST ACCOUNT" and is paid after about 30 seconds. `0000000001` fails, `0000000002` is sent back, `0000000003` stays processing, `0000000009` fails the name check.
6. **Go live:** finish GoodCash's checklist (https://pay.goodcash.xyz/docs/go-live/), ask for live access, then swap both keys for the `_live_` ones and run the webhook script again with the live secret key. Do one small real cash out before telling players.

The secret key (`gc_sk_…`) and the webhook secret go in environment variables only. Never in a chat, the repo or the browser.

## Where the code is

- `frontend/lib/cashout.ts` · the switch, the open event, the remembered account and the list of cash outs on the phone
- `frontend/components/CashOutSheet.tsx` · the sheet, mounted once in `app/layout.tsx`; loads the screens only when first opened
- `frontend/components/cashout/Flow.tsx` · the four screens
- `frontend/components/WalletSheet.tsx` · the "Cash out to bank" button
- `frontend/lib/cashoutFake.ts` · a stand-in for GoodCash on a developer's machine (`window.__cashoutFake = true`); never in the real build
- `games-backend/src/modules/cashout/` · the webhook: checks GoodCash's signature on the exact bytes, keeps one row per cash out, tells the player once
- `games-backend/supabase-migrations/2026-11-26d_cashouts.sql` · `cashouts`, `cashout_events`, `cashout_save` (a finished cash out is never moved back), `admin_cashouts`
- Admin, Money · "Cash outs to a bank": naira paid, G$ cashed out, players, on their way, not paid, and the latest ones

Counted in `site_events`: `cashout_open`, `cashout_step`, `cashout_started`, `cashout_sent`, `cashout_paid`, `cashout_ended`, `cashout_error`.

## Checked, and not yet

Checked: the whole flow in a real browser at 390 and 1440 wide against a stand-in that behaves like GoodCash's test mode (amount too small, a wrong account, a paid cash out, the list afterwards, the sheet refusing to close while sending). Server: forged, altered, stale and repeated webhook calls; the database refusing a bad wallet or status and never moving a paid cash out back.

Not yet: anything against GoodCash itself. That needs the test key. A real cash out needs the live key.

## Not built

- Adding G$ with naira (GoodCash's top-ups). The same partner supports it.
- A link that opens the cash-out sheet from a notification.
