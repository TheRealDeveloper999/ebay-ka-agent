'use strict';

const MAX_PAGES = parseInt(process.env.MAX_PAGES_PER_SOURCE || '3', 10);
const CARD_SELECTOR = 'article[data-adid], li[data-adid]';

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
    const response = await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (response && !response.ok()) {
      throw new Error(`Kleinanzeigen returned HTTP ${response.status()} on results page ${pageNum + 1}`);
    }

    // Accept cookie consent if present
    const consentBtn = page.locator('button[data-testid="gdpr-banner-accept"], #gdpr-banner-accept, button:has-text("Alle akzeptieren")').first();
    if (await consentBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await consentBtn.click();
      await page.waitForTimeout(500);
    }

    // Wait for listing cards
    const found = await page.waitForSelector(CARD_SELECTOR, { timeout: 15000 }).catch(() => null);
    if (!found) {
      // Page 1 missing elements = real problem (bot-block, CAPTCHA, broken URL)
      if (pageNum === 0) throw new Error('No listing elements found on page 1 — bot block, CAPTCHA, or page structure changed?');
      // Later pages: simply no more results — stop pagination
      break;
    }

    const pageCards = await page.evaluate(cardSelector => {
      const results = [];
      const els = document.querySelectorAll(cardSelector);
      for (const el of els) {
        const adId = el.getAttribute('data-adid');
        const titleEl = el.querySelector('h3 a[href*="/s-anzeige/"], a.ellipsis, h2 a, .aditem-main--top a');
        const title = titleEl?.textContent.trim();
        const linkEl = el.querySelector('a[href*="/s-anzeige/"]');
        if (!adId || !title || !linkEl) continue;

        // The current layout groups title, description, and price below the location row.
        const details = titleEl.closest('h3')?.parentElement;
        const priceEl = el.querySelector('.aditem-main--middle--price-shipping--price, p.aditem-main--middle--price')
          || details?.querySelector(':scope > div > p');
        const locationEl = el.querySelector('.aditem-main--top--left, .simpletag.tag-small')
          || details?.previousElementSibling?.querySelector('span');
        const imgEl = el.querySelector('img');

        results.push({
          external_id: adId,
          title,
          price_text: priceEl ? priceEl.textContent.trim() : '',
          location: locationEl ? locationEl.textContent.trim() : '',
          thumbnail_url: imgEl ? (imgEl.dataset.src || imgEl.src) : '',
          url: linkEl.href,
        });
      }
      return results;
    }, CARD_SELECTOR);

    if (pageCards.length === 0) {
      throw new Error(`Kleinanzeigen cards on results page ${pageNum + 1} contained no readable listings`);
    }

    for (const card of pageCards) {
      if (!passesListingFilters(card, filters)) continue;

      card.price = parseListingPrice(card.price_text);
      cards.push(card);
    }

    // Check for next page
    const nextBtn = await page.$('a[rel="next"], a[aria-label="Nächste"], a[data-testid="srp-next-page-link"], a.pagination-next');
    if (!nextBtn || pageNum >= MAX_PAGES - 1) break;

    const nextHref = await nextBtn.getAttribute('href');
    if (!nextHref) break;
    currentUrl = new URL(nextHref, page.url()).href;

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
