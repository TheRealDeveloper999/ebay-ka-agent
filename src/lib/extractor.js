'use strict';

const PROMPT = `Extract PC specs from the listing below. Reply with JSON only, no explanation. Use null for unknown fields.

Fields:
- cpu: product line only, no brand ("i7", "Ryzen 5", "Xeon")
- cpu_variant: model number with suffix ("12700K", "5600X", "3900X") or null
- gpu: model without brand, keep suffixes Ti/Super/XT/XTX ("RTX 3070 Ti", "RX 6700 XT")
- vram_gb: number only, not in gpu string
- ram_gb: number only
- ram_type: "DDR4" or "DDR5" only
- storage: comma-separated, each entry as "SSD Xgb" or "HDD Xgb" or "SSD XTB" or "HDD XTB"
- motherboard: model only, no brand
- os: short ("Windows 11", "Linux") or null
- condition: "new" or "used" or null

Examples:
"Intel Core i7-12700K" → cpu:"i7" cpu_variant:"12700K"
"AMD Ryzen 5 5600X" → cpu:"Ryzen 5" cpu_variant:"5600X"
"NVIDIA GeForce RTX 3070 Ti 8GB" → gpu:"RTX 3070 Ti" vram_gb:8
"Samsung 970 Evo 500GB + Seagate 2TB HDD" → storage:"SSD 500gb, HDD 2tb"

Listing:
`;

// Error codes for routing in extract-queue
const RATE_LIMIT = 'RATE_LIMIT'; // key rotation handles this
const API_ERROR  = 'API_ERROR';  // counts toward circuit breaker
const MODEL_ERROR = 'MODEL_ERROR'; // bad model output, counts toward item retries only

function taggedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isRateLimitMessage(message) {
  return /rate.?limit|per.?day|per.?min|quota|credits/i.test(message);
}

// --- Key state ---
const rawKeys = (process.env.OPENROUTER_API_KEYS || process.env.OPENROUTER_API_KEY || '')
  .split(',').map(k => k.trim()).filter(Boolean);

const keyStates = rawKeys.map(key => ({ key, exhaustedUntil: null }));

if (keyStates.length > 0) {
  console.log(`[extractor] ${keyStates.length} API key(s) loaded`);
} else {
  console.warn('[extractor] no API keys configured');
}

function getAvailableKey() {
  const now = Date.now();
  return keyStates.find(s => !s.exhaustedUntil || s.exhaustedUntil <= now) || null;
}

function markKeyExhausted(key) {
  const state = keyStates.find(s => s.key === key);
  if (!state) return;
  // Align to next UTC midnight so keys reset when OpenRouter resets them
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 5, 0, 0); // 00:05 UTC — small buffer after midnight
  state.exhaustedUntil = tomorrow.getTime();
  console.warn(`[extractor] key …${key.slice(-8)} rate-limited — paused until ${tomorrow.toISOString()}`);
}

function getKeyStatuses() {
  const now = Date.now();
  return keyStates.map((s, i) => ({
    index: i + 1,
    suffix: `…${s.key.slice(-8)}`,
    available: !s.exhaustedUntil || s.exhaustedUntil <= now,
    exhaustedUntil: s.exhaustedUntil && s.exhaustedUntil > now ? new Date(s.exhaustedUntil).toISOString() : null,
  }));
}

function getKeyCount() {
  return keyStates.length;
}

function getEarliestKeyReset() {
  const now = Date.now();
  const exhausted = keyStates.filter(s => s.exhaustedUntil && s.exhaustedUntil > now);
  if (exhausted.length === 0 || exhausted.length < keyStates.length) return null;
  return Math.min(...exhausted.map(s => s.exhaustedUntil));
}

// --- API call ---
const FETCH_TIMEOUT_MS = 30_000;

async function callApi(apiKey, model, description) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: PROMPT + description }],
        temperature: 0.1,
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw taggedError(API_ERROR, 'Request timeout (30s)');
    throw taggedError(API_ERROR, `Network error: ${err.message}`);
  }
  clearTimeout(timer);

  // Rate limit — may be plain-text or JSON
  if (res.status === 429) {
    const body = await res.text().catch(() => '');
    throw taggedError(RATE_LIMIT, body || 'HTTP 429 rate limit');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw taggedError(API_ERROR, `HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw taggedError(API_ERROR, 'Non-JSON response from API');
  }

  // API-level error object in 200 response (OpenRouter style)
  if (data.error) {
    const msg = data.error.message || 'OpenRouter error';
    if (isRateLimitMessage(msg)) throw taggedError(RATE_LIMIT, msg);
    throw taggedError(API_ERROR, msg);
  }

  const content = data.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw taggedError(MODEL_ERROR, 'No JSON object found in model response');

  try {
    return JSON.parse(match[0]);
  } catch {
    throw taggedError(MODEL_ERROR, 'Model returned malformed JSON');
  }
}

// --- Public ---
async function extractSpecs(description) {
  if (keyStates.length === 0) throw taggedError(API_ERROR, 'OPENROUTER_API_KEY(S) nicht konfiguriert');

  const model = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-nano-9b-v2:free';

  while (true) {
    const keyState = getAvailableKey();
    if (!keyState) throw taggedError(API_ERROR, 'Alle API-Keys haben das Tageslimit erreicht');

    try {
      return await callApi(keyState.key, model, description);
    } catch (err) {
      if (err.code === RATE_LIMIT) {
        markKeyExhausted(keyState.key);
        continue; // try next available key
      }
      throw err;
    }
  }
}

module.exports = { extractSpecs, getKeyStatuses, getKeyCount, getEarliestKeyReset };
