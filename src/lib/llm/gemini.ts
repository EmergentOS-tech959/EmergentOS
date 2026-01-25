/**
 * EmergentOS - Gemini LLM Client
 * 
 * LLM call configuration per Section 9.6.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLM_MODEL, LLM_MAX_RETRIES, LLM_RETRY_DELAYS_MS } from '../constants';

// Initialize Gemini client
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// Config for ANALYSIS/BRIEFING (requires structured JSON output)
const GEMINI_JSON_CONFIG = {
  generationConfig: {
    temperature: 0,           // Deterministic output
    topP: 1,
    topK: 1,
    maxOutputTokens: 4096,
    responseMimeType: 'application/json',  // Enforce JSON output
  },
};

// Config for CHAT (natural language, streaming)
const GEMINI_CHAT_CONFIG = {
  generationConfig: {
    temperature: 0.7,         // Slightly creative for conversation
    topP: 0.9,
    maxOutputTokens: 2048,
    // NO responseMimeType - plain text response
  },
};

/**
 * Call Gemini for structured JSON responses (briefing, analysis)
 */
export async function callGeminiJSON(prompt: string): Promise<string> {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const model = genAI.getGenerativeModel({ model: LLM_MODEL });

  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...GEMINI_JSON_CONFIG,
      });

      return result.response.text();
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (status === 429 && attempt < LLM_MAX_RETRIES - 1) {
        console.warn(`[Gemini] Rate limited, retrying in ${LLM_RETRY_DELAYS_MS[attempt]}ms`);
        await new Promise((r) => setTimeout(r, LLM_RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded for Gemini API');
}

/**
 * Call Gemini for chat (natural language, supports streaming via SSE)
 * Returns a ReadableStream for Server-Sent Events response
 * NOTE: Does NOT send [DONE] signal - caller is responsible for appending that
 */
export async function callGeminiChat(
  systemPrompt: string,
  userMessage: string
): Promise<ReadableStream<Uint8Array>> {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const model = genAI.getGenerativeModel({ model: LLM_MODEL });

  const result = await model.generateContentStream({
    contents: [
      { role: 'user', parts: [{ text: systemPrompt + '\n\nUser: ' + userMessage }] },
    ],
    ...GEMINI_CHAT_CONFIG,
  });

  // Convert Gemini stream to SSE-compatible ReadableStream
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            // SSE format: data: {text}\n\n
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
          }
        }
        // NOTE: Caller must send [DONE] signal after appending any additional data (e.g., sources)
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Call Gemini for plain text responses (recap, summaries)
 */
export async function callGeminiText(prompt: string): Promise<string> {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const model = genAI.getGenerativeModel({ model: LLM_MODEL });

  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...GEMINI_CHAT_CONFIG, // Uses plain text config, no JSON
      });

      return result.response.text();
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (status === 429 && attempt < LLM_MAX_RETRIES - 1) {
        console.warn(`[Gemini] Rate limited, retrying in ${LLM_RETRY_DELAYS_MS[attempt]}ms`);
        await new Promise((r) => setTimeout(r, LLM_RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded for Gemini API');
}

/**
 * Check if Gemini is configured
 */
export function isGeminiConfigured(): boolean {
  return genAI !== null;
}
