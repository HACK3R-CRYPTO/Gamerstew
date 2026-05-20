import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Game Arena",
};

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "white", color: "black" }}>
      <div style={{ maxWidth: "672px", margin: "0 auto", padding: "64px 24px" }}>
        <Link href="/" style={{ color: "#737373", fontSize: "14px", display: "inline-block", marginBottom: "40px", textDecoration: "none" }}>
          ← Back to Game Arena
        </Link>

        <h1 style={{ fontSize: "36px", fontWeight: 900, textTransform: "uppercase", margin: "0 0 8px", letterSpacing: "0.02em" }}>
          Privacy Policy
        </h1>
        <p style={{ fontSize: "14px", color: "#737373", marginBottom: "40px" }}>Last updated: 20 May 2026</p>

        <div style={{ fontSize: "15px", lineHeight: 1.7, display: "flex", flexDirection: "column", gap: "32px" }}>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>1. Overview</h2>
            <p>Game Arena is designed with privacy in mind. We collect only what is necessary to operate the App. We do not sell your data to third parties.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>2. Data We Collect</h2>
            <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <li><strong>Wallet address</strong> — collected when you connect your wallet. Used to identify your account and record on-chain activity.</li>
              <li><strong>Username</strong> — chosen by you at GamePass mint time, stored on-chain and publicly visible on leaderboards.</li>
              <li><strong>Game session data</strong> — score, duration, and tap log for rhythm sessions. Stored in our database for anti-cheat replay and indexed by our subgraph. Scores are recorded on the Celo blockchain and are public by nature.</li>
              <li><strong>Wager and match outcomes</strong> — Solo Wager and Challenge AI matches are recorded on-chain. Match metadata (commit hashes, revealed seeds, moves) is stored in our database for provable fairness verification.</li>
              <li><strong>Referral relationships</strong> — if you enter a referrer wallet at mint time, that relationship is stored server-side and used to credit the referrer when you qualify in a season.</li>
              <li><strong>Streaks, XP, achievements</strong> — derived from your gameplay and stored in our database.</li>
              <li><strong>Push notification subscriptions</strong> — if you opt in, your web-push subscription (endpoint + keys) is stored so we can send game updates.</li>
            </ul>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>3. Data We Do Not Collect</h2>
            <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <li>We do not collect your name, email address, or phone number unless you contact us directly.</li>
              <li>We do not track your browsing activity outside the App.</li>
              <li>We do not store private keys or seed phrases.</li>
              <li>We do not access your biometric data. The GoodDollar face-scan happens entirely on the GoodDollar protocol.</li>
            </ul>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>4. Third-Party Services</h2>
            <p>Game Arena uses the following third-party services. Their privacy policies apply when you interact with them:</p>
            <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
              <li><strong>Privy</strong> — wallet authentication for browser users.</li>
              <li><strong>GoodDollar</strong> — human verification and G$ claim infrastructure.</li>
              <li><strong>Supabase</strong> — database for game sessions, scores, push subscriptions.</li>
              <li><strong>Forno / Celo RPC</strong> — read access to the Celo blockchain.</li>
              <li><strong>Goldsky</strong> — subgraph indexing for on-chain events.</li>
              <li><strong>MiniPay</strong> — when accessed inside the MiniPay app, Opera's terms and privacy policy apply for the wallet experience.</li>
            </ul>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>5. On-Chain Data</h2>
            <p>Any data recorded on the Celo blockchain (scores, wagers, GamePass mints, habitat unlocks, season team joins) is permanently public and outside our control. You should not interact with the App if you require on-chain anonymity.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>6. Cookies and Local Storage</h2>
            <p>We use browser local storage to cache UI preferences (equipped habitat, audio settings, recent game state). We do not use third-party tracking cookies.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>7. Data Retention</h2>
            <p>We retain off-chain data for as long as the App operates. You can request deletion of your off-chain records by contacting us. We cannot delete on-chain data, as it is immutable.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>8. Security</h2>
            <p>We use industry-standard security practices to protect our databases and infrastructure. No system is perfectly secure. You accept the inherent risk of using a Web3 application when you connect your wallet.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>9. Children</h2>
            <p>Game Arena is not directed at children under 13 and we do not knowingly collect data from them.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>10. Changes</h2>
            <p>We may update this Privacy Policy. Continued use of the App after changes constitutes acceptance of the updated Policy.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>11. Contact</h2>
            <p>For privacy-related questions or requests, contact <a href="mailto:princeogagaoghene@gmail.com" style={{ textDecoration: "underline" }}>princeogagaoghene@gmail.com</a> or in the support Telegram at <a href="https://t.me/+oY4inbBoglViNmE0" style={{ textDecoration: "underline" }}>t.me/+oY4inbBoglViNmE0</a>.</p>
          </section>

        </div>
      </div>
    </div>
  );
}
