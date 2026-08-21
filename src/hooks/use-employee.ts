import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Employee = {
  id: string;
  user_id: string | null;
  employee_code: string;
  full_name: string;
  role: "admin" | "sales_manager" | "logistics_manager" | "sales_rep" | "finance_manager";
  commission_percentage: number;
  is_active: boolean;
  email: string | null;
  phone: string | null;
};

export function useSession() {
  const [session, setSession] = useState<import("@supabase/supabase-js").Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, loading };
}

export function useEmployee() {
  const { session, loading: sessionLoading } = useSession();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session?.user) {
      setEmployee(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("employees")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!cancelled) {
        setEmployee(data as Employee | null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, sessionLoading]);

  return { session, employee, loading: sessionLoading || loading };
}
