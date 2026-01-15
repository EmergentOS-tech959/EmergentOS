import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';

function getVaultKey(): Buffer {
  const keyB64 = process.env.PII_VAULT_KEY_BASE64;
  if (!keyB64) {
    throw new Error('Missing PII_VAULT_KEY_BASE64');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('PII_VAULT_KEY_BASE64 must decode to 32 bytes (AES-256 key)');
  }
  return key;
}

export function encryptForVault(plaintext: string): string {
  const key = getVaultKey();
  const iv = crypto.randomBytes(12); // AES-GCM 96-bit nonce
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv || tag || ciphertext)
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptFromVault(blobB64: string): string {
  const key = getVaultKey();
  const buf = Buffer.from(blobB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export async function upsertPiiVaultTokens(args: {
  userId: string;
  tokenToValue: Record<string, { original: string; entityType: string }>;
}) {
  const { userId, tokenToValue } = args;
  const entries = Object.entries(tokenToValue);
  if (entries.length === 0) return;

  const rows = entries.map(([token, v]) => ({
    user_id: userId,
    token,
    original_value: encryptForVault(v.original),
    entity_type: v.entityType,
  }));

  const supa = supabaseAdmin as unknown as SupabaseClient;
  const { error } = await supa.from('pii_vault').upsert(rows, { onConflict: 'user_id,token' });
  if (error) throw error;
}

