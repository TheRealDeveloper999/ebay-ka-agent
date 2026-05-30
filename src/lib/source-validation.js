'use strict';

const ALLOWED_HOSTNAMES = new Set(['kleinanzeigen.de', 'www.kleinanzeigen.de', 'm.kleinanzeigen.de']);

function isAllowedUrl(raw) {
  try {
    const { protocol, hostname } = new URL(raw);
    return (protocol === 'http:' || protocol === 'https:') && ALLOWED_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

const parseOptionalFloat = v => (v !== '' && v != null) ? parseFloat(v) : null;

function validateSource(body) {
  const errors = [];
  if (!body.name || !body.name.trim()) errors.push('Name is required');
  if (!body.url || !body.url.trim()) errors.push('URL is required');
  if (body.url && !isAllowedUrl(body.url)) errors.push('URL must be a kleinanzeigen.de page (https://www.kleinanzeigen.de/...)');
  const interval = parseInt(body.interval, 10);
  if (isNaN(interval) || interval < 5) errors.push('Interval must be at least 5 minutes');
  if (!isNaN(interval) && interval > 1440) errors.push('Interval may not exceed 1440 minutes (24 h)');
  const min = parseOptionalFloat(body.min_price);
  const max = parseOptionalFloat(body.max_price);
  if (min !== null && isNaN(min)) errors.push('Min. price must be a number');
  if (max !== null && isNaN(max)) errors.push('Max. price must be a number');
  if (min !== null && max !== null && !isNaN(min) && !isNaN(max) && max < min)
    errors.push('Max. price must be greater than or equal to min. price');
  return errors;
}

module.exports = { isAllowedUrl, parseOptionalFloat, validateSource };
