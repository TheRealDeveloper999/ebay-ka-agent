'use strict';

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

module.exports = { scrapeDetailPage };
