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

const DEFAULT_MODEL = 'qwen/qwen3-235b-a22b-2507';
const SPEC_FIELDS = [
  'cpu',
  'cpu_variant',
  'gpu',
  'vram_gb',
  'ram_gb',
  'ram_type',
  'storage',
  'motherboard',
  'os',
  'condition',
];

function getConfiguredApiKeys(env = process.env) {
  const keys = [];
  const addKeys = value => String(value || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
    .forEach(k => keys.push(k));

  addKeys(env.OPENROUTER_API_KEYS);
  addKeys(env.OPENROUTER_API_KEY);

  Object.keys(env)
    .filter(name => /^OPENROUTER_API_KEY_\d+$/.test(name))
    .sort((a, b) => parseInt(a.match(/\d+$/)[0], 10) - parseInt(b.match(/\d+$/)[0], 10))
    .forEach(name => addKeys(env[name]));

  return [...new Set(keys)];
}

function buildChatRequestBody(model, description) {
  return {
    model,
    messages: [{ role: 'user', content: PROMPT + description }],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  };
}

function findJsonObjectEnd(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function assertStringOrNull(specs, field) {
  if (specs[field] !== null && typeof specs[field] !== 'string') {
    throw taggedError(MODEL_ERROR, `${field} must be string or null`);
  }
}

function assertNumberOrNull(specs, field) {
  if (specs[field] !== null && typeof specs[field] !== 'number') {
    throw taggedError(MODEL_ERROR, `${field} must be number or null`);
  }
}

function validateSpecs(specs) {
  if (!specs || typeof specs !== 'object' || Array.isArray(specs)) {
    throw taggedError(MODEL_ERROR, 'Model JSON must be an object');
  }

  for (const field of SPEC_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(specs, field)) {
      throw taggedError(MODEL_ERROR, `missing field: ${field}`);
    }
  }
  for (const field of Object.keys(specs)) {
    if (!SPEC_FIELDS.includes(field)) {
      throw taggedError(MODEL_ERROR, `unexpected field: ${field}`);
    }
  }

  ['cpu', 'cpu_variant', 'gpu', 'storage', 'motherboard', 'os'].forEach(field => assertStringOrNull(specs, field));
  ['vram_gb', 'ram_gb'].forEach(field => assertNumberOrNull(specs, field));

  if (![null, 'DDR4', 'DDR5'].includes(specs.ram_type)) {
    throw taggedError(MODEL_ERROR, 'ram_type must be DDR4, DDR5, or null');
  }
  if (![null, 'new', 'used'].includes(specs.condition)) {
    throw taggedError(MODEL_ERROR, 'condition must be new, used, or null');
  }

  return specs;
}

function parseModelSpecs(content) {
  const text = String(content || '').trim();
  if (!text.startsWith('{')) throw taggedError(MODEL_ERROR, 'Model response must be a single JSON object');

  const end = findJsonObjectEnd(text);
  if (end === -1) throw taggedError(MODEL_ERROR, 'Model returned malformed JSON');
  if (text.slice(end + 1).trim()) throw taggedError(MODEL_ERROR, 'Model response must be a single JSON object');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw taggedError(MODEL_ERROR, 'Model returned malformed JSON');
  }

  return validateSpecs(parsed);
}

// --- Key state ---
const rawKeys = getConfiguredApiKeys(process.env);

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
      body: JSON.stringify(buildChatRequestBody(model, description)),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw taggedError(API_ERROR, 'Request timeout (30s)');
    throw taggedError(API_ERROR, `Network error: ${err.message}`);
  }
  clearTimeout(timer);

  // Key/account exhaustion — may be plain-text or JSON
  if (res.status === 429) {
    const body = await res.text().catch(() => '');
    throw taggedError(RATE_LIMIT, body || 'HTTP 429 rate limit');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 402 && isRateLimitMessage(body)) {
      throw taggedError(RATE_LIMIT, body || 'HTTP 402 account limit');
    }
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
  return parseModelSpecs(content);
}

// --- Public ---
async function extractSpecs(description) {
  if (keyStates.length === 0) throw taggedError(API_ERROR, 'OPENROUTER_API_KEY(S) not configured');

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  while (true) {
    const keyState = getAvailableKey();
    if (!keyState) throw taggedError(API_ERROR, 'All API keys have reached their daily limit');

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

module.exports = {
  extractSpecs,
  getKeyStatuses,
  getKeyCount,
  getEarliestKeyReset,
  DEFAULT_MODEL,
  buildChatRequestBody,
  getConfiguredApiKeys,
  parseModelSpecs,
};
