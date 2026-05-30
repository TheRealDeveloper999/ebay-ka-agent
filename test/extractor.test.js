const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MODEL,
  buildChatRequestBody,
  getConfiguredApiKeys,
  parseModelSpecs,
} = require('../src/lib/extractor');

const validSpecs = {
  cpu: 'i7',
  cpu_variant: '12700K',
  gpu: 'RTX 3070 Ti',
  vram_gb: 8,
  ram_gb: 32,
  ram_type: 'DDR4',
  storage: 'SSD 500gb, HDD 2tb',
  motherboard: null,
  os: 'Windows 11',
  condition: 'used',
};

describe('OpenRouter configuration', () => {
  test('uses the documented production model by default', () => {
    assert.equal(DEFAULT_MODEL, 'qwen/qwen3-235b-a22b-2507');
  });

  test('loads comma-separated, single, and numbered API key conventions', () => {
    const keys = getConfiguredApiKeys({
      OPENROUTER_API_KEYS: ' key-a, key-b ',
      OPENROUTER_API_KEY: 'key-c',
      OPENROUTER_API_KEY_1: 'key-d',
      OPENROUTER_API_KEY_3: 'key-f',
      OPENROUTER_API_KEY_2: 'key-e',
    });

    assert.deepEqual(keys, ['key-a', 'key-b', 'key-c', 'key-d', 'key-e', 'key-f']);
  });

  test('requests JSON-only model output from OpenRouter', () => {
    const body = buildChatRequestBody('test/model', 'Gaming PC listing');

    assert.equal(body.model, 'test/model');
    assert.deepEqual(body.response_format, { type: 'json_object' });
  });
});

describe('model specs output parsing', () => {
  test('accepts valid specs JSON', () => {
    assert.deepEqual(parseModelSpecs(JSON.stringify(validSpecs)), validSpecs);
  });

  test('rejects malformed or ambiguous model output as model errors', () => {
    assert.throws(
      () => parseModelSpecs('{ bad json'),
      err => err.code === 'MODEL_ERROR' && err.message.includes('malformed JSON')
    );

    assert.throws(
      () => parseModelSpecs(`${JSON.stringify(validSpecs)}\n${JSON.stringify({ ...validSpecs, gpu: 'RTX 3080' })}`),
      err => err.code === 'MODEL_ERROR' && err.message.includes('single JSON object')
    );
  });

  test('rejects missing, extra, and invalid typed fields', () => {
    const { gpu, ...missingGpu } = validSpecs;
    assert.throws(
      () => parseModelSpecs(JSON.stringify(missingGpu)),
      err => err.code === 'MODEL_ERROR' && err.message.includes('missing field: gpu')
    );

    assert.throws(
      () => parseModelSpecs(JSON.stringify({ ...validSpecs, price: 700 })),
      err => err.code === 'MODEL_ERROR' && err.message.includes('unexpected field: price')
    );

    assert.throws(
      () => parseModelSpecs(JSON.stringify({ ...validSpecs, ram_gb: '32' })),
      err => err.code === 'MODEL_ERROR' && err.message.includes('ram_gb must be number or null')
    );
  });

  test('rejects enum fields outside the prompt contract', () => {
    assert.throws(
      () => parseModelSpecs(JSON.stringify({ ...validSpecs, ram_type: 'DDR3' })),
      err => err.code === 'MODEL_ERROR' && err.message.includes('ram_type must be DDR4, DDR5, or null')
    );

    assert.throws(
      () => parseModelSpecs(JSON.stringify({ ...validSpecs, condition: 'refurbished' })),
      err => err.code === 'MODEL_ERROR' && err.message.includes('condition must be new, used, or null')
    );
  });
});
