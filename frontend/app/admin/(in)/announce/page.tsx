import { adminRead } from "@/lib/server/adminApi";
import { Card, Page, Table, when } from "@/components/admin/ui";
import AnnounceForm from "./AnnounceForm";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface Sent { id: number; title: string; body: string | null; url: string | null; category: string; sent_at: string }
const WHY: Record<string, string> = {
  confirm_live: "Tick the box to confirm the release is live before sending.",
  title_and_text_needed: "The message needs a title and a text.",
  title_too_long: "The title is over 80 characters.", text_too_long: "The text is over 400 characters.",
  push_needs_both: "A push needs both a title and a text.", push_too_long: "The push is too long: 60 for the title, 160 for the text.",
  bad_link: "The page to open must be a page of the app.", already_sent: "That exact message was already sent today. Nothing went out a second time.",
  could_not_post: "The message could not be saved, so nothing was sent. Try again.", not_allowed: "Only an Admin or a Super Admin can send.",
  unavailable: "This server cannot send announcements right now.", unreachable: "The game server could not be reached. Nothing was sent.",
};
const KIND: Record<string, string> = { whats_new: "What is new", announcement: "Announcement", broadcast: "Push only" };

export default async function AnnouncePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const ok = sp.ok === "sent"; const err = typeof sp.err === "string" ? sp.err : null; const pushed = typeof sp.pushed === "string" ? sp.pushed : null;
  const [me, sent] = await Promise.all([adminRead<{ role: string }>("me"), adminRead<Sent[]>("announcements", { limit: 20 })]);
  const canSend = me.data?.role === "admin" || me.data?.role === "super_admin";
  return (
    <Page title="Announce" sub="Tell every player what is new. One message reaches them three ways: a pop-up the next time they open the home screen, a line in their bell, and a push if you write one.">
      {ok && <div role="status" style={{ padding: "12px 14px", borderRadius: 14, background: "#dcfce7", color: "#166534", fontWeight: 700, fontSize: 14 }}>Sent. It is in every player&apos;s bell now{pushed && pushed !== "none" ? `, and the push went to ${pushed} ${pushed === "1" ? "device" : "devices"}` : ", with no push"}.</div>}
      {err && <div role="alert" style={{ padding: "12px 14px", borderRadius: 14, background: "#fee2e2", color: "#991b1b", fontWeight: 700, fontSize: 14 }}>{WHY[err] ?? "That did not go through. Nothing was sent."}</div>}
      <AnnounceForm canSend={canSend} />
      <Card title="Sent before" note="The last messages sent to everyone, newest first. Players can delete one from their own bell; that does not remove it here.">
        <Table rows={sent.data ?? []} empty="Nothing has been sent yet." cols={[
          { head: "Sent", cell: (x) => when(x.sent_at) }, { head: "Kind", cell: (x) => KIND[x.category] ?? x.category },
          { head: "Title", cell: (x) => <b>{x.title}</b> }, { head: "Text", cell: (x) => <span style={{ display: "block", maxWidth: 520, whiteSpace: "normal", lineHeight: 1.4 }}>{x.body ?? ""}</span> }, { head: "Opens", cell: (x) => x.url ?? "" },
        ]} />
      </Card>
    </Page>
  );
}
