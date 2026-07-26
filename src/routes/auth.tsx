import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — DEXCARGO Ops" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/dashboard" });
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
          <div className="text-xs text-[--t2] bg-[--s1] rounded-lg p-3">
            Staff accounts are created by an administrator. Contact your manager if you need access.
          </div>
          <Field label="Email">
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@dexcargo.com" />
          </Field>
          <Field label="Password">
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
          </Field>
          {err && <div className="text-xs text-[--red] bg-[--red]/10 border border-[--red]/30 rounded-md p-2">{err}</div>}
          <button disabled={loading} className="mt-1 py-3 rounded-lg bg-[--blue] hover:bg-[--blue]/90 text-white text-sm font-semibold transition disabled:opacity-50">
            {loading ? "Please wait…" : "Authenticate session"}
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
