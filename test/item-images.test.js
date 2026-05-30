'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { imageIdentity, normalizeItemImages, attachItemImages } = require('../src/lib/item-images');

describe('item image normalization', () => {
  test('prefers detail images over low-resolution listing thumbnail', () => {
    const urls = normalizeItemImages({
      thumbnail_url: 'https://img.kleinanzeigen.de/api/v1/prod-ads/images/7b/id?rule=$_2.AUTO',
      image_urls: JSON.stringify([
        'https://img.kleinanzeigen.de/api/v1/prod-ads/images/7b/id?rule=$_59.AUTO',
        'https://img.kleinanzeigen.de/api/v1/prod-ads/images/34/other?rule=$_59.AUTO',
      ]),
    });

    assert.deepEqual(urls, [
      'https://img.kleinanzeigen.de/api/v1/prod-ads/images/7b/id?rule=$_59.AUTO',
      'https://img.kleinanzeigen.de/api/v1/prod-ads/images/34/other?rule=$_59.AUTO',
    ]);
  });

  test('uses thumbnail when no detail images exist', () => {
    const urls = normalizeItemImages({
      thumbnail_url: 'https://img.example/thumb.jpg',
      image_urls: null,
    });

    assert.deepEqual(urls, ['https://img.example/thumb.jpg']);
  });

  test('deduplicates images by URL path while preserving preferred order', () => {
    const urls = normalizeItemImages({
      thumbnail_url: 'https://img.example/1.jpg?size=small',
      image_urls: JSON.stringify([
        'https://img.example/1.jpg?size=large',
        'https://img.example/2.jpg?size=large',
        'https://img.example/2.jpg?size=medium',
      ]),
    });

    assert.deepEqual(urls, ['https://img.example/1.jpg?size=large', 'https://img.example/2.jpg?size=large']);
  });

  test('ignores invalid image json but keeps thumbnail fallback', () => {
    assert.deepEqual(normalizeItemImages({ thumbnail_url: 'https://img.example/thumb.jpg', image_urls: '{nope' }), [
      'https://img.example/thumb.jpg',
    ]);
  });

  test('image identity strips query params', () => {
    assert.equal(imageIdentity('https://img.example/path/image.jpg?rule=small'), 'https://img.example/path/image.jpg');
  });

  test('attaches card image urls without mutating original rows', () => {
    const rows = [{ id: 1, thumbnail_url: 'https://img.example/thumb.jpg', image_urls: '[]' }];
    const result = attachItemImages(rows);

    assert.deepEqual(result[0].card_image_urls, ['https://img.example/thumb.jpg']);
    assert.equal(rows[0].card_image_urls, undefined);
  });
});
