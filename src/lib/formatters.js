'use strict';

function formatPrice(price, priceText) {
  if (priceText) return priceText;
  if (price == null) return '–';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(price);
}

function formatDate(isoString) {
  if (!isoString) return '–';
  return new Date(isoString).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatCalendarDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
}

function relativeTime(isoString) {
  if (!isoString) return '–';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function changeTypeLabel(type) {
  const labels = {
    new: 'New',
    price_drop: 'Price drop',
    price_rise: 'Price rise',
    title_changed: 'Title changed',
    description_changed: 'Description changed',
    removed: 'Removed',
    relisted: 'Relisted',
  };
  return labels[type] || type;
}

function changeTypeBadgeClass(type) {
  const classes = {
    new: 'badge-new',
    price_drop: 'badge-price-drop',
    price_rise: 'badge-price-rise',
    title_changed: 'badge-changed',
    description_changed: 'badge-changed',
    removed: 'badge-removed',
    relisted: 'badge-new',
  };
  return classes[type] || 'badge-changed';
}

function queueStatusLabel(status) {
  return { pending: 'Pending', processing: 'Active', done: 'Done', failed: 'Failed' }[status] || status;
}

function queueStatusBadgeClass(status) {
  return { pending: 'badge-warning', processing: 'badge-info', done: 'badge-success', failed: 'badge-removed' }[status] || '';
}

module.exports = { formatPrice, formatDate, formatCalendarDate, relativeTime, changeTypeLabel, changeTypeBadgeClass, queueStatusLabel, queueStatusBadgeClass };
