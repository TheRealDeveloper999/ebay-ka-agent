const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { parseListingPrice, passesListingFilters } = require('../src/scraper/listingPage');

describe('listing page price parsing', () => {
  test('parses German listing prices with currency, VB, and thousands separators', () => {
    assert.equal(parseListingPrice('680 €'), 680);
    assert.equal(parseListingPrice('500 € VB'), 500);
    assert.equal(parseListingPrice('1.200 €'), 1200);
    assert.equal(parseListingPrice('1.234,56 €'), 1234.56);
  });

  test('returns null for non-numeric price text', () => {
    assert.equal(parseListingPrice('VB'), null);
    assert.equal(parseListingPrice('Zu verschenken'), null);
    assert.equal(parseListingPrice('Preis auf Anfrage'), null);
    assert.equal(parseListingPrice(''), null);
  });
});

describe('listing page filters', () => {
  test('applies keyword and min/max price filters to parsed listing prices', () => {
    assert.equal(passesListingFilters({ title: 'Gaming PC', price_text: '700 €' }, { keyword: 'gaming', min_price: 500, max_price: 800 }), true);
    assert.equal(passesListingFilters({ title: 'Office PC', price_text: '700 €' }, { keyword: 'gaming' }), false);
    assert.equal(passesListingFilters({ title: 'Gaming PC', price_text: '400 €' }, { min_price: 500 }), false);
    assert.equal(passesListingFilters({ title: 'Gaming PC', price_text: '900 €' }, { max_price: 800 }), false);
  });

  test('keeps listings with unknown prices for manual review', () => {
    assert.equal(passesListingFilters({ title: 'Gaming PC', price_text: 'VB' }, { min_price: 500, max_price: 800 }), true);
  });
});
