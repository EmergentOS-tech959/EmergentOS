type NightfallDetector =
  | 'PERSON_NAME'
  | 'EMAIL_ADDRESS'
  | 'PHONE_NUMBER'
  | 'CREDIT_CARD_NUMBER';

type NightfallFinding = {
  finding?: string;
  detector?: { nightfallDetector?: NightfallDetector } | { name?: string };
};

// Per-payload findings structure from Nightfall batch API
type NightfallPayloadFindings = {
  findings?: NightfallFinding[];
};

function getNightfallConfig() {
  const apiKey = process.env.NIGHTFALL_API_KEY;
  if (!apiKey) throw new Error('Missing NIGHTFALL_API_KEY');

  // Nightfall endpoint varies by account/region; allow override.
  const scanUrl = process.env.NIGHTFALL_SCAN_URL || 'https://api.nightfall.ai/v3/scan';
  return { apiKey, scanUrl };
}

function detectorToTokenPrefix(detector: string): string {
  const d = detector.toUpperCase();
  if (d.includes('PERSON')) return 'PERSON';
  if (d.includes('EMAIL')) return 'EMAIL';
  if (d.includes('PHONE')) return 'PHONE';
  if (d.includes('CREDIT')) return 'CREDIT_CARD';
  return 'SENSITIVE';
}

function getDetectorString(detector: NightfallFinding['detector']): string {
  if (!detector) return 'SENSITIVE';
  if ('nightfallDetector' in detector && detector.nightfallDetector) return detector.nightfallDetector;
  if ('name' in detector && detector.name) return detector.name;
  return 'SENSITIVE';
}

// ============================================================================
// RETRY HELPER - Handle rate limits with exponential backoff
// ============================================================================

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    
    if (res.ok) {
      return res;
    }
    
    // Handle rate limiting (429)
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const waitMs = retryAfter 
        ? parseInt(retryAfter, 10) * 1000 
        : Math.min(1000 * Math.pow(2, attempt), 30000); // Exponential backoff, max 30s
      
      console.log(`[Nightfall] Rate limited (429). Retry ${attempt + 1}/${maxRetries} after ${waitMs}ms`);
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
    }
    
    // For non-retryable errors, throw immediately
    const text = await res.text().catch(() => '');
    lastError = new Error(`Nightfall scan failed (${res.status}): ${text}`);
    
    if (res.status !== 429) {
      throw lastError;
    }
  }
  
  throw lastError || new Error('Nightfall scan failed after retries');
}

// ============================================================================
// SINGLE CONTENT SCAN (Original API - for backward compatibility)
// ============================================================================

export async function scanContent(content: string): Promise<{
  redacted: string;
  tokenToValue: Record<string, { original: string; entityType: string }>;
  findings: NightfallFinding[];
}> {
  const results = await scanContentBatch([content]);
  return results[0];
}

// ============================================================================
// BATCH CONTENT SCAN - Process multiple strings in one API call
// ============================================================================

const NIGHTFALL_POLICY = {
  detectionRules: [
    {
      name: 'EmergentOS Default DLP (Inline)',
      logicalOp: 'ANY',
      detectors: [
        {
          detectorType: 'NIGHTFALL_DETECTOR',
          nightfallDetector: 'PERSON_NAME',
          minConfidence: 'LIKELY',
          minNumFindings: 1,
        },
        {
          detectorType: 'NIGHTFALL_DETECTOR',
          nightfallDetector: 'EMAIL_ADDRESS',
          minConfidence: 'LIKELY',
          minNumFindings: 1,
        },
        {
          detectorType: 'NIGHTFALL_DETECTOR',
          nightfallDetector: 'PHONE_NUMBER',
          minConfidence: 'LIKELY',
          minNumFindings: 1,
        },
        {
          detectorType: 'NIGHTFALL_DETECTOR',
          nightfallDetector: 'CREDIT_CARD_NUMBER',
          minConfidence: 'LIKELY',
          minNumFindings: 1,
        },
      ],
    },
  ],
};

/**
 * Scan multiple content strings in a single Nightfall API call.
 * Much more efficient than calling scanContent() for each string.
 * 
 * @param contents - Array of strings to scan
 * @returns Array of scan results (same order as input)
 */
export async function scanContentBatch(contents: string[]): Promise<Array<{
  redacted: string;
  tokenToValue: Record<string, { original: string; entityType: string }>;
  findings: NightfallFinding[];
}>> {
  if (contents.length === 0) {
    return [];
  }

  const { apiKey, scanUrl } = getNightfallConfig();

  // Nightfall Scan API (v3) supports batching - payload can be an array of strings
  const body = {
    policy: NIGHTFALL_POLICY,
    payload: contents,
  };

  const res = await fetchWithRetry(scanUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as { findings?: NightfallPayloadFindings[] };
  
  // Nightfall returns { findings: [{ findings: [...] }, { findings: [...] }, ...] }
  // One entry per payload string
  const allPayloadFindings = json.findings || [];

  // Process each content string with its corresponding findings
  return contents.map((content, index) => {
    const payloadFindings = allPayloadFindings[index];
    const findings: NightfallFinding[] = payloadFindings?.findings || [];

    // Convert findings into stable tokens and replace in content
    const counters: Record<string, number> = {};
    const tokenToValue: Record<string, { original: string; entityType: string }> = {};
    let redacted = content;

    for (const f of findings) {
      const original = f.finding;
      if (!original) continue;

      const detector = getDetectorString(f.detector);
      const prefix = detectorToTokenPrefix(String(detector));
      counters[prefix] = (counters[prefix] || 0) + 1;
      const token = `[${prefix}_${String(counters[prefix]).padStart(3, '0')}]`;

      tokenToValue[token] = { original, entityType: prefix.toLowerCase() };
      redacted = redacted.split(original).join(token);
    }

    return { redacted, tokenToValue, findings };
  });
}

// ============================================================================
// CHUNKED BATCH SCAN - For very large batches, process in chunks
// ============================================================================

/**
 * Scan a large number of content strings by batching into smaller chunks.
 * Prevents hitting Nightfall's payload size limits.
 * 
 * @param contents - Array of strings to scan
 * @param chunkSize - Number of strings per API call (default: 20)
 * @returns Array of scan results (same order as input)
 */
export async function scanContentChunked(
  contents: string[],
  chunkSize: number = 20
): Promise<Array<{
  redacted: string;
  tokenToValue: Record<string, { original: string; entityType: string }>;
  findings: NightfallFinding[];
}>> {
  if (contents.length === 0) {
    return [];
  }

  const results: Array<{
    redacted: string;
    tokenToValue: Record<string, { original: string; entityType: string }>;
    findings: NightfallFinding[];
  }> = [];

  // Process in chunks to avoid overwhelming Nightfall
  for (let i = 0; i < contents.length; i += chunkSize) {
    const chunk = contents.slice(i, i + chunkSize);
    console.log(`[Nightfall] Scanning chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(contents.length / chunkSize)} (${chunk.length} items)`);
    
    const chunkResults = await scanContentBatch(chunk);
    results.push(...chunkResults);
    
    // Small delay between chunks to be gentle on rate limits
    if (i + chunkSize < contents.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}

