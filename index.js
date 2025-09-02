require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const publicRouter = require('./src/routes/public.routes');
const adminRouter = require('./src/routes/admin.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic security & logging
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy when running behind load balancers / App Service
app.set('trust proxy', true);

// Serve admin UI behind auth
app.get(['/admin', '/admin.html'], adminAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Static assets (excluding admin gate due to earlier route)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (path.basename(filePath) === 'admin.html') {
      // Redundant safety: prevent caching; route above handles auth
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

// Serve logo asset from project root without exposing other files
app.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'logo.png'));
});

// Admin auth switch
// - Dev (default): open
// - Production OR EASY_AUTH=true: enforce Azure Easy Auth header and optionally ADMIN_EMAILS allowlist
function adminAuth(req, res, next) {
  const easyAuthOn = /^(true|1|yes)$/i.test(String(process.env.EASY_AUTH || ''));
  const mustEnforce = process.env.NODE_ENV === 'production' || easyAuthOn;
  if (!mustEnforce) return next();

  // In Azure App Service with Easy Auth, x-ms-client-principal will be present for authenticated users
  const principal = req.headers['x-ms-client-principal'];
  if (!principal) return res.status(401).send('Unauthenticated.');

  // Validate against ADMIN_EMAILS allowlist if provided
  const allow = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (!allow.length) return next(); // any authenticated user is allowed

  try {
    const decoded = JSON.parse(Buffer.from(principal, 'base64').toString('utf8'));
    const claims = Array.isArray(decoded?.claims) ? decoded.claims : [];
    const byType = Object.create(null);
    for (const c of claims) {
      const k = String(c.typ || '').toLowerCase();
      if (k) byType[k] = c.val;
    }
    const email = String(
      byType['emails'] ||
      byType['email'] ||
      byType['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ||
      decoded?.userDetails ||
      decoded?.user_principal_name ||
      decoded?.email ||
      ''
    ).toLowerCase();

    if (!email || !allow.includes(email)) {
      return res.status(403).send('Forbidden.');
    }
  } catch (_) {
    return res.status(401).send('Unauthenticated.');
  }

  return next();
}

// Minimal in-memory rate limiter for admin routes (IP-based)
const adminRate = (() => {
  const hits = new Map();
  const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  const MAX = 300; // max requests per window per IP
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const entry = hits.get(ip) || { count: 0, reset: now + WINDOW_MS };
    if (now > entry.reset) {
      entry.count = 0;
      entry.reset = now + WINDOW_MS;
    }
    entry.count += 1;
    hits.set(ip, entry);
    if (entry.count > MAX) return res.status(429).json({ ok: false, error: 'rate_limited' });
    return next();
  };
})();

// Routes
app.use('/', publicRouter);
app.use('/admin', adminRate, adminAuth, adminRouter);

// Fallback 404 for API
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// Centralized error handler (handles multer/pdf errors cleanly)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err) {
    if (err.message === 'pdf_only') {
      return res.status(400).json({ ok: false, error: 'pdf_only' });
    }
    if (err.name === 'MulterError') {
      // e.g., file too large
      const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(code).json({ ok: false, error: err.code || 'upload_error' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`QR Portal server listening on http://localhost:${PORT}`);
});
