export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          at: string
          entity_id: string | null
          entity_type: string
          id: number
          meta: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          at?: string
          entity_id?: string | null
          entity_type: string
          id?: number
          meta?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          at?: string
          entity_id?: string | null
          entity_type?: string
          id?: number
          meta?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chunks: {
        Row: {
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          is_active: boolean
          ordinal: number
          project_id: string
          text: string
          tsv: unknown
        }
        Insert: {
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          is_active?: boolean
          ordinal: number
          project_id: string
          text: string
          tsv?: unknown
        }
        Update: {
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          is_active?: boolean
          ordinal?: number
          project_id?: string
          text?: string
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          attempts: number
          content_hash: string | null
          created_at: string
          doc_role: string | null
          error: string | null
          filename: string
          id: string
          is_active: boolean
          is_synthetic: boolean
          mime: string
          project_id: string
          raw_text: string | null
          size_bytes: number
          status: string
          storage_key: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          attempts?: number
          content_hash?: string | null
          created_at?: string
          doc_role?: string | null
          error?: string | null
          filename: string
          id?: string
          is_active?: boolean
          is_synthetic?: boolean
          mime: string
          project_id: string
          raw_text?: string | null
          size_bytes: number
          status?: string
          storage_key?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          attempts?: number
          content_hash?: string | null
          created_at?: string
          doc_role?: string | null
          error?: string | null
          filename?: string
          id?: string
          is_active?: boolean
          is_synthetic?: boolean
          mime?: string
          project_id?: string
          raw_text?: string | null
          size_bytes?: number
          status?: string
          storage_key?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      industries: {
        Row: {
          name: string
        }
        Insert: {
          name: string
        }
        Update: {
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          email: string
          id: string
          is_active: boolean
          is_super_admin: boolean
          last_magic_link_at: string | null
          name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          email: string
          id: string
          is_active?: boolean
          is_super_admin?: boolean
          last_magic_link_at?: string | null
          name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          email?: string
          id?: string
          is_active?: boolean
          is_super_admin?: boolean
          last_magic_link_at?: string | null
          name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_client: {
        Row: {
          client_name: string | null
          project_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_name?: string | null
          project_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_name?: string | null
          project_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_client_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_client_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_grants: {
        Row: {
          claim: string
          granted_at: string
          granted_by: string | null
          project_id: string
          user_id: string
        }
        Insert: {
          claim: string
          granted_at?: string
          granted_by?: string | null
          project_id: string
          user_id: string
        }
        Update: {
          claim?: string
          granted_at?: string
          granted_by?: string | null
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_links: {
        Row: {
          created_at: string
          description: string | null
          id: string
          project_id: string
          title: string | null
          url: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          project_id: string
          title?: string | null
          url?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          project_id?: string
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_summaries: {
        Row: {
          created_at: string
          id: string
          project_id: string
          summary: Json
          summary_text: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          summary: Json
          summary_text?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          summary?: Json
          summary_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_summaries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tech_tags: {
        Row: {
          project_id: string
          tech_tag_id: string
        }
        Insert: {
          project_id: string
          tech_tag_id: string
        }
        Update: {
          project_id?: string
          tech_tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tech_tags_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tech_tags_tech_tag_id_fkey"
            columns: ["tech_tag_id"]
            isOneToOne: false
            referencedRelation: "tech_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          end_date: string | null
          engagement_type: string | null
          id: string
          industry: string | null
          industry_confidence: number | null
          last_updated_by: string | null
          nda_status: string | null
          start_date: string | null
          status: string
          summary: Json | null
          summary_embedding: string | null
          summary_text: string | null
          team_size: number | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          engagement_type?: string | null
          id?: string
          industry?: string | null
          industry_confidence?: number | null
          last_updated_by?: string | null
          nda_status?: string | null
          start_date?: string | null
          status?: string
          summary?: Json | null
          summary_embedding?: string | null
          summary_text?: string | null
          team_size?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          engagement_type?: string | null
          id?: string
          industry?: string | null
          industry_confidence?: number | null
          last_updated_by?: string | null
          nda_status?: string | null
          start_date?: string | null
          status?: string
          summary?: Json | null
          summary_embedding?: string | null
          summary_text?: string | null
          team_size?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_industry_fkey"
            columns: ["industry"]
            isOneToOne: false
            referencedRelation: "industries"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "projects_last_updated_by_fkey"
            columns: ["last_updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tech_tag_aliases: {
        Row: {
          alias: string
          tech_tag_id: string
        }
        Insert: {
          alias: string
          tech_tag_id: string
        }
        Update: {
          alias?: string
          tech_tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tech_tag_aliases_tech_tag_id_fkey"
            columns: ["tech_tag_id"]
            isOneToOne: false
            referencedRelation: "tech_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      tech_tags: {
        Row: {
          canonical_name: string
          created_at: string
          id: string
          is_approved: boolean
        }
        Insert: {
          canonical_name: string
          created_at?: string
          id?: string
          is_approved?: boolean
        }
        Update: {
          canonical_name?: string
          created_at?: string
          id?: string
          is_approved?: boolean
        }
        Relationships: []
      }
      user_claims: {
        Row: {
          claim: string
          user_id: string
        }
        Insert: {
          claim: string
          user_id: string
        }
        Update: {
          claim?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_not_last_super_admin: {
        Args: { target: string }
        Returns: undefined
      }
      claim_document: { Args: { p_document: string }; Returns: boolean }
      claim_finalize: { Args: { p_project: string }; Returns: boolean }
      has_claim: { Args: { c: string; uid: string }; Returns: boolean }
      is_active_user: { Args: { uid: string }; Returns: boolean }
      is_super_admin: { Args: { uid: string }; Returns: boolean }
      merge_tech_tag: {
        Args: { p_source: string; p_target: string }
        Returns: number
      }
      purgeable_projects: {
        Args: { match_limit?: number; older_than_days?: number }
        Returns: {
          document_id: string
          project_id: string
          storage_key: string
        }[]
      }
      recently_active_projects: {
        Args: { match_limit?: number; within_hours?: number }
        Returns: {
          id: string
        }[]
      }
      search_projects: {
        Args: {
          filter_industry?: string
          filter_tags?: string[]
          match_limit?: number
          min_similarity?: number
          query_embedding: string
          query_text?: string
        }
        Returns: {
          best_snippet: string
          best_source: string
          project_id: string
          score: number
        }[]
      }
      may_grant_on_project: {
        Args: { p_project: string; uid: string }
        Returns: boolean
      }
      set_nda_status: {
        Args: { p_project: string; p_status: string }
        Returns: boolean
      }
      soft_delete_project: { Args: { p_project: string }; Returns: boolean }
      stranded_projects: {
        Args: { older_than_minutes?: number }
        Returns: {
          id: string
        }[]
      }
      stuck_documents: {
        Args: { older_than_minutes?: number }
        Returns: {
          id: string
          project_id: string
        }[]
      }
      tech_tag_alias_key: { Args: { name: string }; Returns: string }
      unapproved_tag_usage: {
        Args: Record<PropertyKey, never>
        Returns: {
          canonical_name: string
          created_at: string
          id: string
          project_count: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

