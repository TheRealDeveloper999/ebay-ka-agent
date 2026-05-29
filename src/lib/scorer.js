'use strict';

// Performance scores 0–100. Source: PassMark G3D Mark, normalized to RTX 4090 = 100.
// Formula: round(passmark / 38072 * 100). Values marked ~ are interpolated.
// Keys are prefix-free (rtx/gtx/rx stripped by normalizeGpu before lookup).
const GPU_SCORES = {
  // RTX 40 series
  '4090': 100,
  '4080 super': 90,
  '4080': 90,
  '4070 ti super': 84,
  '4070 ti': 83,
  '4070 super': 79,
  '4070': 71,
  '4060 ti': 59,
  '4060': 51,
  '4050': 35,              // ~

  // RTX 30 series
  '3090 ti': 77,
  '3090': 70,
  '3080 ti': 70,
  '3080 12gb': 70,
  '3080': 66,
  '3070 ti': 61,
  '3070': 58,
  '3060 ti': 53,
  '3060': 44,
  '3050': 33,

  // RTX 20 series
  '2080 ti': 56,
  '2080 super': 51,
  '2080': 49,
  '2070 super': 48,
  '2070': 42,
  '2060 super': 43,
  '2060': 37,

  // GTX 16 series
  '1660 ti': 33,
  '1660 super': 33,
  '1660': 30,
  '1650 super': 27,
  '1650': 21,

  // GTX 10 series
  '1080 ti': 49,
  '1080': 41,
  '1070 ti': 39,
  '1070': 36,
  '1060 6gb': 26,
  '1060': 26,
  '1050 ti': 17,
  '1050': 13,

  // GTX 9 series
  '980 ti': 36,
  '980': 29,
  '970': 25,
  '960': 16,
  '950': 14,

  // AMD RX 7000
  '7900 xtx': 83,
  '7900 xt': 76,
  '7900 gre': 68,          // ~
  '7800 xt': 64,
  '7700 xt': 60,
  '7600 xt': 50,           // ~
  '7600': 42,              // ~

  // AMD RX 6000
  '6950 xt': 74,           // ~
  '6900 xt': 70,
  '6800 xt': 66,
  '6800': 60,              // ~
  '6750 xt': 55,           // ~
  '6700 xt': 52,
  '6700': 46,              // ~
  '6650 xt': 44,           // ~
  '6600 xt': 43,
  '6600': 42,
  '6500 xt': 22,           // ~
  '6400': 17,              // ~

  // AMD RX 5000
  '5700 xt': 42,
  '5700': 37,              // ~
  '5600 xt': 35,
  '5500 xt': 25,           // ~
  '5500': 22,              // ~

  // AMD RX 500 / 400
  '590': 26,               // ~
  '580': 23,
  '570': 20,               // ~
  '480': 22,               // ~
  '470': 19,               // ~
  '460': 13,               // ~

  // AMD Vega  (no rx/gtx/rtx prefix — 'rx' is stripped, 'vega' remains)
  'vega 64': 37,
  'vega 56': 32,           // ~

  // AMD R9  (r9 prefix is NOT stripped — it's part of the model name)
  'r9 390x': 19,
  'r9 390': 18,
  'r9 290x': 17,
  'r9 290': 16,
  'r9 280x': 14,
  'r9 280': 12,
  'r9 270x': 11,
  'r 390': 18,             // AI sometimes writes "R 390" without the 9

  // Intel Arc  ('intel' and 'arc' are stripped → bare model like 'a770')
  'b580': 55,              // ~
  'a770': 52,              // ~
  'a750': 45,              // ~
  'a580': 29,              // ~
  'a380': 16,              // ~
};

function normalizeGpu(raw) {
  if (!raw) return null;
  let s = raw.toLowerCase();
  // Remove brand words (including 'arc' which is Intel's series name)
  s = s.replace(/\b(nvidia|geforce|amd|radeon|intel|arc)\b/g, '');
  // Remove memory sizes except model-identifying ones like "1060 6gb" or "3080 12gb"
  s = s.replace(/\b(\d{1,2})\s*gb?\b(?!\s*vram)/g, '');
  // Add space between digits and "ti"/"xt"/"super" if missing: "1050ti" → "1050 ti"
  s = s.replace(/(\d)(ti|xt|super)\b/gi, '$1 $2');
  // Add space after model-series prefix if directly before digits: "rx5700" → "rx 5700"
  s = s.replace(/\b(rx|gtx|rtx)(\d)/g, '$1 $2');
  // Strip model-series prefixes so keys can be bare numbers/names
  s = s.replace(/\b(rtx|gtx|rx)\b/g, '');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s || null;
}

