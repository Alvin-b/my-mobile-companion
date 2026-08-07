import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CargoRow = {
  id: string;
  status: string;
  cost: number | null;
  mode: string | null;
  dest: string | null;
  origin: string | null;
  pcs: number | null;
  weight: number | null;
  sales_rep: string | null;
  registered_at: string;
  paid_at: string | null;
  collected_at: string | null;
};

export function useCargo() {
  return useQuery({
    queryKey: ["desktop", "cargo"],
    queryFn: async (): Promise<CargoRow[]> => {
      const { data, error } = await supabase
        .from("cargo_packages")
        .select("id,status,cost,mode,dest,origin,pcs,weight,sales_rep,registered_at,paid_at,collected_at")
        .order("registered_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as CargoRow[];
    },
  });
}

export function useCommissions() {
  return useQuery({
    queryKey: ["desktop", "commissions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commissions")
        .select("id,amount,status,trigger,created_at,employee_id,employees(full_name,employee_code,role)")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function usePayments() {
  return useQuery({
    queryKey: ["desktop", "payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id,amount,method,status,paid_at,created_at,mpesa_receipt")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useStaff() {
  return useQuery({
    queryKey: ["desktop", "staff"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id,full_name,employee_code,role,is_active,commission_percentage")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function dayKey(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toISOString().slice(0, 10);
}

export function lastNDays(n: number) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function shortDay(key: string) {
  const d = new Date(key + "T00:00:00Z");
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" });
}