"use client";

// ─── Cash out, screen by screen ──────────────────────────────────────────────
// G$ in the player's wallet becomes naira in their own bank account. GoodCash
// does the paying; these are GameArena's own screens on top of its SDK, so the
// flow looks and reads like the rest of the app.
//
// Four screens, one decision each:
//   amount   how much, with "you get ₦…" updating as they type
//   bank     which account, and the name the bank has on it, before any money moves
//   review   every fee on its own line and one button that says the amount
//   status   sent → paying your bank → paid, which they may close and come back to
//
// What shaped it (docs/cash-out.md has the sources):
//   - the amount that arrives, the rate and every fee are shown BEFORE the
//     player confirms, never after;
//   - the review screen and the finished screen look nothing alike, because
//     people leave a review screen believing they are done;
//   - number pads for amounts and account numbers;
//   - after confirming, the player is told what is happening and can find the
//     cash out again. "Did it go?" is never answered with "try again".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useChainId, useReadContract, useSendTransaction, useSwitchChain } from "wagmi";
import { formatUnits } from "viem";
import { GoodCashProvider, useBanks, useCashOut, useCashOutStatus, useQuote, useVerifyAccount } from "@goodcash/react";
import type { FeeLine, GoodCash, GoodCashError, SendFunction } from "@goodcash/sdk";
import { CONTRACT_ADDRESSES, ERC20_ABI, detectFeeSpread } from "@/lib/contracts";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { track } from "@/lib/track";
import { CASHOUT_KEY, STATUS_WORDS, cashOutIsTest, gAmount, isOver, naira, recentCashOuts, rememberCashOut, saveBank, savedBank, updateCashOut, type Recent, type SavedBank } from "@/lib/cashout";

const DISPLAY = '"Melon Pop", "Fredoka", system-ui, sans-serif';
const CELO = 42220;
type Step = "amount" | "bank" | "review" | "sending" | "status";

export default function Flow({ client, onClose, onBusy }: { client?: GoodCash; onClose: () => void; /** true while money is moving: the sheet must not be closed */ onBusy: (busy: boolean) => void }) {
  return (
    <GoodCashProvider publishableKey={CASHOUT_KEY || "gc_pk_test_local"} client={client}>
      <Screens onClose={onClose} onBusy={onBusy} />
    </GoodCashProvider>
  );
}

function feeValue(f: FeeLine): string {
  if (f.amountG) return `${gAmount(Number(f.amountG))} G$`;
  if (typeof f.naira === "number") return naira(f.naira);
  return typeof f.percent === "number" ? `${f.percent}%` : "";
}

