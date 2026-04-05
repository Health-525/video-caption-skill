'use strict';

function looksLikeVideoId(value) {
  return /^[A-Za-z0-9_-]{11}$/.test((value || '').trim());
}

function normalizeInput(value) {
  const input = (value || '').trim();
  if (!input) return input;
  if (looksLikeVideoId(input)) return `https://www.youtube.com/watch?v=${input}`;
  if (/^https?:\/\/(www\.)?youtube\.com\/shorts\//i.test(input)) {
    const url = new URL(input);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[1] ? `https://www.youtube.com/watch?v=${parts[1]}` : input;
  }
  if (/^https?:\/\/(www\.)?youtube\.com\/embed\//i.test(input)) {
    const url = new URL(input);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[1] ? `https://www.youtube.com/watch?v=${parts[1]}` : input;
  }
  return input;
}

module.exports = { looksLikeVideoId, normalizeInput };
