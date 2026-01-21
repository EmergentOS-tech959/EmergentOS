-- ============================================================================
-- Migration: Add unique constraint on emails table for upsert support
-- Date: 2026-01-20
-- Purpose: Enable upsert operations with ON CONFLICT (user_id, message_id)
-- ============================================================================

-- Add unique constraint on (user_id, message_id) for email upserts
-- This allows the Inngest function to upsert emails without duplicates
DO $$
BEGIN
  -- Check if constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'emails_user_id_message_id_key'
  ) THEN
    ALTER TABLE emails 
      ADD CONSTRAINT emails_user_id_message_id_key 
      UNIQUE (user_id, message_id);
    RAISE NOTICE 'Added unique constraint emails_user_id_message_id_key';
  ELSE
    RAISE NOTICE 'Constraint emails_user_id_message_id_key already exists';
  END IF;
END $$;

-- Also ensure calendar_events has unique constraint for upserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'calendar_events_user_id_event_id_key'
  ) THEN
    ALTER TABLE calendar_events 
      ADD CONSTRAINT calendar_events_user_id_event_id_key 
      UNIQUE (user_id, event_id);
    RAISE NOTICE 'Added unique constraint calendar_events_user_id_event_id_key';
  ELSE
    RAISE NOTICE 'Constraint calendar_events_user_id_event_id_key already exists';
  END IF;
END $$;

-- Also ensure drive_documents has unique constraint for upserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'drive_documents_user_id_document_id_key'
  ) THEN
    ALTER TABLE drive_documents 
      ADD CONSTRAINT drive_documents_user_id_document_id_key 
      UNIQUE (user_id, document_id);
    RAISE NOTICE 'Added unique constraint drive_documents_user_id_document_id_key';
  ELSE
    RAISE NOTICE 'Constraint drive_documents_user_id_document_id_key already exists';
  END IF;
END $$;
