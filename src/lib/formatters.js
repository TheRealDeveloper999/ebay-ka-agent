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

function relativeTime(isoString) {
  if (!isoString) return '–';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tag${days !== 1 ? 'en' : ''}`;
}

function changeTypeLabel(type) {
  const labels = {
    new: 'Neu',
    price_drop: 'Preissenkung',
    price_rise: 'Preiserhöhung',
    title_changed: 'Titel geändert',
    description_changed: 'Beschreibung geändert',
    removed: 'Entfernt',
    relisted: 'Wieder eingestellt',
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
  return { pending: 'Ausstehend', processing: 'Aktiv', done: 'Erledigt', failed: 'Fehlgeschlagen' }[status] || status;
}

function queueStatusBadgeClass(status) {
  return { pending: 'badge-warning', processing: 'badge-info', done: 'badge-success', failed: 'badge-removed' }[status] || '';
}

module.exports = { formatPrice, formatDate, relativeTime, changeTypeLabel, changeTypeBadgeClass, queueStatusLabel, queueStatusBadgeClass };
