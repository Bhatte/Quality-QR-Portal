const express = require('express');
const path = require('path');
const router = express.Router();

// Simple in-memory rate limiter for local login
const loginAttempts = new Map();
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 30; // per IP per window
const BLOCK_MS = 5 * 60 * 1000; // block 5 minutes after too many attempts

function checkLoginRate(req) {
  const now = Date.now();
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const entry = loginAttempts.get(ip) || { count: 0, reset: now + WINDOW_MS, blockedUntil: 0 };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + WINDOW_MS;
    entry.blockedUntil = 0;
  }
  if (entry.blockedUntil && now < entry.blockedUntil) {
    return { blocked: true, remainingMs: entry.blockedUntil - now };
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MS;
  }
  loginAttempts.set(ip, entry);
  return { blocked: entry.blockedUntil && now < entry.blockedUntil };
}

// Login route
router.get('/login', (req, res) => {
  // Preserve returnTo if provided
  if (req.query.returnTo) req.session.returnTo = req.query.returnTo;
  return res.redirect('/login.html');
});

// Local login handler
router.post('/local/login', (req, res) => {

  const rate = checkLoginRate(req);
  if (rate.blocked) {
    return res.status(429).json({ ok: false, error: 'too_many_attempts' });
  }

  const email = String((req.body?.email || '').trim()).toLowerCase();
  const code = String((req.body?.code || '').trim());

  const allowed = (process.env.ADMIN_USERS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  const accessCode = String(process.env.LOCAL_ACCESS_CODE || '');

  if (!email || !code) return res.status(400).json({ ok: false, error: 'missing_credentials' });
  if (!allowed.length) return res.status(500).json({ ok: false, error: 'server_not_configured' });
  if (!accessCode) return res.status(500).json({ ok: false, error: 'server_not_configured' });
  if (!allowed.includes(email)) return res.status(401).json({ ok: false, error: 'not_allowed' });
  if (code !== accessCode) return res.status(401).json({ ok: false, error: 'invalid_code' });

  // Success: rotate session to prevent fixation, then establish session
  const returnTo = req.session.returnTo || '/admin.html';
  delete req.session.returnTo;
  req.session.regenerate((err) => {
    if (err) {
      console.error('[AUTH] Session regenerate failed:', err);
      return res.status(500).json({ ok: false, error: 'session_error' });
    }
    req.session.user = { email, name: email, provider: 'local' };
    req.session.save(() => res.json({ ok: true, redirectTo: returnTo }));
  });
});

// Logout route
router.get('/logout', (req, res) => {
  const email = req.session?.user?.email || 'unknown';
  console.log(`[AUTH] Local logout requested for ${email}`);
  return req.session.destroy(() => res.redirect('/login.html'));
});

// (Removed duplicate /auth/login error handler to avoid conflicts)

// Status endpoint for debugging
router.get('/status', (req, res) => {
  const user = req.session?.user || null;
  return res.json({ authenticated: !!user, user, session: !!req.session });
});

module.exports = router;
