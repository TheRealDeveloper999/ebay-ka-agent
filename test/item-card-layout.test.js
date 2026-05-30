const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

describe('dashboard item card layout', () => {
  test('renders price as a bottom-centered image overlay', () => {
    const template = read('views/partials/item-card.njk');
    const css = read('public/css/app.css');

    const thumbWrap = template.match(/<div class="item-card__thumb-wrap"[\s\S]*?<\/div>\s*<a class="item-card__link"/);
    assert.ok(thumbWrap, 'expected thumb wrapper before card body link');
    assert.match(thumbWrap[0], /item-card__price/, 'price should render inside the image wrapper');

    const metaBlock = template.match(/<div class="item-card__meta">[\s\S]*?<\/div>/);
    assert.ok(metaBlock, 'expected item-card meta block');
    assert.doesNotMatch(metaBlock[0], /item-card__price/, 'price should not render in the body meta row');

    assert.match(css, /\.item-card__price\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*6px;[^}]*left:\s*50%;[^}]*transform:\s*translateX\(-50%\)/s);
  });
});
