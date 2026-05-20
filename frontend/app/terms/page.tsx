import Link from "next/link";

export const metadata = {
  title: "Terms of Service — Game Arena",
};

export default function TermsPage() {
  return (
    <div style={{ minHeight: "100vh", background: "white", color: "black" }}>
      <div style={{ maxWidth: "672px", margin: "0 auto", padding: "64px 24px" }}>
        <Link href="/" style={{ color: "#737373", fontSize: "14px", display: "inline-block", marginBottom: "40px", textDecoration: "none" }}>
          ← Back to Game Arena
        </Link>

        <h1 style={{ fontSize: "36px", fontWeight: 900, textTransform: "uppercase", margin: "0 0 8px", letterSpacing: "0.02em" }}>
          Terms of Service
        </h1>
        <p style={{ fontSize: "14px", color: "#737373", marginBottom: "40px" }}>Last updated: 20 May 2026</p>

        <div style={{ fontSize: "15px", lineHeight: 1.7, display: "flex", flexDirection: "column", gap: "32px" }}>

          <section style={{ background: "#f5f5f5", borderRadius: "8px", padding: "16px", fontSize: "14px" }}>
            <p><strong>Operator:</strong> Game Arena is independently operated by the Game Arena team. It is not operated by, affiliated with, endorsed by, or in any way connected to Opera Norway AS, MiniPay, Celo Foundation, or any of their subsidiaries or partners. Any use of the MiniPay platform to access Game Arena is subject to Opera's own terms and policies separately.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>1. Acceptance of Terms</h2>
            <p>By accessing or using Game Arena ("the App"), you agree to be bound by these Terms of Service. If you do not agree, do not use the App.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>2. What Game Arena Does</h2>
            <p>Game Arena is a Web3 mini-game platform built on the Celo blockchain. Players verify as a human through GoodDollar, mint a soulbound GamePass NFT, and earn G$ rewards through skill games (Rhythm and Simon), AI wager matches, and community competitions. The platform integrates with the GoodDollar protocol, HabitatRegistry contract, and the GameArena ArenaPlatform contract.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>3. Blockchain Transactions</h2>
            <p>Game Arena records scores, wagers, and habitat unlocks as transactions on the Celo blockchain. All on-chain transactions are irreversible. Network fees apply. MiniPay users pay fees in stablecoins via the CIP-64 fee-currency mechanism. You are responsible for maintaining access to your wallet and private keys.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>4. GoodDollar Integration</h2>
            <p>Game Arena integrates with the GoodDollar protocol for human verification and daily G$ claims. Eligibility for G$ claims is determined by the GoodDollar smart contracts and is subject to their terms. Game Arena does not guarantee G$ availability, claim amounts, or claim cadence.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>5. Wagering and Skill Games</h2>
            <p>The Solo Wager and Challenge AI features let you bet G$ on a game outcome. Wagers are settled by on-chain contracts; the platform does not custody your funds outside of an in-flight match. AI matches are signed with a hash-committed seed revealed after resolution for provable fairness. You are solely responsible for the wagers you place. Game Arena is not liable for losses incurred through play.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>6. Virtual Items</h2>
            <p>Habitats, GamePass NFTs, and other digital items unlocked or minted in the App are recorded on-chain. Purchases are final and non-refundable. Virtual items have no guaranteed monetary value outside the App.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>7. User Conduct</h2>
            <p>You agree not to manipulate, exploit, or abuse the App's systems including game scoring, wager outcomes, referral rewards, season leaderboard rankings, or any anti-cheat mechanism. We reserve the right to disqualify accounts, void wager outcomes, or withhold season prizes from accounts engaged in fraudulent activity.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>8. Referral Program</h2>
            <p>Game Arena operates an opt-in referral program. Referral relationships are captured at GamePass mint time and recorded server-side. Referrer credit is awarded when the referee joins a season team. Self-referrals are not permitted. Referral rewards are capped per wallet per season.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>9. Season Prizes</h2>
            <p>Game Arena periodically runs seasons with G$ prize pools. Prize structure, qualification rules, and pool sizes are published before each season begins. Distribution happens after season close. We reserve the right to adjust or cancel prizes in cases of detected fraud or platform issues.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>10. Disclaimer of Warranties</h2>
            <p>The App is provided "as is" without warranty of any kind. We do not guarantee uptime, data persistence, or the availability of any specific feature. Blockchain networks may experience congestion or outages outside our control.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>11. Limitation of Liability</h2>
            <p>Game Arena is not liable for any loss of funds, loss of access to your wallet, loss of virtual items, or missed prize distributions arising from your use of the App.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>12. Changes to Terms</h2>
            <p>We may update these Terms at any time. Continued use of the App after changes constitutes acceptance of the new Terms.</p>
          </section>

          <section>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>13. Contact</h2>
            <p>For questions about these Terms, contact us at <a href="mailto:princeogagaoghene@gmail.com" style={{ textDecoration: "underline" }}>princeogagaoghene@gmail.com</a> or in the support Telegram at <a href="https://t.me/+oY4inbBoglViNmE0" style={{ textDecoration: "underline" }}>t.me/+oY4inbBoglViNmE0</a>.</p>
          </section>

        </div>
      </div>
    </div>
  );
}
