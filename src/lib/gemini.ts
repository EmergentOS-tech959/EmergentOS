import { GoogleGenerativeAI } from '@google/generative-ai';

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
  const model = process.env.GEMINI_MODEL || '';
  return { apiKey, model };
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  // ```json ... ```
  const fenced = trimmed.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}

export function safeJsonParse<T>(text: string): T | null {
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function isModelNotFoundOrUnsupported(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('404') ||
    m.includes('not found') ||
    m.includes('is not found for api version') ||
    m.includes('not supported for generatecontent') ||
    m.includes('call listmodels') ||
    m.includes('listmodels')
  );
}

function uniqueNonEmpty(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const v = raw.trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export async function geminiGenerateText(prompt: string): Promise<string> {
  const { apiKey, model } = getGeminiConfig();
  const client = new GoogleGenerativeAI(apiKey);

  // Fallback order: env override first, then common stable model IDs.
  // Some projects/keys do not have access to certain models; we retry on 404/unsupported.
  const modelsToTry = uniqueNonEmpty([
    model,
    'gemini-2.0-flash',
    'gemini-2.0-pro',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-1.0-pro',
  ]);

  let lastError: unknown = null;
  for (const candidate of modelsToTry) {
    try {
      const m = client.getGenerativeModel({ model: candidate });
      const res = await m.generateContent(prompt);
      return res.response.text();
    } catch (err) {
      lastError = err;
      const message =
        err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      if (isModelNotFoundOrUnsupported(message)) {
        // Try next candidate
        continue;
      }
      // Non-model-related error: surface immediately (auth, quota, network, etc.)
      throw err;
    }
  }

  const lastMsg =
    lastError instanceof Error ? lastError.message : typeof lastError === 'string' ? lastError : 'Unknown error';
  throw new Error(
    `Gemini generateContent failed for all models tried: ${modelsToTry.join(
      ', '
    )}. Last error: ${lastMsg}. Set GEMINI_MODEL to a supported model for your API key.`
  );
}

