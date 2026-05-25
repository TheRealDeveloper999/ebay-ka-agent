'use strict';

const TRACKED_FIELDS = ['title', 'price', 'location', 'description', 'seller_name'];

function diffSnapshots(prev, next) {
  if (!prev) {
    return [{ change_type: 'new', field_name: null, old_value: null, new_value: null }];
  }

  const changes = [];

  for (const field of TRACKED_FIELDS) {
    const oldVal = prev[field] != null ? String(prev[field]) : null;
    const newVal = next[field] != null ? String(next[field]) : null;

    if (oldVal === newVal) continue;

    if (field === 'price') {
      const oldNum = parseFloat(prev[field]);
      const newNum = parseFloat(next[field]);
      if (!isNaN(oldNum) && !isNaN(newNum)) {
        changes.push({
          change_type: newNum < oldNum ? 'price_drop' : 'price_rise',
          field_name: 'price',
          old_value: oldVal,
          new_value: newVal,
        });
      } else if (oldVal !== newVal) {
        changes.push({ change_type: 'price_rise', field_name: 'price', old_value: oldVal, new_value: newVal });
      }
    } else {
      changes.push({
        change_type: `${field}_changed`,
        field_name: field,
        old_value: oldVal,
        new_value: newVal,
      });
    }
  }

  return changes;
}

module.exports = { diffSnapshots };
