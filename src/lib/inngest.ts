import { Inngest } from 'inngest';

/**
 * Inngest client for EmergentOS
 * Used to define and trigger workflow functions
 */
export const inngest = new Inngest({
  id: 'emergent-os',
  name: 'EmergentOS',
});

/**
 * Event types for type-safe event handling
 */
export type Events = {
  'gmail/connection.established': {
    data: {
      userId: string;
      providerConfigKey: string;
    };
  };
};

