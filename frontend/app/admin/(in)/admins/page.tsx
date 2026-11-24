import { adminRead } from "@/lib/server/adminApi";
import { currentAdmin } from "@/lib/server/adminSession";
import { Card, Page, Problem, Table, button, input, when, C } from "@/components/admin/ui";
import { disableAdmin, saveAdmin } from "../actions";

type SP = Promise<Record<string, string | string[] | undefined>>;
interface A { email: string; name: string | null; role: string; disabled: boolean; created_at: string; last_login_at: string | null }
interface Act { at: string; admin_email: string; action: string; detail: Record<string, unknown> | null }
const ROLE: Record<string, string> = { analyst: "Analyst", admin: "Admin", super_admin: "Super Admin" };
const ERR: Record<string, string> = { bad_email: "That is not an email address.", bad_role: "Choose a role.", weak_password: "The password must be at least 12 characters.", not_yourself: "You cannot disable your own account.", not_allowed: "Only a Super Admin can do this." };

export default async function Admins({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const me = await currentAdmin();
  const [list, acts] = await Promise.all([adminRead<A[]>("admins"), adminRead<Act[]>("actions", { limit: 100 })]);
  if (!list.ok) return <Page title="Admins"><Problem error={list.error} /></Page>;
  const label: React.CSSProperties = { display: "grid", gap: 5, fontSize: 13, fontWeight: 700, color: C.ink };
  return (
    <Page title="Admins" sub="Who can sign in here, what they can do, and what they have done.">
      {typeof sp.ok === "string" && <div style={{ background: "#dcfce7", color: "#166534", borderRadius: 12, padding: "10px 13px", fontSize: 14, marginBottom: 12, fontWeight: 600 }}>Saved.</div>}
      {typeof sp.err === "string" && <div role="alert" style={{ background: "#fef2f2", color: C.bad, borderRadius: 12, padding: "10px 13px", fontSize: 14, marginBottom: 12, fontWeight: 600 }}>{ERR[sp.err] ?? "That could not be saved."}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Card title="Roles">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6, color: C.ink }}>
            <li><b>Analyst</b>: sees every page and can download reports.</li>
            <li><b>Admin</b>: the same, and can record payouts.</li>
            <li><b>Super Admin</b>: the same, and can add or disable admins and see this page.</li>
          </ul>
        </Card>
        <Card title="Add an admin, or reset one's password" note="Saving an email that already exists replaces its name, role and password.">
          <form action={saveAdmin} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <label style={label}>Email<input name="email" type="email" required style={input} /></label>
            <label style={label}>Name<input name="name" style={input} /></label>
            <label style={label}>Role<select name="role" style={input}><option value="analyst">Analyst</option><option value="admin">Admin</option><option value="super_admin">Super Admin</option></select></label>
            <label style={label}>Password (12 or more)<input name="password" type="password" required minLength={12} autoComplete="new-password" style={input} /></label>
            <button style={{ ...button, gridColumn: "1 / -1" }}>Save admin</button>
          </form>
        </Card>
      </div>
      <Card title="Admins">
        <Table rows={list.data ?? []} cols={[
          { head: "Email", cell: (x) => <b>{x.email}</b> }, { head: "Name", cell: (x) => x.name ?? "–" }, { head: "Role", cell: (x) => ROLE[x.role] ?? x.role },
          { head: "State", cell: (x) => (x.disabled ? <span style={{ color: C.bad, fontWeight: 700 }}>Disabled</span> : <span style={{ color: C.good, fontWeight: 700 }}>Active</span>) },
          { head: "Last sign-in", cell: (x) => when(x.last_login_at) }, { head: "Added", cell: (x) => when(x.created_at) },
          { head: "", cell: (x) => (x.email === me?.email ? <span style={{ color: C.dim }}>You</span> : (
            <form action={disableAdmin}><input type="hidden" name="email" value={x.email} /><input type="hidden" name="disabled" value={x.disabled ? "false" : "true"} /><button style={{ ...button, padding: "5px 10px", fontSize: 13, background: x.disabled ? "#15803d" : "#b91c1c" }}>{x.disabled ? "Enable" : "Disable"}</button></form>)) },
        ]} />
      </Card>
      <div style={{ height: 14 }} />
      <Card title="Admin activity log"><Table rows={acts.data ?? []} cols={[{ head: "When", cell: (x) => when(x.at) }, { head: "Admin", cell: (x) => x.admin_email }, { head: "Action", cell: (x) => x.action.replace(/_/g, " ") }, { head: "Detail", cell: (x) => <span title={JSON.stringify(x.detail)}>{x.detail && Object.keys(x.detail).length ? JSON.stringify(x.detail).slice(0, 90) : "–"}</span> }]} empty="Nothing logged yet." /></Card>
    </Page>
  );
}
