const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runInNewContext } = require('node:vm');
const { getListingAge } = require('../src/lib/listing-age');
const { parseAdCreationDate, scrapeDetailPage } = require('../src/scraper/detailPage');

test('parses and validates the date shown on the ad detail page', () => {
  assert.equal(parseAdCreationDate(' 26.08.2026 '), '2026-08-26');
  assert.equal(parseAdCreationDate('31.02.2026'), null);
  assert.equal(parseAdCreationDate(''), null);
});

test('uses strict calendar-day thresholds in Berlin', () => {
  const now = new Date('2026-11-19T23:30:00Z');
  assert.equal(getListingAge('2026-11-17', now), null);
  assert.deepEqual(getListingAge('2026-11-16', now), { days: 4, color: 'yellow' });
  assert.deepEqual(getListingAge('2026-11-13', now), { days: 7, color: 'yellow' });
  assert.deepEqual(getListingAge('2026-11-12', now), { days: 8, color: 'orange' });
  assert.deepEqual(getListingAge('2026-10-31', now), { days: 20, color: 'orange' });
  assert.deepEqual(getListingAge('2026-10-30', now), { days: 21, color: 'red' });
  assert.equal(getListingAge(null, now), null);
  assert.equal(getListingAge('2026-11-21', now), null);
});

test('returns the creation date on the first detail scrape', async () => {
  const item = { external_id: '123', url: 'https://www.kleinanzeigen.de/s-anzeige/123-228-718' };
  const page = {
    async goto() {},
    async waitForSelector() {},
    async evaluate(callback, adId) {
      return runInNewContext(`(${callback})(adId)`, {
        adId,
        location: new URL(item.url),
        document: {
          querySelector: selector => selector.includes('#viewad-extra-info') ? { textContent: '11.11.2026' } : null,
          querySelectorAll: () => [],
        },
      });
    },
  };
  const result = await scrapeDetailPage(page, item);
  assert.equal(result.ad_created_date, '2026-11-11');
});
