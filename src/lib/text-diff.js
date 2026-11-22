'use strict';

const MAX_MATRIX_CELLS = 250_000;

function tokenize(text) {
  return text?.match(/[\p{L}\p{M}\p{N}]+|\s+|[^\s\p{L}\p{M}\p{N}]+/gu) ?? [];
}

function trimContext(runs) {
  if (runs.length <= 1) return runs;

  return runs.map((run, index) => {
    if (run.type !== 'context') return run;

    const lines = run.text.split('\n');
    // The boundary lines may contain part of an edit. Keep those and one full line beside each edit.
    const leading = index === 0 ? 0 : 2;
    const trailing = index === runs.length - 1 ? 0 : 2;
    if (lines.length <= leading + trailing) return run;

    return {
      type: 'context',
      text: [...lines.slice(0, leading), '…', ...lines.slice(lines.length - trailing)].join('\n'),
    };
  });
}

function textDiff(oldText, newText, fieldName) {
  if (fieldName === 'location') {
    // Location values scraped from search cards can contain HTML layout whitespace.
    oldText = oldText?.replace(/\s+/g, ' ').trim();
    newText = newText?.replace(/\s+/g, ' ').trim();
  }
  const before = tokenize(oldText);
  const after = tokenize(newText);
  let start = 0;
  let beforeEnd = before.length;
  let afterEnd = after.length;

  while (start < beforeEnd && start < afterEnd && before[start] === after[start]) start++;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }

  const rows = before.slice(0, start).map(text => ({ type: 'context', text }));
  const width = afterEnd - start + 1;
  const cells = (beforeEnd - start + 1) * width;
  // Keep memory bounded when a long description has been rewritten.
  const matches = cells <= MAX_MATRIX_CELLS ? new Uint32Array(cells) : null;
  const offset = (i, j) => (i - start) * width + j - start;
  if (matches) {
    for (let i = beforeEnd - 1; i >= start; i--) {
      for (let j = afterEnd - 1; j >= start; j--) {
        matches[offset(i, j)] = before[i] === after[j]
          ? 1 + matches[offset(i + 1, j + 1)]
          : Math.max(matches[offset(i + 1, j)], matches[offset(i, j + 1)]);
      }
    }
  }

  let i = start;
  let j = start;
  while (i < beforeEnd || j < afterEnd) {
    if (i < beforeEnd && j < afterEnd && before[i] === after[j]) {
      rows.push({ type: 'context', text: before[i++] });
      j++;
    } else if (i < beforeEnd && (j === afterEnd || !matches || matches[offset(i + 1, j)] >= matches[offset(i, j + 1)])) {
      rows.push({ type: 'removed', text: before[i++] });
    } else {
      rows.push({ type: 'added', text: after[j++] });
    }
  }

  for (const text of before.slice(beforeEnd)) rows.push({ type: 'context', text });
  const runs = [];
  for (const row of rows) {
    const previous = runs.at(-1);
    if (previous?.type === row.type) previous.text += row.text;
    else runs.push(row);
  }
  return trimContext(runs);
}

module.exports = { textDiff };
