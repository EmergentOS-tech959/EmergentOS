/**
 * EmergentOS - Gemini LLM Client
 * 
 * LLM call configuration per Section 9.6.
 * Enhanced with structured output schema support for reliable JSON extraction.
 */

import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai';
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

// ============================================================================
// Calendar Analysis Schema (Structured Output)
// ============================================================================

/**
 * JSON Schema for Calendar Analysis output
 * Ensures Gemini returns structured, validated JSON
 */
export const CALENDAR_ANALYSIS_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    executiveSummary: {
      type: SchemaType.STRING,
      description: 'One paragraph overview - MUST prominently mention any scheduling conflicts first, then connect calendar health to user strategic focus',
    },
    healthScore: {
      type: SchemaType.INTEGER,
      description: 'Overall calendar health score from 0-100',
    },
    verdict: {
      type: SchemaType.STRING,
      description: 'Overall verdict',
      enum: ['OPTIMAL', 'GOOD', 'CONCERNING', 'CRITICAL'],
    },
    urgentActions: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          priority: { type: SchemaType.INTEGER, description: 'Priority ranking (1 = highest)' },
          action: { type: SchemaType.STRING, description: 'Specific action to take' },
          reason: { type: SchemaType.STRING, description: 'Why this matters' },
          timeframe: { type: SchemaType.STRING, description: 'When to do it' },
          relatedEvents: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Event titles this action relates to',
          },
        },
        required: ['priority', 'action', 'reason', 'timeframe'],
      },
    },
    conflictResolutions: {
      type: SchemaType.ARRAY,
      description: 'REQUIRED for each detected conflict - resolution recommendations',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          conflictingEvents: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: 'Exact titles of the conflicting events',
          },
          overlapMinutes: { 
            type: SchemaType.INTEGER,
            description: 'Number of minutes these events overlap',
          },
          recommendation: { 
            type: SchemaType.STRING,
            description: 'Specific resolution: which to keep, which to move, and suggested new time',
          },
          suggestedAction: {
            type: SchemaType.STRING,
            enum: ['RESCHEDULE', 'DELEGATE', 'DECLINE', 'SHORTEN'],
          },
          keepEvent: {
            type: SchemaType.STRING,
            description: 'Title of the event to prioritize keeping',
          },
          moveEvent: {
            type: SchemaType.STRING,
            description: 'Title of the event to reschedule/delegate/decline',
          },
          priority: {
            type: SchemaType.STRING,
            enum: ['HIGH', 'MEDIUM', 'LOW'],
            description: 'Priority level for resolving this conflict',
          },
        },
        required: ['conflictingEvents', 'recommendation', 'suggestedAction', 'overlapMinutes', 'keepEvent', 'moveEvent'],
      },
    },
    delegationOpportunities: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          meeting: { type: SchemaType.STRING },
          reason: { type: SchemaType.STRING },
          suggestedDelegate: { type: SchemaType.STRING },
        },
        required: ['meeting', 'reason', 'suggestedDelegate'],
      },
    },
    focusTimeProtection: {
      type: SchemaType.OBJECT,
      properties: {
        availableHours: { type: SchemaType.NUMBER },
        recommendation: { type: SchemaType.STRING },
        suggestedBlocks: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
        riskAreas: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
      },
      required: ['availableHours', 'recommendation'],
    },
    weeklyInsights: {
      type: SchemaType.OBJECT,
      properties: {
        meetingLoad: {
          type: SchemaType.STRING,
          enum: ['LIGHT', 'MODERATE', 'HEAVY', 'OVERLOADED'],
        },
        balanceScore: { type: SchemaType.INTEGER },
        topConcern: { type: SchemaType.STRING },
        positivePatterns: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
        alignmentScore: { type: SchemaType.INTEGER },
      },
      required: ['meetingLoad', 'balanceScore', 'topConcern'],
    },
    personalizedInsights: {
      type: SchemaType.ARRAY,
      nullable: true,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          category: {
            type: SchemaType.STRING,
            enum: ['GOAL_ALIGNMENT', 'BLOCKER_RISK', 'FLOW_PROTECTION', 'DECISION_SUPPORT'],
          },
          insight: { type: SchemaType.STRING },
          recommendation: { type: SchemaType.STRING },
        },
        required: ['category', 'insight', 'recommendation'],
      },
    },
    metrics: {
      type: SchemaType.OBJECT,
      properties: {
        meetingHoursTotal: { type: SchemaType.NUMBER },
        focusHoursAvailable: { type: SchemaType.NUMBER },
        conflictCount: { type: SchemaType.INTEGER },
        backToBackCount: { type: SchemaType.INTEGER },
        averageMeetingLength: { type: SchemaType.NUMBER },
        busiestDay: { type: SchemaType.STRING },
        lightestDay: { type: SchemaType.STRING },
      },
      required: ['meetingHoursTotal', 'focusHoursAvailable', 'conflictCount', 'backToBackCount'],
    },
  },
  required: [
    'executiveSummary',
    'healthScore',
    'verdict',
    'urgentActions',
    'conflictResolutions',
    'focusTimeProtection',
    'weeklyInsights',
    'metrics',
  ],
};

// ============================================================================
// Daily Briefing Schema (Structured Output)
// ============================================================================

/**
 * JSON Schema for Daily Briefing output
 * Ensures Gemini returns structured, validated JSON for briefings
 */
