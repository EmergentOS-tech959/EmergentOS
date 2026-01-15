type NightfallDetector =
  | 'PERSON_NAME'
  | 'EMAIL_ADDRESS'
  | 'PHONE_NUMBER'
  | 'CREDIT_CARD_NUMBER';

type NightfallFinding = {
  finding?: string;
  detector?: { nightfallDetector?: NightfallDetector } | { name?: string };
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

function normalizeFindings(input: unknown): NightfallFinding[] {
  // Nightfall responses may return either:
  // - { findings: NightfallFinding[] }
  // - { findings: [{ findings: NightfallFinding[] }, ...] }  (per-payload results)
  if (!input || typeof input !== 'object') return [];
  const obj = input as { findings?: unknown };
  if (!Array.isArray(obj.findings)) return [];

  const out: NightfallFinding[] = [];
  for (const item of obj.findings) {
    if (item && typeof item === 'object' && 'findings' in (item as Record<string, unknown>)) {
      const nested = (item as { findings?: unknown }).findings;
      if (Array.isArray(nested)) {
        out.push(...(nested as NightfallFinding[]));
        continue;
      }
    }
    out.push(item as NightfallFinding);
  }
  return out;
}

export async function scanContent(content: string): Promise<{
  redacted: string;
  tokenToValue: Record<string, { original: string; entityType: string }>;
  findings: NightfallFinding[];
}> {
  const { apiKey, scanUrl } = getNightfallConfig();

  // Nightfall Scan API (v3) expects a "policy" and a "payload" array.
  // We scan a single text string at a time and generate our own stable tokens from findings.
  const body = {
    policy: {
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
    },
    payload: [content],
  };

  const res = await fetch(scanUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Nightfall scan failed (${res.status}): ${text}`);
  }

  const json = (await res.json().catch(() => ({}))) as unknown;
  const findings = normalizeFindings(json);

  // Convert findings into stable tokens and replace in content.
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
}

