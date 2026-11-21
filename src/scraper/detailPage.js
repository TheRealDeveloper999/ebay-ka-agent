'use strict';

const { normalizeItemImages } = require('../lib/item-images');

function parseAdCreationDate(text) {
  const match = text?.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const isoDate = `${year}-${month}-${day}`;
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate ? null : isoDate;
}

function readAdDateText(adId) {
  const currentAdId = location.pathname.match(/^\/s-anzeige\/(?:[^/]+\/)?(\d+)-\d+-\d+\/?$/)?.[1];
  if (currentAdId !== adId) return null;
  const date = document.querySelector(
    '#viewad-extra-info .icon-calendar-gray-simple + span, #viewad-extra-info time'
  );
  return date?.textContent;
}

async function readAdCreationDate(page, externalId) {
  return parseAdCreationDate(await page.evaluate(readAdDateText, externalId));
}

async function readAdImages(page) {
  const urls = await page.evaluate(() => {
    const fullSize = document.querySelectorAll('#viewad-lightbox-thumbnail-list img[data-imgsrc]');
    const images = fullSize.length ? fullSize : document.querySelectorAll(
      '#viewad-thumbnails img, .galleryimage-element img, [data-testid="ad-image"]'
    );
    return Array.from(images, img => img.dataset.imgsrc || img.dataset.large || img.dataset.src || img.getAttribute('src'))
      .filter(src => src && !src.includes('placeholder'))
      .map(src => new URL(src, location.href).href);
  });
  return normalizeItemImages({ image_urls: urls });
}

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
    // Deleted ads can still return HTTP 200 and retain their description.
    const deleted = await page.locator('.pvap-reserved-image-veil.imagebox-veil:not(.is-hidden) .icon-trash-light-gray-big').count();
    if (deleted > 0) return false;
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
  const response = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (response && !response.ok()) throw new Error(`Detail page returned HTTP ${response.status()}`);

  await page.waitForSelector('#viewad-description, .addetailspage', { timeout: 15000 }).catch(() => null);

  const creationDate = await readAdCreationDate(page, item.external_id);
  const detail = await page.evaluate(() => {
    const descEl = document.querySelector('#viewad-description-text, .ad-description');
    const sellerEl = document.querySelector('#viewad-contact .text-bold, a[href*="/pro/"]');
    const sellerLinkEl = document.querySelector('a[href*="/pro/"], a[href*="/s-bestandsliste/"]');

    return {
      description: descEl ? descEl.innerText.trim() : '',
      seller_name: sellerEl ? sellerEl.textContent.trim() : '',
      seller_url: sellerLinkEl ? sellerLinkEl.href : '',
    };
  });

  const images = await readAdImages(page);
  return {
    ...item,
    ...detail,
    ad_created_date: item.ad_created_date ?? creationDate,
    image_urls: images.length ? JSON.stringify(images) : item.image_urls ?? null,
  };
}

module.exports = { scrapeDetailPage, verifyItemAvailable, readAdCreationDate, parseAdCreationDate };
