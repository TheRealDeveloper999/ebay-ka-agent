'use strict';

// Returns true if the ad page still shows a live listing.
// Kleinanzeigen redirects removed ads to search/home, or shows a "no longer available" banner.
async function verifyItemAvailable(page, url) {
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Non-2xx response → gone
    if (resp && resp.status() >= 400) return false;
    // If redirected away from the ad URL, it's been removed
    const finalUrl = page.url();
    const adIdMatch = url.match(/\/(\d+)-\d+-\d+/);
    if (adIdMatch && !finalUrl.includes(adIdMatch[1])) return false;
    // Check for the "not available" banner kleinanzeigen shows
    const unavailable = await page.$('#viewad-belated-fraud-warning, [data-testid="ad-not-found"], .notfound-headline').catch(() => null);
    if (unavailable) return false;
    // If the main ad content is present → still live
    const adContent = await page.$('#viewad-description, #viewad-main-image, .addetailspage').catch(() => null);
    return !!adContent;
  } catch {
    // Network error / timeout — assume still available to avoid false positive
    return true;
  }
}

async function scrapeDetailPage(page, item) {
  await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  await page.waitForSelector('#viewad-description, .addetailspage', { timeout: 15000 }).catch(() => null);

  const detail = await page.evaluate(() => {
    const descEl = document.querySelector('#viewad-description-text, .ad-description');
    const sellerEl = document.querySelector('#viewad-contact .text-bold, a[href*="/pro/"]');
    const sellerLinkEl = document.querySelector('a[href*="/pro/"], a[href*="/s-bestandsliste/"]');

    const images = [];
    const imgEls = document.querySelectorAll('#viewad-thumbnails img, .galleryimage-element img, [data-testid="ad-image"]');
    for (const img of imgEls) {
      const src = img.dataset.src || img.dataset.large || img.src;
      if (src && !src.includes('placeholder')) images.push(src);
    }

    return {
      description: descEl ? descEl.innerText.trim() : '',
      seller_name: sellerEl ? sellerEl.textContent.trim() : '',
      seller_url: sellerLinkEl ? sellerLinkEl.href : '',
      image_urls: JSON.stringify(images),
    };
  });

  return { ...item, ...detail };
}

module.exports = { scrapeDetailPage, verifyItemAvailable };
