'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const berlinDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' });

function getListingAge(date, now = new Date()) {
  if (!date) return null;

  const days = (Date.parse(berlinDate.format(now)) - Date.parse(date)) / DAY_MS;
  if (days > 20) return { days, color: 'red' };
  if (days > 7) return { days, color: 'orange' };
  if (days > 3) return { days, color: 'yellow' };
  return null;
}

module.exports = { getListingAge };
