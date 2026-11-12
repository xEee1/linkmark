'use strict';

const { fail } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;

function isValidUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateRegister(body) {
  const b = body && typeof body === 'object' ? body : {};
  const username = typeof b.username === 'string' ? b.username.trim() : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';

  if (!USERNAME_RE.test(username)) {
    fail('VALIDATION_ERROR', 'username must be 3-32 chars [A-Za-z0-9_]');
  }
  if (!EMAIL_RE.test(email) || email.length > 255) {
    fail('VALIDATION_ERROR', 'email is invalid');
  }
  if (password.length < 8) {
    fail('VALIDATION_ERROR', 'password must be at least 8 characters');
  }
  return { username, email, password };
}

function validateLogin(body) {
  const b = body && typeof body === 'object' ? body : {};
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!email || !password) fail('VALIDATION_ERROR', 'email and password are required');
  return { email, password };
}

// Tags: trim + lowercase + drop empty + dedup; each <=32 chars; <=20 per bookmark;
// returned ascending so Bookmark JSON tags are always sorted by name.
function normalizeTags(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) fail('VALIDATION_ERROR', 'tags must be an array');
  const seen = new Set();
  for (const raw of input) {
    if (typeof raw !== 'string') fail('VALIDATION_ERROR', 'each tag must be a string');
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    if (name.length > 32) fail('VALIDATION_ERROR', `tag "${name}" exceeds 32 characters`);
    seen.add(name);
  }
  const names = [...seen];
  if (names.length > 20) fail('VALIDATION_ERROR', 'a bookmark can have at most 20 tags');
  return names.sort();
}

// A filter tag is matched against the normalized stored name (case-insensitive).
function normalizeTagQuery(input) {
  if (typeof input !== 'string') return '';
  return input.trim().toLowerCase();
}

function validateBookmarkInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const url = typeof b.url === 'string' ? b.url.trim() : '';
  const title = typeof b.title === 'string' ? b.title.trim() : '';

  let description = '';
  if (b.description !== undefined && b.description !== null) {
    if (typeof b.description !== 'string') fail('VALIDATION_ERROR', 'description must be a string');
    description = b.description;
  }

  if (!isValidUrl(url)) fail('VALIDATION_ERROR', 'url must be a valid http(s) URL');
  if (!title) fail('VALIDATION_ERROR', 'title is required');
  if (title.length > 255) fail('VALIDATION_ERROR', 'title must be 255 characters or fewer');
  if (description.length > 2000) fail('VALIDATION_ERROR', 'description must be 2000 characters or fewer');

  const tags = normalizeTags(b.tags);
  // PUT is a full replacement: omitted tags/description become [] / ''.
  return { url, title, description, tags };
}

module.exports = {
  isValidUrl,
  validateRegister,
  validateLogin,
  normalizeTags,
  normalizeTagQuery,
  validateBookmarkInput,
};
