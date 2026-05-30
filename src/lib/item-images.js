'use strict';

function parseImageUrls(imageUrls) {
  if (!imageUrls) return [];
  if (Array.isArray(imageUrls)) return imageUrls;
  if (typeof imageUrls !== 'string') return [];

  try {
    const parsed = JSON.parse(imageUrls);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function imageIdentity(url) {
  if (typeof url !== 'string') return '';

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

function normalizeItemImages(item) {
  const urls = [
    ...parseImageUrls(item.image_urls),
    item.thumbnail_url,
  ];

  const seen = new Set();
  return urls
    .map(url => (typeof url === 'string' ? url.trim() : ''))
    .filter(Boolean)
    .filter(url => {
      const key = imageIdentity(url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function attachItemImages(items) {
  return items.map(item => ({
    ...item,
    card_image_urls: normalizeItemImages(item),
  }));
}

module.exports = { parseImageUrls, imageIdentity, normalizeItemImages, attachItemImages };
