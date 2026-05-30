const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { isAllowedUrl, validateSource } = require('../src/lib/source-validation');

const validSource = {
  name: 'Gaming PCs',
  url: 'https://www.kleinanzeigen.de/s-pc/k0',
  interval: '30',
  min_price: '',
  max_price: '',
};

describe('source URL validation', () => {
  test('allows Kleinanzeigen source URLs over http and https', () => {
    assert.equal(isAllowedUrl('https://kleinanzeigen.de/s-pc/k0'), true);
    assert.equal(isAllowedUrl('https://www.kleinanzeigen.de/s-pc/k0'), true);
    assert.equal(isAllowedUrl('http://m.kleinanzeigen.de/s-pc/k0'), true);
  });

  test('rejects non-Kleinanzeigen and non-http source URLs', () => {
    assert.equal(isAllowedUrl('https://evil.example/s-pc/k0'), false);
    assert.equal(isAllowedUrl('https://kleinanzeigen.de.evil.example/s-pc/k0'), false);
    assert.equal(isAllowedUrl('javascript:alert(1)'), false);
    assert.equal(isAllowedUrl('not a url'), false);
  });
});

describe('source form validation', () => {
  test('accepts a valid source payload', () => {
    assert.deepEqual(validateSource(validSource), []);
  });

  test('requires name and allowed Kleinanzeigen URL', () => {
    const errors = validateSource({ ...validSource, name: ' ', url: 'https://example.com/search' });

    assert(errors.includes('Name is required'));
    assert(errors.some(error => error.includes('kleinanzeigen.de')));
  });

  test('enforces safe scrape interval bounds', () => {
    assert(validateSource({ ...validSource, interval: '4' }).includes('Interval must be at least 5 minutes'));
    assert(validateSource({ ...validSource, interval: '1441' }).includes('Interval may not exceed 1440 minutes (24 h)'));
  });

  test('rejects invalid price filters and inverted price range', () => {
    assert(validateSource({ ...validSource, min_price: 'abc' }).includes('Min. price must be a number'));
    assert(validateSource({ ...validSource, max_price: 'abc' }).includes('Max. price must be a number'));
    assert(validateSource({ ...validSource, min_price: '900', max_price: '500' }).includes('Max. price must be greater than or equal to min. price'));
  });
});