function Screens({ onClose, onBusy }: { onClose: () => void; onBusy: (busy: boolean) => void }) {
  const { address } = useAccount(); const isMiniPay = useIsMiniPay(); const chainId = useChainId();
  const { sendTransactionAsync } = useSendTransaction(); const { switchChainAsync } = useSwitchChain();
  const { data: raw } = useReadContract({ address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`, abi: ERC20_ABI, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!address } });
  const test = cashOutIsTest();
  // with a test key nothing real moves, so the amount is not held to the wallet's balance
  const balance = raw === undefined ? null : Number(formatUnits(raw as bigint, 18));
  // whose list of cash outs this is; a test with no wallet keeps a list of its own
  const owner = address ?? (test ? "test" : undefined);

  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState("");
  const [fees, setFees] = useState(false);
  const [bank, setBank] = useState<{ code: string; name: string } | null>(null);
  const [account, setAccount] = useState("");
  const [find, setFind] = useState("");
  const [picking, setPicking] = useState(false);
  const [keep, setKeep] = useState(true);
  const [saved, setSaved] = useState<SavedBank | null>(null);
  const [useSaved, setUseSaved] = useState(false);
  const [watch, setWatch] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const attempt = useRef<string | null>(null);
  const top = useRef<HTMLHeadingElement>(null);

  useEffect(() => { const s = savedBank(); setSaved(s); setUseSaved(!!s); setRecent(recentCashOuts(owner)); }, [owner]);
  useEffect(() => { top.current?.focus(); }, [step]);

  const valid = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;
  const { quote, loading: quoting, error: quoteError } = useQuote(valid ? amount : null);
  const { banks, loading: banksLoading, error: banksError } = useBanks();
  const typed = useVerifyAccount(useSaved ? "" : bank?.code ?? "", useSaved ? "" : account);
  const { start, step: doing, error, reset } = useCashOut();

  const fresh = quote && quote.amountG === amount ? quote : null;
  const over = !test && balance !== null && valid && Number(amount) > balance;
  const tooSmall = !!fresh && !fresh.enough;
  const amountOk = valid && !!fresh && fresh.enough && !over;
  const recipient = useSaved && saved ? saved : bank && typed.accountName ? { bankCode: bank.code, bankName: bank.name, accountNumber: account, accountName: typed.accountName } : null;

  const setPart = (part: number) => { if (balance === null) return; const v = Math.floor(balance * part * 100) / 100; setAmount(v > 0 ? String(v) : ""); };
  const typeAmount = (v: string) => { const clean = v.replace(/[^\d.]/g, "").replace(/^0+(?=\d)/, "").replace(/(\..*)\./g, "$1").replace(/^(\d*\.\d{0,2}).*$/, "$1"); setAmount(clean.slice(0, 12)); attempt.current = null; };

  // The app sends every transaction the same way (wagmi), so MiniPay players pay
  // the network fee in the stablecoin they hold, as they do everywhere else here.
  const signer: SendFunction = useCallback(async (tx) => {
    if (chainId !== CELO) await switchChainAsync({ chainId: CELO });
    const fee = await detectFeeSpread(isMiniPay, address);
    return sendTransactionAsync({ to: tx.to, data: tx.data, value: 0n, chainId: CELO, ...fee } as Parameters<typeof sendTransactionAsync>[0]);
  }, [address, chainId, isMiniPay, sendTransactionAsync, switchChainAsync]);

  const go = async () => {
    if (!recipient || !fresh || !address && !test) return;
    attempt.current ??= `ga-${(address ?? "test").slice(2, 10)}-${Date.now()}`;
    setStep("sending"); onBusy(true);
    track("cashout_started", { amount_g: Number(amount), naira: fresh.receive.naira, test });
    const out = await start({
      signer: test ? undefined : signer, wallet: address, amountG: amount,
      recipient: { bankCode: recipient.bankCode, accountNumber: recipient.accountNumber, accountName: recipient.accountName },
      quote: fresh, partnerRef: address?.toLowerCase(), idempotencyKey: attempt.current,
      skipNetworkFeeCheck: isMiniPay,
    });
    onBusy(false);
    if (!out) return; // `error` is set; the sending screen shows it
    if (keep || useSaved) saveBank(recipient); else saveBank(null);
    rememberCashOut(owner, { id: out.cashOut.id, amountG: amount, naira: out.cashOut.receive.naira, at: Date.now(), bankName: recipient.bankName, last4: recipient.accountNumber.slice(-4), status: out.cashOut.status });
    setRecent(recentCashOuts(owner)); attempt.current = null;
    track("cashout_sent", { amount_g: Number(amount), naira: out.cashOut.receive.naira, test });
    setWatch(out.cashOut.id); setStep("status");
  };

  // an error that leaves room for doubt is never offered a second try
  const unsure = error?.code === "uncertain" || error?.code === "pending_confirmation";
  useEffect(() => {
    if (!error) return;
    track("cashout_error", { code: error.code });
    if (["order_expired", "fee_mismatch", "price_moved"].includes(error.code)) attempt.current = null;
    const id = (error.data as { cashOutId?: string } | undefined)?.cashOutId;
    if (unsure && id) { rememberCashOut(owner, { id, amountG: amount, naira: fresh?.receive.naira ?? 0, at: Date.now(), bankName: recipient?.bankName ?? "", last4: recipient?.accountNumber.slice(-4) ?? "", status: "sent" }); setRecent(recentCashOuts(owner)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const shown = useMemo(() => { const q = find.trim().toLowerCase(); const list = q ? banks.filter((b) => b.name.toLowerCase().includes(q)) : banks.filter((b) => b.popular); return (list.length ? list : banks).slice(0, q ? 30 : 8); }, [banks, find]);
  const back = (to: Step) => { reset(); setStep(to); };

  return (
    <div className="co">
      <header>
        {step === "bank" || step === "review" ? <button className="co-back" onClick={() => back(step === "bank" ? "amount" : "bank")} aria-label="Back">←</button> : <span className="co-back" aria-hidden />}
        <div className="co-dots" aria-hidden>{(["amount", "bank", "review"] as Step[]).map((s, i) => <i key={s} className={step === s ? "on" : ["amount", "bank", "review", "sending", "status"].indexOf(step) > i ? "past" : ""} />)}</div>
        <button className="co-x" onClick={onClose} disabled={step === "sending" && !error} aria-label="Close">✕</button>
      </header>
      {test && <div className="co-test">Test mode. No real money moves.</div>}

      {/* a cash out is signed by the player's own wallet, so there has to be one */}
      {!address && !test && (
        <>
          <h2 ref={top} tabIndex={-1} style={{ fontFamily: DISPLAY }}>Sign in to cash out</h2>
          <p className="co-sub">Cash out sends G$ from your own wallet to your own bank account, so you need to be signed in.</p>
          <a className="co-main" href="/home?signin=1" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>Sign in</a>
        </>
      )}

      {/* ───── how much ───── */}
      {step === "amount" && (address || test) && (
        <>
          <h2 ref={top} tabIndex={-1} style={{ fontFamily: DISPLAY }}>Cash out</h2>
          <p className="co-sub">Turn your G$ into naira in your own bank account.</p>
          <label className="co-amount">
            <span>You send</span>
            <div><input inputMode="decimal" autoComplete="off" placeholder="0" value={amount} onChange={(e) => typeAmount(e.target.value)} aria-label="Amount in G$" style={{ fontFamily: DISPLAY }} /><b>G$</b></div>
          </label>
          <div className="co-have">
            <span>{!address ? (test ? "No wallet needed for a test" : "") : balance === null ? "Reading your balance…" : <>You have <b>{gAmount(balance)} G$</b></>}</span>
            {balance !== null && balance > 0 && <span className="co-chips"><button onClick={() => setPart(0.5)}>Half</button><button onClick={() => setPart(1)}>All</button></span>}
          </div>

          <div className={`co-get${amountOk ? " ok" : ""}`} aria-live="polite">
            <span>You get</span>
            <strong style={{ fontFamily: DISPLAY }}>{fresh ? naira(fresh.receive.naira) : valid && quoting ? "…" : "₦0"}</strong>
            {fresh && fresh.receive.minimumNaira < fresh.receive.naira && <em>At least {naira(fresh.receive.minimumNaira)}, whatever the rate does</em>}
            {fresh && (
              <>
                <button className="co-link" onClick={() => setFees((v) => !v)} aria-expanded={fees}>{fees ? "Hide the fees" : "See every fee"}</button>
                {fees && <Fees amount={amount} lines={fresh.fees} rate={fresh.nairaPerDollar} get={fresh.receive.naira} />}
              </>
            )}
          </div>

          {over && <div className="co-err" role="alert">You only have {gAmount(balance ?? 0)} G$.</div>}
          {!over && tooSmall && fresh && <div className="co-err" role="alert">The least you can cash out is {gAmount(fresh.minimumG)} G$.</div>}
          {quoteError && valid && <div className="co-err" role="alert">{quoteError.message}</div>}

          <button className="co-main" disabled={!amountOk} onClick={() => { track("cashout_step", { step: "bank" }); setStep("bank"); }}>Continue</button>
          <p className="co-note">Paid to Nigerian bank accounts, usually within minutes.</p>

          {recent.length > 0 && (
            <div className="co-recent">
              <h3>Your cash outs</h3>
              {recent.slice(0, 4).map((r) => (
                <button key={r.id} onClick={() => { setWatch(r.id); setStep("status"); }}>
                  <span><b>{naira(r.naira)}</b>{r.bankName ? ` to ${r.bankName} ••${r.last4}` : ""}</span>
                  <i className={`s-${r.status}`}>{STATUS_WORDS[r.status] ?? r.status}</i>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ───── to which account ───── */}
      {step === "bank" && (
        <>
          <h2 ref={top} tabIndex={-1} style={{ fontFamily: DISPLAY }}>Where to?</h2>
          <p className="co-sub">Your own Nigerian bank account. We show you the name on it first.</p>

          {saved && useSaved ? (
            <>
              <div className="co-name ok"><span>Send to</span><b>{saved.accountName}</b><em>{saved.bankName} · ••••••{saved.accountNumber.slice(-4)}</em></div>
              <button className="co-link" onClick={() => setUseSaved(false)}>Use a different account</button>
            </>
          ) : (
            <>
              <span className="co-label">Bank</span>
              {bank && !picking ? (
                <button className="co-pick" onClick={() => { setPicking(true); setFind(""); }}><b>{bank.name}</b><span>Change</span></button>
              ) : (
                <div className="co-banks">
                  <input placeholder="Search your bank" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Search your bank" autoComplete="off" />
                  <div role="listbox" aria-label="Banks">
                    {banksLoading && <p>Loading banks…</p>}
                    {banksError && <p role="alert">{banksError.message}</p>}
                    {shown.map((b) => <button key={b.code} role="option" aria-selected={bank?.code === b.code} onClick={() => { setBank({ code: b.code, name: b.name }); setPicking(false); }}>{b.name}</button>)}
                    {!banksLoading && !find && banks.length > shown.length && <p>Type to search all {banks.length} banks.</p>}
                  </div>
                </div>
              )}

              <label className="co-field">
                <span className="co-label">Account number</span>
                <input inputMode="numeric" autoComplete="off" maxLength={10} placeholder="10 digits" value={account} onChange={(e) => { setAccount(e.target.value.replace(/\D/g, "").slice(0, 10)); attempt.current = null; }} />
              </label>

              {typed.loading && <div className="co-name"><span>Checking the name on this account…</span></div>}
              {typed.accountName && bank && <div className="co-name ok"><span>The bank says this account belongs to</span><b>{typed.accountName}</b><em>{bank.name} · ••••••{account.slice(-4)}</em></div>}
              {typed.error && <div className="co-err" role="alert">{typed.error.code === "bank_account_not_found" ? "We could not find that account. Check the bank and the number." : typed.error.message}</div>}

              <label className="co-keep"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /><span>Remember this account on this phone</span></label>
              {saved && <button className="co-link" onClick={() => setUseSaved(true)}>Use {saved.bankName} ••{saved.accountNumber.slice(-4)} again</button>}
            </>
          )}

          <button className="co-main" disabled={!recipient} onClick={() => { track("cashout_step", { step: "review" }); setStep("review"); }}>Continue</button>
        </>
      )}

      {/* ───── check everything ───── */}
      {step === "review" && recipient && (
        <>
          <h2 ref={top} tabIndex={-1} style={{ fontFamily: DISPLAY }}>Check and confirm</h2>
          <p className="co-sub">Nothing has been sent yet.</p>
          <div className="co-bill">
            <div className="co-row"><span>You send</span><b>{gAmount(Number(amount))} G$</b></div>
            {fresh ? <Fees amount={amount} lines={fresh.fees} rate={fresh.nairaPerDollar} get={fresh.receive.naira} bare /> : <div className="co-row"><span>Getting the latest price…</span></div>}
            <div className="co-row total"><span>You get</span><b style={{ fontFamily: DISPLAY }}>{fresh ? naira(fresh.receive.naira) : "…"}</b></div>
          </div>
          <div className="co-bill">
            <div className="co-row"><span>To</span><b>{recipient.accountName}</b></div>
            <div className="co-row"><span>Account</span><b>{recipient.bankName} · ••••••{recipient.accountNumber.slice(-4)}</b></div>
            <div className="co-row"><span>Arrives</span><b>Usually within minutes</b></div>
          </div>
          <p className="co-note left">{test ? "This is a test: your wallet is not asked for anything." : isMiniPay ? "Your wallet asks you to confirm once. The network fee is paid from your wallet, as with everything else in MiniPay." : "Your wallet asks you to confirm once. The network fee is a tiny amount of CELO from your wallet, not G$."}</p>
          <button className="co-main" disabled={!fresh || !fresh.enough} onClick={go}>Cash out {fresh ? naira(fresh.receive.naira) : ""}</button>
        </>
      )}

      {/* ───── sending ───── */}
      {step === "sending" && (
        <>
          {!error ? (
            <>
              <h2 ref={top} tabIndex={-1} style={{ fontFamily: DISPLAY }}>{doing === "confirm_in_wallet" && !test ? "Confirm in your wallet" : "Sending…"}</h2>
              <p className="co-sub">{doing === "confirm_in_wallet" && !test ? "Your wallet is asking you to confirm. Keep this open." : "Keep this open. It takes a few seconds."}</p>
              <ol className="co-steps">
                {([["checking", "Checking your wallet"], ["creating", "Preparing the payment"], ["confirm_in_wallet", test ? "Sending (test)" : "Waiting for you to confirm"], ["confirming", "Waiting for the network"]] as const).map(([k, label]) => {
                  const order = ["checking", "creating", "confirm_in_wallet", "confirming", "reporting", "done"]; const at = order.indexOf(doing ?? "checking"); const mine = order.indexOf(k);
                  return <li key={k} className={at > mine ? "done" : at === mine ? "now" : ""}><i aria-hidden>{at > mine ? "✓" : ""}</i>{label}</li>;
                })}
              </ol>
            </>
          ) : unsure ? (
            <>
              <h2 ref={top} tabIndex={-1} style={{ fontFamily: DISPLAY }}>We are still checking</h2>
              <p className="co-sub">Your wallet did not tell us if this went through. <b>Do not send it again.</b> If it went, you will see it under &quot;Your cash outs&quot; and the money arrives as normal. If it did not, your G$ is still in your wallet.</p>
              <button className="co-main" onClick={() => back("amount")}>See my cash outs</button>
            </>
          ) : (
            <>
              <h2 ref={top} tabIndex={-1} style={{ fontFamily: DISPLAY }}>{error.code === "wallet_rejected" ? "Cancelled" : "That did not go through"}</h2>
              <p className="co-sub">{problem(error)} <b>Nothing was sent.</b> Your G$ is still in your wallet.</p>
              <button className="co-main" onClick={() => back("review")}>{error.code === "needs_network_fee" ? "Back" : "Try again"}</button>
              <button className="co-ghost" onClick={onClose}>Close</button>
            </>
          )}
        </>
      )}

      {/* ───── what is happening to it ───── */}
      {step === "status" && watch && <Status id={watch} wallet={owner} known={recent.find((r) => r.id === watch)} headRef={top} onDone={onClose} onAnother={() => { setWatch(null); setAmount(""); setRecent(recentCashOuts(owner)); back("amount"); }} />}

      <footer>Paid by <b>GoodCash</b>. GameArena never holds your money.</footer>
      <style>{CSS}</style>
    </div>
  );
}

function problem(e: GoodCashError): string {
  if (e.code === "wallet_rejected") return "You cancelled it in your wallet.";
  if (e.code === "needs_network_fee") { const d = e.data as { needCelo?: number; haveCelo?: number } | undefined; return `Your wallet needs a little CELO to pay the network fee${d?.needCelo ? ` (about ${d.needCelo} CELO; you have ${Number(d.haveCelo ?? 0).toFixed(4)})` : ""}. Add some CELO to your wallet, then come back.`; }
  if (e.code === "fee_mismatch" || e.code === "price_moved" || e.code === "order_expired") return "The price changed while you were confirming. Check the new amount.";
  if (e.code === "insufficient_balance") return "Your wallet holds less G$ than that.";
  if (e.code === "cashout_paused") return "Cash outs are paused for a moment. Try again later.";
  return e.message || "Something went wrong on the way.";
}

function Fees({ amount, lines, rate, get, bare }: { amount: string; lines: FeeLine[]; rate: number; get: number; bare?: boolean }) {
  const rows = (
    <>
      {lines.map((f, i) => <div className="co-row" key={`${f.type}-${i}`}><span>{f.label}{typeof f.percent === "number" && (f.amountG || typeof f.naira === "number") ? ` (${f.percent}%)` : ""}</span><b>− {feeValue(f)}</b></div>)}
      <div className="co-row"><span>Rate</span><b>{naira(rate)} per $1</b></div>
    </>
  );
  if (bare) return rows;
  return <div className="co-fees"><div className="co-row"><span>You send</span><b>{gAmount(Number(amount))} G$</b></div>{rows}<div className="co-row total"><span>You get</span><b>{naira(get)}</b></div></div>;
}

function Status({ id, wallet, known, headRef, onDone, onAnother }: { id: string; wallet: string | undefined; known: Recent | undefined; headRef: React.RefObject<HTMLHeadingElement | null>; onDone: () => void; onAnother: () => void }) {
  const { cashOut, error } = useCashOutStatus(id);
  const status = cashOut?.status ?? known?.status ?? "sent";
  const amount = cashOut?.receive.naira ?? known?.naira ?? 0;
  const said = useRef(false);
  useEffect(() => {
    if (!cashOut) return;
    updateCashOut(wallet, id, cashOut.status);
    if (isOver(cashOut.status) && !said.current) { said.current = true; track(cashOut.status === "paid" ? "cashout_paid" : "cashout_ended", { status: cashOut.status, naira: cashOut.receive.naira, test: cashOut.mode === "test" }); }
  }, [cashOut, id, wallet]);
  const at = status === "paid" ? 3 : status === "processing" ? 2 : 1;
  const bad = status === "failed" || status === "refunded" || status === "expired";
  return (
    <>
      <div className={`co-seal${status === "paid" ? " paid" : bad ? " bad" : ""}`} aria-hidden>{status === "paid" ? "✓" : bad ? "!" : <span className="co-spin" />}</div>
      <h2 ref={headRef} tabIndex={-1} style={{ fontFamily: DISPLAY }} aria-live="polite">{status === "paid" ? `${naira(amount)} paid` : status === "refunded" ? "Sent back to you" : status === "failed" ? "The bank did not take it" : status === "expired" ? "This one ran out" : `${naira(amount)} is on its way`}</h2>
      <p className="co-sub">
        {status === "paid" ? <>It is in {known?.bankName ? <b>{known.bankName} ••{known.last4}</b> : "your bank account"} now.</>
          : status === "refunded" ? "The bank could not be paid, so your G$ went back to your wallet."
          : status === "failed" ? "The payment to your bank failed. GoodCash is looking at it. Keep the reference below."
          : status === "expired" ? "It was never sent, so nothing left your wallet."
          : "Your G$ was sent. GoodCash is paying your bank now. You can close this and come back."}
      </p>
      {!bad && (
        <ol className="co-steps">
          <li className={at >= 1 ? "done" : ""}><i aria-hidden>{at >= 1 ? "✓" : ""}</i>G$ sent from your wallet</li>
          <li className={at >= 3 ? "done" : at === 2 || at === 1 ? "now" : ""}><i aria-hidden>{at >= 3 ? "✓" : ""}</i>Paying your bank</li>
          <li className={at >= 3 ? "done" : ""}><i aria-hidden>{at >= 3 ? "✓" : ""}</i>Paid</li>
        </ol>
      )}
      {error && !cashOut && <div className="co-err" role="alert">We cannot read its status right now. It keeps going. Look again in a moment.</div>}
      <div className="co-ref">Reference <code>{id}</code></div>
      <button className="co-main" onClick={onDone}>{isOver(status) ? "Done" : "Close"}</button>
      <button className="co-ghost" onClick={onAnother}>{isOver(status) ? "Cash out again" : "Back to cash outs"}</button>
    </>
  );
}

const CSS = `
.co { color: #22104f; font-family: "Fredoka", system-ui, sans-serif; text-align: left; }
.co header { display: flex; align-items: center; justify-content: space-between; margin: -4px -4px 8px; }
.co-back, .co-x { width: 40px; height: 40px; border: none; border-radius: 12px; background: none; color: rgba(34,16,79,0.62); font-size: 19px; cursor: pointer; }
.co-back:hover, .co-x:hover { background: rgba(124,58,237,0.08); }
.co-x:disabled { opacity: 0.25; cursor: default; }
.co-dots { display: flex; gap: 6px; }
.co-dots i { width: 22px; height: 5px; border-radius: 3px; background: rgba(124,58,237,0.16); transition: background 0.2s, width 0.2s; }
.co-dots i.on { width: 34px; background: #7c3aed; } .co-dots i.past { background: #c4b5fd; }
.co-test { margin: 0 0 10px; padding: 7px 12px; border-radius: 10px; background: #fef3c7; color: #92400e; font-size: 13px; font-weight: 600; text-align: center; }
.co h2 { margin: 0; font-size: 28px; line-height: 1.1; outline: none; }
.co-sub { margin: 6px 0 16px; font-size: 15px; line-height: 1.45; color: rgba(34,16,79,0.74); }
.co-sub b { color: #22104f; }
.co-amount { display: block; padding: 14px 16px 12px; border-radius: 20px; background: #f3effc; border: 2px solid transparent; }
.co-amount:focus-within { border-color: #7c3aed; background: #fff; }
.co-amount > span, .co-get > span, .co-label { display: block; font-size: 12.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(34,16,79,0.56); }
.co-amount div { display: flex; align-items: baseline; gap: 8px; }
.co-amount input { flex: 1; min-width: 0; border: none; background: none; outline: none; color: #22104f; font-size: 44px; line-height: 1.15; padding: 0; }
.co-amount input::placeholder { color: rgba(34,16,79,0.25); }
.co-amount b { font-size: 20px; color: rgba(34,16,79,0.6); }
.co-have { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; margin: 6px 2px 12px; font-size: 14px; color: rgba(34,16,79,0.7); }
.co-have b { color: #22104f; }
.co-chips { display: flex; gap: 6px; }
.co-chips button { min-height: 34px; padding: 0 14px; border-radius: 999px; border: 1.5px solid rgba(124,58,237,0.3); background: #fff; color: #6d28d9; font: 600 13.5px "Fredoka", system-ui, sans-serif; cursor: pointer; }
.co-get { padding: 14px 16px; border-radius: 20px; background: #fff; border: 1.5px solid rgba(76,29,149,0.14); }
.co-get.ok { border-color: #86efac; background: #f0fdf4; }
.co-get strong { display: block; font-size: 38px; line-height: 1.15; font-weight: 400; color: #22104f; }
.co-get.ok strong { color: #15803d; }
.co-get em { display: block; font-style: normal; font-size: 13px; color: rgba(34,16,79,0.66); }
.co-link { display: inline-block; margin-top: 8px; padding: 6px 0; border: none; background: none; color: #6d28d9; font: 600 14px "Fredoka", system-ui, sans-serif; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.co-fees { margin-top: 8px; padding-top: 4px; border-top: 1px dashed rgba(76,29,149,0.2); }
.co-row { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; padding: 7px 0; font-size: 14.5px; }
.co-row span { color: rgba(34,16,79,0.7); } .co-row b { font-weight: 600; text-align: right; }
.co-row.total { margin-top: 4px; padding-top: 10px; border-top: 1.5px solid rgba(76,29,149,0.16); }
.co-row.total span { color: #22104f; font-weight: 600; } .co-row.total b { font-size: 22px; font-weight: 400; color: #15803d; }
.co-fees .co-row.total b { font-size: 16px; font-weight: 700; }
.co-bill { margin-bottom: 10px; padding: 8px 16px; border-radius: 20px; background: #fff; border: 1.5px solid rgba(76,29,149,0.14); }
.co-err { margin-top: 10px; padding: 10px 12px; border-radius: 12px; background: #fef2f2; color: #b91c1c; font-size: 14px; font-weight: 600; }
.co-main { width: 100%; min-height: 54px; margin-top: 14px; border: none; border-radius: 16px; background: linear-gradient(180deg, #7c3aed, #6d28d9); box-shadow: 0 5px 0 #4c1d95; color: #fff; font: 400 19px ${DISPLAY}; letter-spacing: 0.3px; cursor: pointer; }
.co-main:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 2px 0 #4c1d95; }
.co-main:disabled { opacity: 0.4; cursor: default; box-shadow: 0 5px 0 rgba(76,29,149,0.5); }
.co-ghost { width: 100%; min-height: 48px; margin-top: 12px; border-radius: 16px; border: 1.5px solid rgba(76,29,149,0.22); background: #fff; color: #4c1d95; font: 600 15px "Fredoka", system-ui, sans-serif; cursor: pointer; }
.co-note { margin: 12px 0 0; font-size: 13px; line-height: 1.45; text-align: center; color: rgba(34,16,79,0.62); } .co-note.left { text-align: left; }
.co-recent { margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(76,29,149,0.12); }
.co-recent h3 { margin: 0 0 6px; font-size: 12.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(34,16,79,0.56); }
.co-recent button { width: 100%; min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; border: none; border-bottom: 1px solid rgba(76,29,149,0.08); background: none; color: #22104f; font: 500 14.5px "Fredoka", system-ui, sans-serif; text-align: left; cursor: pointer; }
.co-recent button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(34,16,79,0.72); } .co-recent button b { color: #22104f; }
.co-recent i { flex: none; padding: 3px 10px; border-radius: 999px; font-style: normal; font-size: 12.5px; font-weight: 600; background: #ede9fe; color: #5b21b6; }
.co-recent i.s-paid { background: #dcfce7; color: #166534; } .co-recent i.s-failed, .co-recent i.s-expired { background: #fee2e2; color: #991b1b; } .co-recent i.s-refunded { background: #fef3c7; color: #92400e; }
.co-label { margin: 0 0 6px; }
.co-pick { width: 100%; min-height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-radius: 16px; border: 1.5px solid rgba(76,29,149,0.2); background: #fff; color: #22104f; font: 500 16px "Fredoka", system-ui, sans-serif; cursor: pointer; }
.co-pick span { color: #6d28d9; font-size: 14px; font-weight: 600; }
.co-banks { border-radius: 16px; border: 1.5px solid rgba(76,29,149,0.2); background: #fff; overflow: hidden; }
.co-banks input, .co-field input { width: 100%; min-height: 52px; padding: 0 16px; border: none; outline: none; background: none; color: #22104f; font: 500 16px "Fredoka", system-ui, sans-serif; }
.co-banks input { border-bottom: 1px solid rgba(76,29,149,0.12); }
.co-banks > div { max-height: 208px; overflow-y: auto; }
.co-banks > div button { width: 100%; min-height: 46px; padding: 0 16px; border: none; border-bottom: 1px solid rgba(76,29,149,0.06); background: none; color: #22104f; font: 500 15.5px "Fredoka", system-ui, sans-serif; text-align: left; cursor: pointer; }
.co-banks > div button:hover, .co-banks > div button[aria-selected="true"] { background: #f3effc; }
.co-banks p { margin: 0; padding: 12px 16px; font-size: 13.5px; color: rgba(34,16,79,0.6); }
.co-field { display: block; margin-top: 14px; }
.co-field input { border-radius: 16px; border: 1.5px solid rgba(76,29,149,0.2); background: #fff; font-size: 20px; letter-spacing: 0.08em; }
.co-field input:focus, .co-banks:focus-within { border-color: #7c3aed; }
.co-name { margin-top: 12px; padding: 12px 16px; border-radius: 16px; background: #f3effc; font-size: 14px; color: rgba(34,16,79,0.72); }
.co-name.ok { background: #f0fdf4; border: 1.5px solid #86efac; }
.co-name span { display: block; font-size: 13px; } .co-name b { display: block; margin: 2px 0; font-size: 19px; color: #14532d; } .co-name em { font-style: normal; font-size: 13.5px; }
.co-keep { display: flex; align-items: center; gap: 10px; min-height: 44px; margin-top: 8px; font-size: 14.5px; color: rgba(34,16,79,0.8); cursor: pointer; }
.co-keep input { width: 20px; height: 20px; accent-color: #7c3aed; }
.co-steps { list-style: none; margin: 4px 0 0; padding: 0; }
.co-steps li { display: flex; align-items: center; gap: 12px; padding: 9px 0; font-size: 15.5px; color: rgba(34,16,79,0.45); }
.co-steps li i { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; border: 2px solid rgba(124,58,237,0.25); font-style: normal; font-size: 14px; font-weight: 700; color: #fff; }
.co-steps li.done { color: #22104f; } .co-steps li.done i { background: #16a34a; border-color: #16a34a; }
.co-steps li.now { color: #22104f; font-weight: 600; } .co-steps li.now i { border-color: #7c3aed; border-top-color: transparent; animation: coSpin 0.8s linear infinite; }
.co-seal { width: 72px; height: 72px; margin: 4px 0 12px; border-radius: 50%; display: grid; place-items: center; background: #ede9fe; color: #6d28d9; font-size: 34px; font-weight: 700; }
.co-seal.paid { background: #16a34a; color: #fff; animation: coPop 0.4s cubic-bezier(0.2, 1.4, 0.4, 1); } .co-seal.bad { background: #fee2e2; color: #b91c1c; }
.co-spin { width: 30px; height: 30px; border-radius: 50%; border: 4px solid #c4b5fd; border-top-color: #6d28d9; animation: coSpin 0.8s linear infinite; }
.co-ref { margin-top: 12px; font-size: 12.5px; color: rgba(34,16,79,0.56); } .co-ref code { font-size: 12px; color: rgba(34,16,79,0.8); user-select: all; }
.co footer { margin-top: 16px; font-size: 12.5px; text-align: center; color: rgba(34,16,79,0.5); } .co footer b { color: rgba(34,16,79,0.72); }
.co button:focus-visible, .co input[type="checkbox"]:focus-visible { outline: 3px solid #c4b5fd; outline-offset: 2px; }
@keyframes coSpin { to { transform: rotate(360deg); } } @keyframes coPop { from { transform: scale(0.4); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .co-seal.paid { animation: none; } }
`;
