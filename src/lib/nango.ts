/**
 * EmergentOS - Nango Client
 * 
 * Server-side Nango client for OAuth token management and API proxying.
 */

import { Nango } from '@nangohq/node';

// Validate required environment variable
const nangoSecretKey = process.env.NANGO_SECRET_KEY;

if (!nangoSecretKey) {
  throw new Error('Missing NANGO_SECRET_KEY environment variable');
}

/**
 * Server-side Nango client instance
 */
export const nango = new Nango({ secretKey: nangoSecretKey });

/**
 * Provider config key mapping
 * Maps our internal provider names to Nango integration IDs
 */
export const PROVIDER_CONFIG_KEYS = {
  gmail: 'google-mail',
  calendar: 'google-calendar',
  drive: 'google-drive',
} as const;

/**
 * Reverse mapping from Nango config key to provider name
 */
export const PROVIDER_FROM_CONFIG_KEY = {
  'google-mail': 'gmail',
  'google-calendar': 'calendar',
  'google-drive': 'drive',
} as const;

export type ProviderKey = keyof typeof PROVIDER_CONFIG_KEYS;
export type ConfigKey = keyof typeof PROVIDER_FROM_CONFIG_KEY;

/**
 * Get the Nango config key for a provider
 */
export function getConfigKey(provider: ProviderKey): string {
  return PROVIDER_CONFIG_KEYS[provider];
}

/**
 * Get the provider name from a Nango config key
 */
export function getProviderFromConfigKey(configKey: string): ProviderKey | null {
  return (PROVIDER_FROM_CONFIG_KEY as Record<string, ProviderKey>)[configKey] || null;
}

export default nango;
