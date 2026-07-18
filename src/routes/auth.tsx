import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — DEXCARGO Ops" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"sales_rep" | "logistics_manager" | "sales_manager" | "admin">("sales_rep");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/dashboard" },
        });
        if (error) throw error;
        const userId = data.user?.id;
        if (userId) {
          const code = role.toUpperCase().slice(0, 3) + "-" + Math.floor(1000 + Math.random() * 9000);
          await supabase.from("employees").insert({
            user_id: userId,
            employee_code: code,
            full_name: fullName || email.split("@")[0],
            email,
            role,
            is_active: true,
            commission_percentage: role === "sales_rep" ? 5 : role === "logistics_manager" ? 3 : 0,
          });
          await supabase.from("user_roles").insert({ user_id: userId, role });
        }
        if (data.session) navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-8">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2B4EE8] to-[#F5A623] flex items-center justify-center shadow-lg shadow-blue-500/30 mb-3">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <path d="M6 16 L14 8 L22 16 L14 24Z" fill="#fff" />
              <path d="M16 8 L26 16 L16 24 L20 16Z" fill="#F5A623" />
            </svg>
          </div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">DEXCARGO</h1>
          <p className="text-xs text-[--t2] mt-1 font-medium">Logistics & Operations Gateway</p>
        </div>

        <form onSubmit={submit} className="card-elevated p-5 flex flex-col gap-3">
          <div className="flex gap-2 p-1 bg-[--s1] rounded-lg text-xs font-semibold">
            <button type="button" onClick={() => setMode("signin")}
              className={`flex-1 py-2 rounded-md transition ${mode === "signin" ? "bg-[--blue] text-white" : "text-[--t2]"}`}>
              Sign in
            </button>
            <button type="button" onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-md transition ${mode === "signup" ? "bg-[--blue] text-white" : "text-[--t2]"}`}>
              Register
            </button>
          </div>

          {mode === "signup" && (
            <>
              <Field label="Full name">
                <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} placeholder="Jane Wanjiru" />
              </Field>
              <Field label="Role">
                <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={inputCls}>
                  <option value="sales_rep">Sales Representative</option>
                  <option value="logistics_manager">Logistics Manager</option>
                  <option value="sales_manager">Sales Manager</option>
                  <option value="admin">Administrator</option>
                </select>
              </Field>
            </>
          )}
          <Field label="Email">
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@dexcargo.com" />
          </Field>
          <Field label="Password">
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
          </Field>
          {err && <div className="text-xs text-[--red] bg-[--red]/10 border border-[--red]/30 rounded-md p-2">{err}</div>}
          <button disabled={loading} className="mt-1 py-3 rounded-lg bg-[--blue] hover:bg-[--blue]/90 text-white text-sm font-semibold transition disabled:opacity-50">
            {loading ? "Please wait…" : mode === "signup" ? "Create account" : "Authenticate session"}
          </button>
          <p className="text-[10px] text-[--t3] text-center mt-1 font-semibold font-mono tracking-widest">SYS GATEWAY v2.4.0-NBO</p>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  "w-full bg-[--s1] border border-[--b1] rounded-md px-3 py-2.5 text-sm text-[--t1] placeholder:text-[--t3] focus:outline-none focus:ring-2 focus:ring-[--ring]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[--t3] mb-1.5">{label}</div>
      {children}
    </label>
  );
}