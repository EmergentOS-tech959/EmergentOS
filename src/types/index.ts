// EmergentOS Phase 1 - TypeScript Type Definitions

/**
 * Sync status states for ingestion pipelines
 */
export type SyncStatus = 'disconnected' | 'connecting' | 'fetching' | 'securing' | 'complete' | 'error';

/**
 * Email metadata stored in Supabase
 */
export interface Email {
  id: string;
  user_id: string;
  message_id: string;
  thread_id?: string;
  sender: string;
  sender_email?: string;
  subject: string;
  snippet?: string;
  body_preview?: string;
  received_at: string;
  labels?: string[];
  is_important?: boolean;
  security_verified: boolean;
  created_at: string;
}

/**
 * Calendar event stored in Supabase
 */
export interface CalendarEvent {
  id: string;
  user_id: string;
  event_id: string;
  calendar_id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  location?: string;
  attendees?: string[]; // stored as JSONB in DB
  is_all_day: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
  has_conflict: boolean;
  conflict_with?: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Drive document metadata
 */
export interface DriveDocument {
  id: string;
  user_id: string;
  document_id: string;
  name: string;
  mime_type: string;
  folder_path?: string;
  modified_at: string;
  web_view_link?: string;
  content_hash?: string;
  is_context_folder: boolean;
  created_at: string;
}

/**
 * AI-generated daily briefing
 */
export interface Briefing {
  id: string;
  user_id: string;
  briefing_date: string;
  content: string; // Markdown content
  summary?: string;
  key_priorities: Array<{
    title: string;
    description: string;
    source: string;
  }>;
  schedule_summary?: {
    conflicts: Array<string>;
    key_meetings: Array<string>;
  };
  generated_at: string;
  sources?: string[];
}

/**
 * User sync status record from Supabase
 */
export interface SyncStatusRecord {
  id: string;
  user_id: string;
  status: SyncStatus;
  current_provider?: string;
  error_message?: string;
  updated_at: string;
}

/**
 * Gmail message metadata from Nango proxy
 */
export interface GmailMessage {
  id: string;
  threadId: string;
}

/**
 * Gmail message detail response
 */
export interface GmailMessageDetail {
  id: string;
  payload: {
    headers: Array<{
      name: string;
      value: string;
    }>;
  };
}

/**
 * Parsed email data for processing
 */
export interface ParsedEmail {
  id: string;
  from: string;
  subject: string;
  date: string;
}

/**
 * Database types for Supabase
 */
export interface Database {
  public: {
    Tables: {
      connections: {
        Row: {
          id?: string;
          user_id: string;
          provider: string;
          connection_id: string;
          status?: string;
          metadata?: Record<string, unknown> | null;
          last_sync_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider: string;
          connection_id: string;
          status?: string;
          metadata?: Record<string, unknown> | null;
          last_sync_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id?: string;
          user_id: string;
          provider: string;
          connection_id: string;
          status?: string;
          metadata?: Record<string, unknown> | null;
          last_sync_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }>;
      };
      sync_status: {
        Row: SyncStatusRecord;
        Insert: Omit<SyncStatusRecord, 'id'>;
        Update: Partial<Omit<SyncStatusRecord, 'id'>>;
      };
      emails: {
        Row: Email;
        Insert: Omit<Email, 'id' | 'created_at'>;
        Update: Partial<Omit<Email, 'id' | 'created_at'>>;
      };
      calendar_events: {
        Row: CalendarEvent;
        Insert: Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>>;
      };
      drive_documents: {
        Row: DriveDocument;
        Insert: Omit<DriveDocument, 'id' | 'created_at'>;
        Update: Partial<Omit<DriveDocument, 'id' | 'created_at'>>;
      };
      briefings: {
        Row: Briefing;
        Insert: Omit<Briefing, 'id' | 'generated_at'>;
        Update: Partial<Omit<Briefing, 'id' | 'generated_at'>>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
