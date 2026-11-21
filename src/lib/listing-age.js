'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const berlinDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' });

function getListingAgeDays(date, now = new Date()) {
  if (!date) return null;

  const days = (Date.parse(berlinDate.format(now)) - Date.parse(date)) / DAY_MS;
  return Number.isInteger(days) && days >= 0 ? days : null;
}

function getListingAge(date, now = new Date()) {
  const days = getListingAgeDays(date, now);
  if (days > 20) return { days, color: 'red' };
  if (days > 7) return { days, color: 'orange' };
  if (days > 3) return { days, color: 'yellow' };
  return null;
}

function isToday(timestamp, now = new Date()) {
  if (!timestamp) return false;
  // SQLite stores unzoned change timestamps in UTC.
  const utcTimestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)
    ? timestamp.replace(' ', 'T') + 'Z'
    : timestamp;
  const date = new Date(utcTimestamp);
  return !Number.isNaN(date.getTime()) && berlinDate.format(date) === berlinDate.format(now);
}

module.exports = { getListingAge, getListingAgeDays, isToday };
