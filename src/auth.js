const crypto = require('crypto');
const express = require('express');

const router = express.Router();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  throw new Error('Missing admin credentials. Set ADMIN_USERNAME and ADMIN_PASSWORD.');
}

// Length-safe constant-time string comparison.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still run a comparison to keep timing uniform, then fail.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const ok =
    typeof username === 'string' &&
    typeof password === 'string' &&
    safeEqual(username, ADMIN_USERNAME) &&
    safeEqual(password, ADMIN_PASSWORD);

  if (!ok) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  req.session.authed = true;
  req.session.username = username;
  return res.json({ authed: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (req.session && req.session.authed) {
    return res.json({ authed: true, username: req.session.username });
  }
  return res.status(401).json({ authed: false });
});

// Middleware: protects /api/* routes. Returns 401 JSON for API calls.
function requireAuth(req, res, next) {
  if (req.session && req.session.authed) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required.' });
}

module.exports = { router, requireAuth };