function scoreGpu(raw) {
  const norm = normalizeGpu(raw);
  if (!norm) return null;

  // Find the longest key contained in the normalized string (most specific match wins)
  let bestKey = null;
  let bestScore = -1;
  for (const [key, score] of Object.entries(GPU_SCORES)) {
    if (norm.includes(key) && key.length > (bestKey ? bestKey.length : 0)) {
      bestKey = key;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? bestScore : null;
}

/**
 * Score a set of AI-extracted specs.
 * GPU is the dominant factor (0–100). RAM and CPU add small tie-breaking bonuses.
 * Returns null if no recognisable GPU is found.
 */
function scoreItem(specs) {
  if (!specs) return null;

  const gpuScore = scoreGpu(specs.gpu);
  if (gpuScore === null) return null;

  let bonus = 0;

  // RAM bonus (up to +8)
  const ram = specs.ram_gb || 0;
  if (ram >= 64) bonus += 8;
  else if (ram >= 32) bonus += 6;
  else if (ram >= 16) bonus += 3;
  else if (ram >= 8) bonus += 1;

  // CPU bonus (up to +5)
  const cpu = (specs.cpu || '').toLowerCase();
  if (/i9|ryzen 9|threadripper/.test(cpu)) bonus += 5;
  else if (/i7|ryzen 7/.test(cpu)) bonus += 3;
  else if (/i5|ryzen 5/.test(cpu)) bonus += 1;

  return Math.min(gpuScore + bonus, 110);
}

// ── Spec line formatting ──────────────────────────────────────────────────────

function shortCpu(raw) {
  if (!raw) return null;
  return raw
    .replace(/\bIntel\s+Core\s*/i, '')
    .replace(/\bIntel\s*/i, '')
    .replace(/\bAMD\s*/i, '')
    .replace(/\(.*?\)/g, '')           // remove "(6 Kerne / 12 Threads)" etc.
    .replace(/,.*$/, '')               // drop everything after first comma
    .replace(/\s+/g, ' ')
    .trim();
}

function shortGpu(raw) {
  if (!raw) return null;
  return raw
    .replace(/\b(NVIDIA|GeForce|AMD|Radeon|Intel)\b/gi, '')
    .replace(/\b\d{1,2}\s*gb?\b/gi, '')   // strip "8GB", "4g" memory sizes
    .replace(/\s+/g, ' ')
    .trim();
}

function shortStorage(raw) {
  if (!raw) return null;
  let s = raw
    .replace(/(\d+)\s*[Gg][Bb]/g, '$1 GB')
    .replace(/(\d+)\s*[Tt][Bb]/g, '$1 TB')
    // Remove brand names (and one following word token, e.g. "Samsung 970")
    .replace(/\b(Samsung|Seagate|Western\s+Digital|WD|Intenso|Crucial|Kingston|SanDisk|Toshiba|Corsair|Patriot|Verbatim)\s*\w*/gi, '')
    // Remove model/speed jargon
    .replace(/\b(Pro|Evo|Ultra|Plus|Red|Blue|Green|Black|Gold|Purple|Dragon|Fire|Barracuda|EX\d*)\b/gi, '')
    .replace(/\b(SATA|PCIe|PCIe4|NVMe|NGFF|Gen\d+|x\d+|M\.?2)\b/gi, '')
    .replace(/\b(schnelle?|externe?|interne?)\b/gi, '')
    .replace(/\bFestplatte\b/gi, 'HDD')
    .replace(/[()[\]]/g, '')
    .replace(/\s*[,;]\s*/g, ' + ')     // normalise separators
    .replace(/\s+/g, ' ')
    .replace(/\b(\w+) \1\b/gi, '$1')   // deduplicate adjacent same words (HDD HDD → HDD)
    .replace(/(\+\s*)+$/g, '')         // trim trailing +
    .trim();

  // If still too long, keep only the first segment
  if (s.length > 22) {
    const first = s.split('+')[0].trim();
    s = first + (s.includes('+') ? '…' : '');
  }
  return s || null;
}

/**
 * Formats a compact spec line from an AI-extracted specs object or raw JSON string.
 * Returns null when no meaningful data is available.
 */
function specLine(specsOrJson) {
  let specs = specsOrJson;
  if (typeof specs === 'string') {
    try { specs = JSON.parse(specs); } catch { return null; }
  }
  if (!specs) return null;

  const parts = [
    shortCpu(specs.cpu),
    shortGpu(specs.gpu),
    specs.ram_gb ? `${specs.ram_gb} GB` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(' | ') : null;
}

function scoreLabel(score) {
  if (score === null) return null;
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'average';
  return 'basic';
}

module.exports = { scoreItem, scoreGpu, normalizeGpu, scoreLabel, specLine };
