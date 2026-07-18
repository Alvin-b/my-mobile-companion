export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_employee_id: string | null
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_employee_id?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_employee_id?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          active: boolean
          created_at: string
          employee_id: string | null
          flat_amount: number | null
          id: string
          percentage: number | null
          role: Database["public"]["Enums"]["app_role"] | null
          trigger: Database["public"]["Enums"]["commission_trigger"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          employee_id?: string | null
          flat_amount?: number | null
          id?: string
          percentage?: number | null
          role?: Database["public"]["Enums"]["app_role"] | null
          trigger: Database["public"]["Enums"]["commission_trigger"]
        }
        Update: {
          active?: boolean
          created_at?: string
          employee_id?: string | null
          flat_amount?: number | null
          id?: string
          percentage?: number | null
          role?: Database["public"]["Enums"]["app_role"] | null
          trigger?: Database["public"]["Enums"]["commission_trigger"]
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_id: string
          id: string
          package_id: string | null
          payment_id: string | null
          percentage: number | null
          status: Database["public"]["Enums"]["commission_status"]
          trigger: Database["public"]["Enums"]["commission_trigger"]
        }
        Insert: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_id: string
          id?: string
          package_id?: string | null
          payment_id?: string | null
          percentage?: number | null
          status?: Database["public"]["Enums"]["commission_status"]
          trigger: Database["public"]["Enums"]["commission_trigger"]
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          package_id?: string | null
          payment_id?: string | null
          percentage?: number | null
          status?: Database["public"]["Enums"]["commission_status"]
          trigger?: Database["public"]["Enums"]["commission_trigger"]
        }
        Relationships: [
          {
            foreignKeyName: "commissions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          city: string | null
          created_at: string
          created_by: string | null
          default_address: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          national_id: string | null
          notes: string | null
          phone: string
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          default_address?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          national_id?: string | null
          notes?: string | null
          phone: string
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          default_address?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          national_id?: string | null
          notes?: string | null
          phone?: string
          updated_at?: string
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          collected_at: string
          collected_by_id_number: string | null
          collected_by_name: string
          collected_by_phone: string | null
          id: string
          package_id: string
          proof_photo_url: string | null
          relationship_to_customer: string | null
          released_by_employee_id: string | null
          signature_url: string | null
        }
        Insert: {
          collected_at?: string
          collected_by_id_number?: string | null
          collected_by_name: string
          collected_by_phone?: string | null
          id?: string
          package_id: string
          proof_photo_url?: string | null
          relationship_to_customer?: string | null
          released_by_employee_id?: string | null
          signature_url?: string | null
        }
        Update: {
          collected_at?: string
          collected_by_id_number?: string | null
          collected_by_name?: string
          collected_by_phone?: string | null
          id?: string
          package_id?: string
          proof_photo_url?: string | null
          relationship_to_customer?: string | null
          released_by_employee_id?: string | null
          signature_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_released_by_employee_id_fkey"
            columns: ["released_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          commission_percentage: number
          created_at: string
          email: string | null
          employee_code: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          commission_percentage?: number
          created_at?: string
          email?: string | null
          employee_code: string
          full_name: string
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          commission_percentage?: number
          created_at?: string
          email?: string | null
          employee_code?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          audience: Database["public"]["Enums"]["notification_audience"]
          body: string | null
          created_at: string
          data: Json | null
          employee_id: string | null
          id: string
          read_at: string | null
          title: string
        }
        Insert: {
          audience?: Database["public"]["Enums"]["notification_audience"]
          body?: string | null
          created_at?: string
          data?: Json | null
          employee_id?: string | null
          id?: string
          read_at?: string | null
          title: string
        }
        Update: {
          audience?: Database["public"]["Enums"]["notification_audience"]
          body?: string | null
          created_at?: string
          data?: Json | null
          employee_id?: string | null
          id?: string
          read_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      package_images: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["image_kind"]
          package_id: string
          uploaded_by: string | null
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["image_kind"]
          package_id: string
          uploaded_by?: string | null
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["image_kind"]
          package_id?: string
          uploaded_by?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_images_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_images_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      package_status_history: {
        Row: {
          changed_by_employee_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["package_status"] | null
          id: string
          notes: string | null
          package_id: string
          to_status: Database["public"]["Enums"]["package_status"]
        }
        Insert: {
          changed_by_employee_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["package_status"] | null
          id?: string
          notes?: string | null
          package_id: string
          to_status: Database["public"]["Enums"]["package_status"]
        }
        Update: {
          changed_by_employee_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["package_status"] | null
          id?: string
          notes?: string | null
          package_id?: string
          to_status?: Database["public"]["Enums"]["package_status"]
        }
        Relationships: [
          {
            foreignKeyName: "package_status_history_changed_by_employee_id_fkey"
            columns: ["changed_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_status_history_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          amount_due: number | null
          barcode: string | null
          bin_code: string | null
          category: string | null
          cleared_at: string | null
          collected_at: string | null
          courier: string | null
          created_at: string
          currency: string
          customer_id: string | null
          description: string | null
          destination_city: string | null
          external_barcode: string | null
          height_cm: number | null
          id: string
          intake_photo_url: string | null
          length_cm: number | null
          ocr_confidence: number | null
          ocr_payload: Json | null
          qr_code_token: string
          ready_at: string | null
          received_at: string
          received_by_employee_id: string | null
          shelf_id: string | null
          special_notes: string | null
          status: Database["public"]["Enums"]["package_status"]
          supplier: string | null
          tracking_number: string
          updated_at: string
          verified_at: string | null
          warehouse_id: string | null
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          amount_due?: number | null
          barcode?: string | null
          bin_code?: string | null
          category?: string | null
          cleared_at?: string | null
          collected_at?: string | null
          courier?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          description?: string | null
          destination_city?: string | null
          external_barcode?: string | null
          height_cm?: number | null
          id?: string
          intake_photo_url?: string | null
          length_cm?: number | null
          ocr_confidence?: number | null
          ocr_payload?: Json | null
          qr_code_token?: string
          ready_at?: string | null
          received_at?: string
          received_by_employee_id?: string | null
          shelf_id?: string | null
          special_notes?: string | null
          status?: Database["public"]["Enums"]["package_status"]
          supplier?: string | null
          tracking_number?: string
          updated_at?: string
          verified_at?: string | null
          warehouse_id?: string | null
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          amount_due?: number | null
          barcode?: string | null
          bin_code?: string | null
          category?: string | null
          cleared_at?: string | null
          collected_at?: string | null
          courier?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          description?: string | null
          destination_city?: string | null
          external_barcode?: string | null
          height_cm?: number | null
          id?: string
          intake_photo_url?: string | null
          length_cm?: number | null
          ocr_confidence?: number | null
          ocr_payload?: Json | null
          qr_code_token?: string
          ready_at?: string | null
          received_at?: string
          received_by_employee_id?: string | null
          shelf_id?: string | null
          special_notes?: string | null
          status?: Database["public"]["Enums"]["package_status"]
          supplier?: string | null
          tracking_number?: string
          updated_at?: string
          verified_at?: string | null
          warehouse_id?: string | null
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "packages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_received_by_employee_id_fkey"
            columns: ["received_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_shelf_id_fkey"
            columns: ["shelf_id"]
            isOneToOne: false
            referencedRelation: "warehouse_shelves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          checkout_request_id: string | null
          created_at: string
          currency: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          mpesa_receipt: string | null
          package_id: string
          paid_at: string | null
          phone: string | null
          receipt_url: string | null
          received_by_employee_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          checkout_request_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          mpesa_receipt?: string | null
          package_id: string
          paid_at?: string | null
          phone?: string | null
          receipt_url?: string | null
          received_by_employee_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          checkout_request_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          mpesa_receipt?: string | null
          package_id?: string
          paid_at?: string | null
          phone?: string | null
          receipt_url?: string | null
          received_by_employee_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_by_employee_id_fkey"
            columns: ["received_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      warehouse_bins: {
        Row: {
          code: string
          created_at: string
          id: string
          is_occupied: boolean
          shelf_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_occupied?: boolean
          shelf_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_occupied?: boolean
          shelf_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_bins_shelf_id_fkey"
            columns: ["shelf_id"]
            isOneToOne: false
            referencedRelation: "warehouse_shelves"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_shelves: {
        Row: {
          capacity: number | null
          code: string
          created_at: string
          id: string
          section: string | null
          warehouse_id: string
        }
        Insert: {
          capacity?: number | null
          code: string
          created_at?: string
          id?: string
          section?: string | null
          warehouse_id: string
        }
        Update: {
          capacity?: number | null
          code?: string
          created_at?: string
          id?: string
          section?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_shelves_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          city: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          city?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          city?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      whatsapp_logs: {
        Row: {
          created_at: string
          customer_id: string | null
          error: string | null
          id: string
          package_id: string | null
          payload: Json | null
          provider_message_id: string | null
          status: string
          template: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          package_id?: string | null
          payload?: Json | null
          provider_message_id?: string | null
          status?: string
          template: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          package_id?: string | null
          payload?: Json | null
          provider_message_id?: string | null
          status?: string
          template?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_tracking_number: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      transition_package_status: {
        Args: {
          _by?: string
          _notes?: string
          _package_id: string
          _to: Database["public"]["Enums"]["package_status"]
        }
        Returns: {
          amount_due: number | null
          barcode: string | null
          bin_code: string | null
          category: string | null
          cleared_at: string | null
          collected_at: string | null
          courier: string | null
          created_at: string
          currency: string
          customer_id: string | null
          description: string | null
          destination_city: string | null
          external_barcode: string | null
          height_cm: number | null
          id: string
          intake_photo_url: string | null
          length_cm: number | null
          ocr_confidence: number | null
          ocr_payload: Json | null
          qr_code_token: string
          ready_at: string | null
          received_at: string
          received_by_employee_id: string | null
          shelf_id: string | null
          special_notes: string | null
          status: Database["public"]["Enums"]["package_status"]
          supplier: string | null
          tracking_number: string
          updated_at: string
          verified_at: string | null
          warehouse_id: string | null
          weight_kg: number | null
          width_cm: number | null
        }
        SetofOptions: {
          from: "*"
          to: "packages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "sales_manager" | "logistics_manager" | "sales_rep"
      commission_status: "pending" | "approved" | "paid"
      commission_trigger: "received" | "payment" | "delivery"
      image_kind:
        | "sticker"
        | "extra"
        | "proof_of_collection"
        | "qr"
        | "signature"
      notification_audience: "admin" | "employee" | "customer"
      package_status:
        | "received"
        | "verified"
        | "awaiting_payment"
        | "paid"
        | "ready_for_collection"
        | "collected"
        | "cleared"
      payment_method: "mpesa_stk" | "mpesa_manual" | "cash" | "bank"
      payment_status: "pending" | "paid" | "failed" | "refunded" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "sales_manager", "logistics_manager", "sales_rep"],
      commission_status: ["pending", "approved", "paid"],
      commission_trigger: ["received", "payment", "delivery"],
      image_kind: [
        "sticker",
        "extra",
        "proof_of_collection",
        "qr",
        "signature",
      ],
      notification_audience: ["admin", "employee", "customer"],
      package_status: [
        "received",
        "verified",
        "awaiting_payment",
        "paid",
        "ready_for_collection",
        "collected",
        "cleared",
      ],
      payment_method: ["mpesa_stk", "mpesa_manual", "cash", "bank"],
      payment_status: ["pending", "paid", "failed", "refunded", "cancelled"],
    },
  },
} as const