export const BRIEFING_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    executiveSummary: {
      type: SchemaType.STRING,
      description: '2-3 sentence overview - MUST mention conflicts if any, connect to strategic priorities',
    },
    briefingScore: {
      type: SchemaType.INTEGER,
      description: 'Day readiness score from 0-100',
    },
    briefingVerdict: {
      type: SchemaType.STRING,
      enum: ['CLEAR', 'MANAGEABLE', 'BUSY', 'OVERLOADED'],
    },
    topPriority: {
      type: SchemaType.OBJECT,
      properties: {
        item: { type: SchemaType.STRING, description: 'The single most important thing' },
        reason: { type: SchemaType.STRING, description: 'Why this is #1' },
        suggestedAction: { type: SchemaType.STRING, description: 'Specific next step' },
        alignsWithGoal: { type: SchemaType.BOOLEAN, description: 'Whether this aligns with user stated goals' },
      },
      required: ['item', 'reason', 'suggestedAction'],
    },
    urgentAttention: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          type: { 
            type: SchemaType.STRING, 
            enum: ['EMAIL', 'MEETING', 'DOCUMENT', 'CONFLICT'],
          },
          item: { type: SchemaType.STRING, description: 'Description of urgent item' },
          action: { type: SchemaType.STRING, description: 'What to do' },
          deadline: { type: SchemaType.STRING, description: 'When, if applicable', nullable: true },
          priority: { type: SchemaType.INTEGER, description: 'Priority ranking (1 = highest)' },
        },
        required: ['type', 'item', 'action', 'priority'],
      },
    },
    scheduleInsight: {
      type: SchemaType.OBJECT,
      properties: {
        meetingCount: { type: SchemaType.INTEGER, description: 'Number of meetings today' },
        totalMeetingHours: { type: SchemaType.NUMBER, description: 'Total hours in meetings today' },
        conflictCount: { type: SchemaType.INTEGER, description: 'Number of scheduling conflicts' },
        nextMeeting: { type: SchemaType.STRING, nullable: true, description: 'Title of next meeting or null' },
        minutesUntilNext: { type: SchemaType.INTEGER, nullable: true, description: 'Minutes until next meeting or null' },
        freeBlocks: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: 'Time ranges with 30+ minutes free',
        },
        recommendation: { type: SchemaType.STRING, description: 'Brief schedule optimization advice' },
      },
      required: ['meetingCount', 'totalMeetingHours', 'conflictCount', 'recommendation', 'freeBlocks'],
    },
    actionItems: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          task: { type: SchemaType.STRING },
          source: { 
            type: SchemaType.STRING,
            enum: ['EMAIL', 'CALENDAR', 'DRIVE', 'ANALYSIS'],
          },
          priority: {
            type: SchemaType.STRING,
            enum: ['HIGH', 'MEDIUM', 'LOW'],
          },
          canDelegate: { type: SchemaType.BOOLEAN },
          delegateTo: { type: SchemaType.STRING, nullable: true },
          estimatedMinutes: { type: SchemaType.INTEGER, nullable: true },
        },
        required: ['task', 'source', 'priority'],
      },
    },
    intelligence: {
      type: SchemaType.OBJECT,
      properties: {
        emailHighlights: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: 'Key email summaries - max 3 most important',
        },
        documentActivity: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: 'Notable document changes - max 3',
        },
        patterns: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: 'Patterns noticed in communication or workload',
        },
      },
      required: ['emailHighlights', 'documentActivity', 'patterns'],
    },
    personalizedInsights: {
      type: SchemaType.ARRAY,
      nullable: true,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          category: {
            type: SchemaType.STRING,
            enum: ['GOAL_PROGRESS', 'BLOCKER_ALERT', 'ENERGY_TIP', 'DECISION_NEEDED'],
          },
          insight: { type: SchemaType.STRING },
          recommendation: { type: SchemaType.STRING },
        },
        required: ['category', 'insight', 'recommendation'],
      },
    },
    metrics: {
      type: SchemaType.OBJECT,
      properties: {
        emailsToProcess: { type: SchemaType.INTEGER },
        urgentEmailCount: { type: SchemaType.INTEGER },
        meetingsToday: { type: SchemaType.INTEGER },
        conflictsDetected: { type: SchemaType.INTEGER },
        documentsUpdated: { type: SchemaType.INTEGER },
      },
      required: ['emailsToProcess', 'meetingsToday', 'conflictsDetected'],
    },
    closingNote: {
      type: SchemaType.STRING,
      description: 'One sentence of strategic advice',
    },
  },
  required: [
    'executiveSummary',
    'briefingScore',
    'briefingVerdict',
    'topPriority',
    'urgentAttention',
    'scheduleInsight',
    'actionItems',
    'intelligence',
    'metrics',
    'closingNote',
  ],
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
 * Call Gemini with a structured output schema for guaranteed JSON format
 * Uses Gemini's native schema enforcement for reliable extraction
 */
export async function callGeminiWithSchema(
  prompt: string,
  schema: Schema
): Promise<string> {
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const model = genAI.getGenerativeModel({
    model: LLM_MODEL,
    generationConfig: {
      temperature: 0,
      topP: 1,
      topK: 1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });

  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      const responseText = result.response.text();
      
      // Validate JSON parsing
      JSON.parse(responseText);
      
      return responseText;
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (status === 429 && attempt < LLM_MAX_RETRIES - 1) {
        console.warn(`[Gemini] Rate limited, retrying in ${LLM_RETRY_DELAYS_MS[attempt]}ms`);
        await new Promise((r) => setTimeout(r, LLM_RETRY_DELAYS_MS[attempt]));
        continue;
      }
      
      // If JSON parsing failed, log and rethrow
      if (error instanceof SyntaxError) {
        console.error('[Gemini] Invalid JSON response despite schema enforcement');
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
