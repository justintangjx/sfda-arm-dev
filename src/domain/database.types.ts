
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_kind": string,"campaign_id": string | null,"created_at": string,"id": string,"metadata": NonNullable<Json>,"mutation_id": string | null,"reason": string | null,"target_id": string,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_kind": string,"campaign_id"?: string | null,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"mutation_id"?: string | null,"reason"?: string | null,"target_id": string,"target_type": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_kind"?: string,"campaign_id"?: string | null,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"mutation_id"?: string | null,"reason"?: string | null,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_events_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign_coaches": {
                  Row: {
                    "campaign_id": string,"coach_id": string,"created_at": string,"is_active": boolean,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"coach_id": string,"created_at"?: string,"is_active": boolean,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"coach_id"?: string,"created_at"?: string,"is_active"?: boolean,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaign_coaches_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaign_coaches_coach_id_fkey"
      columns: ["coach_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign_players": {
                  Row: {
                    "campaign_id": string,"created_at": string,"is_active": boolean,"player_id": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"is_active": boolean,"player_id": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"is_active"?: boolean,"player_id"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaign_players_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaign_players_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"campaigns": {
                  Row: {
                    "closed_at": string | null,"competition_id": string,"created_at": string,"id": string,"name": string,"planned_preparation_start_on": string | null,"requirements_frozen_at": string | null,"stage": Database["public"]['Enums']["campaign_stage"],"team_name": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"competition_id": string,"created_at"?: string,"id"?: string,"name": string,"planned_preparation_start_on"?: string | null,"requirements_frozen_at"?: string | null,"stage"?: Database["public"]['Enums']["campaign_stage"],"team_name": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "closed_at"?: string | null,"competition_id"?: string,"created_at"?: string,"id"?: string,"name"?: string,"planned_preparation_start_on"?: string | null,"requirements_frozen_at"?: string | null,"stage"?: Database["public"]['Enums']["campaign_stage"],"team_name"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaigns_competition_id_fkey"
      columns: ["competition_id"]
isOneToOne: false
      referencedRelation: "competitions"
      referencedColumns: ["id"]
    }
                  ]
                },"competition_pairings": {
                  Row: {
                    "campaign_id": string,"coach_id": string,"competition_id": string,"created_at": string,"player_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"coach_id": string,"competition_id": string,"created_at"?: string,"player_id": string
                  }
                  Update: {
                    "campaign_id"?: string,"coach_id"?: string,"competition_id"?: string,"created_at"?: string,"player_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "competition_pairings_campaign_id_coach_id_fkey"
      columns: ["campaign_id","coach_id"]
isOneToOne: false
      referencedRelation: "campaign_coaches"
      referencedColumns: ["campaign_id","coach_id"]
    },{
      foreignKeyName: "competition_pairings_campaign_id_competition_id_fkey"
      columns: ["campaign_id","competition_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id","competition_id"]
    },{
      foreignKeyName: "competition_pairings_campaign_id_player_id_fkey"
      columns: ["campaign_id","player_id"]
isOneToOne: false
      referencedRelation: "campaign_players"
      referencedColumns: ["campaign_id","player_id"]
    }
                  ]
                },"competitions": {
                  Row: {
                    "created_at": string,"ends_on": string | null,"id": string,"name": string,"starts_on": string | null,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_on"?: string | null,"id"?: string,"name": string,"starts_on"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "created_at"?: string,"ends_on"?: string | null,"id"?: string,"name"?: string,"starts_on"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"feedback_corrections": {
                  Row: {
                    "admin_id": string,"created_at": string,"development_focus": string | null,"feedback_id": string,"id": string,"observations": string,"observed_on": string,"reason": string,"revision": number,"strengths": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_id": string,"created_at"?: string,"development_focus"?: string | null,"feedback_id": string,"id"?: string,"observations": string,"observed_on": string,"reason": string,"revision": number,"strengths"?: string | null
                  }
                  Update: {
                    "admin_id"?: string,"created_at"?: string,"development_focus"?: string | null,"feedback_id"?: string,"id"?: string,"observations"?: string,"observed_on"?: string,"reason"?: string,"revision"?: number,"strengths"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "feedback_corrections_admin_id_fkey"
      columns: ["admin_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "feedback_corrections_feedback_id_fkey"
      columns: ["feedback_id"]
isOneToOne: false
      referencedRelation: "feedback_entries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "feedback_corrections_feedback_id_fkey"
      columns: ["feedback_id"]
isOneToOne: false
      referencedRelation: "feedback_history"
      referencedColumns: ["id"]
    }
                  ]
                },"feedback_entries": {
                  Row: {
                    "campaign_id": string,"coach_id": string,"competition_id": string,"created_at": string,"development_focus": string | null,"final_obligation_id": string | null,"id": string,"kind": Database["public"]['Enums']["feedback_kind"],"observations": string | null,"observed_on": string | null,"player_id": string,"reviewed_at": string,"status": Database["public"]['Enums']["feedback_status"],"strengths": string | null,"submitted_at": string | null,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"coach_id": string,"competition_id": string,"created_at"?: string,"development_focus"?: string | null,"final_obligation_id"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["feedback_kind"],"observations"?: string | null,"observed_on"?: string | null,"player_id": string,"reviewed_at"?: string,"status": Database["public"]['Enums']["feedback_status"],"strengths"?: string | null,"submitted_at"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "campaign_id"?: string,"coach_id"?: string,"competition_id"?: string,"created_at"?: string,"development_focus"?: string | null,"final_obligation_id"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["feedback_kind"],"observations"?: string | null,"observed_on"?: string | null,"player_id"?: string,"reviewed_at"?: string,"status"?: Database["public"]['Enums']["feedback_status"],"strengths"?: string | null,"submitted_at"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "feedback_entries_competition_id_coach_id_player_id_campaig_fkey"
      columns: ["competition_id","coach_id","player_id","campaign_id"]
isOneToOne: false
      referencedRelation: "competition_pairings"
      referencedColumns: ["competition_id","coach_id","player_id","campaign_id"]
    },{
      foreignKeyName: "feedback_obligation"
      columns: ["final_obligation_id","campaign_id","competition_id","coach_id","player_id"]
isOneToOne: false
      referencedRelation: "final_obligations"
      referencedColumns: ["id","campaign_id","competition_id","coach_id","player_id"]
    }
                  ]
                },"final_obligations": {
                  Row: {
                    "campaign_id": string,"coach_id": string,"competition_id": string,"frozen_at": string,"id": string,"player_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id": string,"coach_id": string,"competition_id": string,"frozen_at"?: string,"id"?: string,"player_id": string
                  }
                  Update: {
                    "campaign_id"?: string,"coach_id"?: string,"competition_id"?: string,"frozen_at"?: string,"id"?: string,"player_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "final_obligations_competition_id_coach_id_player_id_campai_fkey"
      columns: ["competition_id","coach_id","player_id","campaign_id"]
isOneToOne: false
      referencedRelation: "competition_pairings"
      referencedColumns: ["competition_id","coach_id","player_id","campaign_id"]
    }
                  ]
                },"final_waivers": {
                  Row: {
                    "admin_id": string,"created_at": string,"obligation_id": string,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_id": string,"created_at"?: string,"obligation_id": string,"reason": string
                  }
                  Update: {
                    "admin_id"?: string,"created_at"?: string,"obligation_id"?: string,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "final_waivers_admin_id_fkey"
      columns: ["admin_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "final_waivers_obligation_id_fkey"
      columns: ["obligation_id"]
isOneToOne: true
      referencedRelation: "final_obligations"
      referencedColumns: ["id"]
    }
                  ]
                },"mutation_receipts": {
                  Row: {
                    "action": string,"actor_id": string,"campaign_id": string | null,"created_at": string,"fingerprint_version": number,"mutation_id": string,"request_hash": string,"result_id": string,"result_metadata": NonNullable<Json>,"result_type": string,"result_version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id": string,"campaign_id"?: string | null,"created_at"?: string,"fingerprint_version"?: number,"mutation_id": string,"request_hash": string,"result_id": string,"result_metadata"?: NonNullable<Json>,"result_type": string,"result_version": number
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"campaign_id"?: string | null,"created_at"?: string,"fingerprint_version"?: number,"mutation_id"?: string,"request_hash"?: string,"result_id"?: string,"result_metadata"?: NonNullable<Json>,"result_type"?: string,"result_version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "mutation_receipts_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mutation_receipts_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "access_enabled": boolean,"created_at": string,"display_name": string,"id": string,"role": Database["public"]['Enums']["account_role"],"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "access_enabled"?: boolean,"created_at"?: string,"display_name": string,"id": string,"role": Database["public"]['Enums']["account_role"],"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "access_enabled"?: boolean,"created_at"?: string,"display_name"?: string,"id"?: string,"role"?: Database["public"]['Enums']["account_role"],"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "feedback_history": {
                  Row: {
                    "campaign_id": string | null,"coach_id": string | null,"competition_id": string | null,"correction_attribution": string | null,"correction_revision": number | null,"id": string | null,"kind": Database["public"]['Enums']["feedback_kind"] | null,"latest": Json | null,"observed_on": string | null,"original": Json | null,"player_id": string | null,"submitted_at": string | null,"version": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "feedback_entries_competition_id_coach_id_player_id_campaig_fkey"
      columns: ["competition_id","coach_id","player_id","campaign_id"]
isOneToOne: false
      referencedRelation: "competition_pairings"
      referencedColumns: ["competition_id","coach_id","player_id","campaign_id"]
    }
                  ]
                }
          }
          Functions: {
            "admin_list_profiles":
{ Args: { "page_cursor"?: Json,"page_size"?: number,"role_filter"?: Database["public"]['Enums']["account_role"] }; Returns: Json
                           },
"advance_campaign_stage":
{ Args: { "campaign_id": string,"expected_version": number,"mutation_id": string,"next_stage": Database["public"]['Enums']["campaign_stage"],"reason": string }; Returns: Json
                           },
"correct_feedback":
{ Args: { "content": Json,"expected_revision": number,"feedback_id": string,"mutation_id": string,"reason": string }; Returns: Json
                           },
"create_campaign":
{ Args: { "competition_id": string,"mutation_id": string,"name": string,"planned_preparation_start_on": string,"team_name": string }; Returns: Json
                           },
"create_competition":
{ Args: { "ends_on": string,"mutation_id": string,"name": string,"starts_on": string }; Returns: Json
                           },
"create_profile":
{ Args: { "display_name": string,"mutation_id": string,"profile_id": string,"role": Database["public"]['Enums']["account_role"] }; Returns: Json
                           },
"discard_feedback_draft":
{ Args: { "draft_id": string,"expected_version": number,"mutation_id": string }; Returns: Json
                           },
"get_campaign_completion":
{ Args: { "campaign_id": string }; Returns: Json
                           },
"get_my_access":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_final_obligations":
{ Args: { "campaign_id": string,"page_cursor"?: Json,"page_size"?: number,"status_filter"?: string }; Returns: Json
                           },
"save_feedback_draft":
{ Args: { "campaign_id": string,"content": Json,"draft_id": string,"expected_version": number,"kind": Database["public"]['Enums']["feedback_kind"],"mutation_id": string,"player_id": string,"review_confirmed": boolean }; Returns: Json
                           },
"set_campaign_coach":
{ Args: { "active": boolean,"campaign_id": string,"coach_id": string,"expected_version": number,"mutation_id": string,"reason": string }; Returns: Json
                           },
"set_campaign_player":
{ Args: { "active": boolean,"campaign_id": string,"expected_version": number,"mutation_id": string,"player_id": string,"reason": string }; Returns: Json
                           },
"set_profile_access":
{ Args: { "enabled": boolean,"expected_version": number,"mutation_id": string,"profile_id": string,"reason": string }; Returns: Json
                           },
"submit_feedback":
{ Args: { "campaign_id": string,"content": Json,"draft_id": string,"expected_version": number,"kind": Database["public"]['Enums']["feedback_kind"],"mutation_id": string,"player_id": string,"review_confirmed": boolean }; Returns: Json
                           },
"update_campaign_metadata":
{ Args: { "campaign_id": string,"expected_version": number,"mutation_id": string,"name": string,"planned_preparation_start_on": string,"reason": string,"team_name": string }; Returns: Json
                           },
"update_competition":
{ Args: { "competition_id": string,"ends_on": string,"expected_version": number,"mutation_id": string,"name": string,"reason": string,"starts_on": string }; Returns: Json
                           },
"update_profile_name":
{ Args: { "display_name": string,"expected_version": number,"mutation_id": string,"profile_id": string,"reason": string }; Returns: Json
                           },
"waive_final_obligation":
{ Args: { "mutation_id": string,"obligation_id": string,"reason": string }; Returns: Json
                           }
          }
          Enums: {
            "account_role": "admin"|"coach"|"player","campaign_stage": "setup"|"preparation"|"competition"|"final_feedback"|"closed","feedback_kind": "preparation"|"final","feedback_status": "draft"|"submitted"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "account_role": ["admin", "coach", "player"],"campaign_stage": ["setup", "preparation", "competition", "final_feedback", "closed"],"feedback_kind": ["preparation", "final"],"feedback_status": ["draft", "submitted"]
          }
        }
} as const
