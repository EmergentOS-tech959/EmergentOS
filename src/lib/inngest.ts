/**
 * EmergentOS - Inngest Client
 * 
 * Event-driven background job orchestration.
 */

import { Inngest } from 'inngest';

/**
 * Inngest client instance
 * Used for sending events and defining functions
 */
export const inngest = new Inngest({
  id: 'emergent-os',
  name: 'EmergentOS',
});

/**
 * Event types for type-safe event handling
 */
export type SyncRequestedEvent = {
  name: 'gmail/sync.requested' | 'calendar/sync.requested' | 'drive/sync.requested';
  data: {
    userId: string;
    connectionId: string;
    trigger: 'connect' | 'manual' | 'auto' | 'date_boundary';
    idempotencyKey: string;
    jobId: string;
  };
};

export type Events = {
  'gmail/sync.requested': SyncRequestedEvent['data'];
  'calendar/sync.requested': SyncRequestedEvent['data'];
  'drive/sync.requested': SyncRequestedEvent['data'];
};

export default inngest;
