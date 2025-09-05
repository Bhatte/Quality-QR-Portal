require('dotenv').config();
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const passport = require('passport');

// Import authentication configuration
const { configurePassport, requireAdmin } = require('./src/auth/passport-config');
const publicRouter = require('./src/routes/public.routes');
const adminRouter = require('./src/routes/admin.routes');
const authRoutes = require('./src/routes/auth.routes');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Configure Passport
configurePassport();

// Session configuration - enhanced for Azure App Service
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-super-secret-key-change-in-production',
  resave: false,
  saveUninitialized: true,
  name: IS_PROD ? '__Host-qr-portal-session' : 'qr-portal-session',
  cookie: {
    secure: IS_PROD,
    httpOnly: true,
    maxAge: 10 * 60 * 1000, // 10 minutes of inactivity
    sameSite: IS_PROD ? 'lax' : 'lax',
    path: '/'
  },
  rolling: true
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Basic security & logging
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
// Enable HSTS in production
if (IS_PROD) {
  app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));
}
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Static serving is defined later (after admin gate) to protect /admin.html

// Add request logging for debugging
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path} - Session: ${req.sessionID}`);
  next();
});

// Basic health endpoints
app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});
app.get('/readyz', (req, res) => {
  res.json({ ok: true, status: 'ready' });
});

// CSRF double-submit protection for admin state-changing requests
app.use((req, res, next) => {
  // Ensure CSRF token exists in session
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  // Set readable cookie for frontend to read (Lax prevents most CSRF on GETs)
  res.cookie('XSRF-TOKEN', req.session.csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
  });

  // Enforce for admin mutating requests
  const isAdminPath = req.path.startsWith('/admin/');
  const method = (req.method || 'GET').toUpperCase();
  const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (isAdminPath && isMutating) {
    const token = req.get('x-csrf-token');
    if (!token || token !== req.session.csrfToken) {
      return res.status(403).json({ ok: false, error: 'csrf_invalid' });
    }
  }
  return next();
});

// Trust proxy when running behind load balancers / App Service
app.set('trust proxy', true);

// Serve admin UI behind auth
app.get(['/admin', '/admin.html'], requireAdmin, (req, res) => {
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

// Admin authentication middleware - now uses Passport.js sessions
function adminAuth(req, res, next) {
  const disableAuth = /^(true|1|yes)$/i.test(String(process.env.DISABLE_AUTH || ''));
  if (disableAuth) {
    console.log('[AUTH] Authentication disabled via DISABLE_AUTH environment variable');
    return next();
  }
  
  // Use new Passport-based authentication
  return requireAdmin(req, res, next);
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
// Authentication routes
app.use('/auth', authRoutes);

// Public routes (no authentication required)
app.use('/', publicRouter);

// Admin routes (authentication required)
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
