// EmergentOS Phase 0 - TypeScript Type Definitions

/**
 * Sync status states for the email ingestion pipeline
 */
export type SyncStatus = 'disconnected' | 'fetching' | 'securing' | 'complete';

/**
 * Email metadata stored in Supabase
 */
export interface Email {
  id: string;
  user_id: string;
  message_id: string;
  sender: string;
  subject: string;
  received_at: string;
  security_verified: boolean;
  created_at: string;
}

/**
 * User sync status record from Supabase
 */
export interface SyncStatusRecord {
  id: string;
  user_id: string;
  status: SyncStatus;
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
 * Nango webhook payload for auth events
 */
export interface NangoAuthWebhookPayload {
  type: 'auth';
  connectionId: string;
  providerConfigKey: string;
  provider: string;
}

/**
 * Inngest event data for Gmail connection
 */
export interface GmailConnectionEventData {
  userId: string;
  providerConfigKey: string;
}

/**
 * Database types for Supabase
 */
export interface Database {
  public: {
    Tables: {
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
    };
  };
}

