'use strict';

const MAX_PAGES = parseInt(process.env.MAX_PAGES_PER_SOURCE || '3', 10);

function randomDelay() {
  return new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
}

function parseListingPrice(priceText) {
  const text = String(priceText || '').trim();
  const match = text.match(/\d[\d.,]*/);
  if (!match) return null;

  const normalized = match[0]
    .replace(/\./g, '')
    .replace(',', '.');
  const price = parseFloat(normalized);
  return Number.isNaN(price) ? null : price;
}

function passesListingFilters(card, filters = {}) {
  if (filters.keyword && !card.title.toLowerCase().includes(filters.keyword.toLowerCase())) return false;

  const price = parseListingPrice(card.price_text);
  if (filters.min_price && price != null && price < filters.min_price) return false;
  if (filters.max_price && price != null && price > filters.max_price) return false;

  return true;
}

async function scrapeListingPage(page, url, filters = {}) {
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9' });
  await page.setViewportSize({ width: 1280, height: 900 });

  const cards = [];
  let currentUrl = url;

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Accept cookie consent if present
    const consentBtn = page.locator('button[data-testid="gdpr-banner-accept"], #gdpr-banner-accept, button:has-text("Alle akzeptieren")').first();
    if (await consentBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await consentBtn.click();
      await page.waitForTimeout(500);
    }

    // Wait for listing cards
    const found = await page.waitForSelector('article.aditem, li[data-adid]', { timeout: 15000 }).catch(() => null);
    if (!found) {
      // Page 1 missing elements = real problem (bot-block, CAPTCHA, broken URL)
      if (pageNum === 0) throw new Error('No listing elements found on page 1 — bot block, CAPTCHA, or page structure changed?');
      // Later pages: simply no more results — stop pagination
      break;
    }

    const pageCards = await page.evaluate(() => {
      const results = [];
      // Try both known card selectors
      const els = document.querySelectorAll('article.aditem[data-adid], li[data-adid]');
      for (const el of els) {
        const adId = el.getAttribute('data-adid');
        if (!adId) continue;

        const titleEl = el.querySelector('a.ellipsis, h2 a, .aditem-main--top a');
        const priceEl = el.querySelector('.aditem-main--middle--price-shipping--price, p.aditem-main--middle--price');
        const locationEl = el.querySelector('.aditem-main--top--left, .simpletag.tag-small');
        const imgEl = el.querySelector('img');
        const linkEl = el.querySelector('a[href*="/s-anzeige/"]');

        results.push({
          external_id: adId,
          title: titleEl ? titleEl.textContent.trim() : '',
          price_text: priceEl ? priceEl.textContent.trim() : '',
          location: locationEl ? locationEl.textContent.trim() : '',
          thumbnail_url: imgEl ? (imgEl.dataset.src || imgEl.src) : '',
          url: linkEl ? 'https://www.kleinanzeigen.de' + linkEl.getAttribute('href') : '',
        });
      }
      return results;
    });

    for (const card of pageCards) {
      if (!passesListingFilters(card, filters)) continue;

      card.price = parseListingPrice(card.price_text);
      cards.push(card);
    }

    // Check for next page
    const nextBtn = await page.$('a[data-testid="srp-next-page-link"], a.pagination-next');
    if (!nextBtn || pageNum >= MAX_PAGES - 1) break;

    const nextHref = await nextBtn.getAttribute('href');
    if (!nextHref) break;
    currentUrl = nextHref.startsWith('http') ? nextHref : 'https://www.kleinanzeigen.de' + nextHref;

    await randomDelay();
  }

  // Deduplicate by external_id
  const seen = new Set();
  return cards.filter(c => {
    if (seen.has(c.external_id)) return false;
    seen.add(c.external_id);
    return true;
  });
}

module.exports = { scrapeListingPage, parseListingPrice, passesListingFilters };
