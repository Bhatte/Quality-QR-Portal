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
// - DISABLE_AUTH=true: completely disable authentication (for testing)
function adminAuth(req, res, next) {
  const disableAuth = /^(true|1|yes)$/i.test(String(process.env.DISABLE_AUTH || ''));
  if (disableAuth) {
    console.log('[AUTH] Authentication disabled via DISABLE_AUTH environment variable');
    return next();
  }
  
  const easyAuthOn = /^(true|1|yes)$/i.test(String(process.env.EASY_AUTH || ''));
  const mustEnforce = process.env.NODE_ENV === 'production' || easyAuthOn;
  if (!mustEnforce) return next();

  // In Azure App Service with Easy Auth, x-ms-client-principal will be present for authenticated users
  const principal = req.headers['x-ms-client-principal'];
  if (!principal) {
    console.log(`[AUTH] No principal header found for ${req.method} ${req.path}`);
    console.log(`[AUTH] Headers:`, {
      'x-ms-client-principal': req.headers['x-ms-client-principal'] || '[MISSING]',
      'x-requested-with': req.headers['x-requested-with'] || '[MISSING]',
      'accept': req.headers['accept'] || '[MISSING]',
      'content-type': req.headers['content-type'] || '[MISSING]'
    });
    
    // Check if this is an AJAX request (API call)
    const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest' ||
                   req.headers['accept']?.includes('application/json') ||
                   req.headers['content-type']?.includes('application/json') ||
                   req.path.startsWith('/admin/') ||
                   req.method !== 'GET'; // Non-GET requests to admin routes are likely API calls
    
    console.log(`[AUTH] Detected as AJAX request: ${isAjax}`);
    
    if (isAjax) {
      // Return JSON error for AJAX requests
      console.log('[AUTH] Returning JSON authentication error');
      return res.status(401).json({ 
        ok: false, 
        error: 'authentication_required',
        message: 'Azure Easy Auth is required but no principal header found',
        loginUrl: '/.auth/login/aad',
        debug: {
          path: req.path,
          method: req.method,
          hasEasyAuth: !!process.env.EASY_AUTH,
          nodeEnv: process.env.NODE_ENV
        }
      });
    } else {
      // Redirect to Easy Auth login for browser requests
      console.log('[AUTH] Redirecting to Easy Auth login');
      const loginUrl = '/.auth/login/aad';
      const returnUrl = encodeURIComponent(req.originalUrl);
      return res.redirect(`${loginUrl}?post_login_redirect_url=${returnUrl}`);
    }
  }

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
      console.log(`[AUTH] Email validation failed. Email: ${email}, Allowed: ${allow.join(', ')}`);
      
      // Check if this is an AJAX request
      const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest' ||
                     req.headers['accept']?.includes('application/json') ||
                     req.headers['content-type']?.includes('application/json') ||
                     req.path.startsWith('/admin/') ||
                     req.method !== 'GET'; // Non-GET requests to admin routes are likely API calls
      
      if (isAjax) {
        return res.status(403).json({ 
          ok: false, 
          error: 'forbidden',
          message: 'Your email is not in the admin allowlist'
        });
      } else {
        return res.status(403).send('Forbidden: Your email is not in the admin allowlist.');
      }
    }
  } catch (decodeError) {
    console.error('[AUTH] Principal decode error:', decodeError);
    
    // Check if this is an AJAX request
    const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest' ||
                   req.headers['accept']?.includes('application/json') ||
                   req.headers['content-type']?.includes('application/json') ||
                   req.path.startsWith('/admin/') ||
                   req.method !== 'GET'; // Non-GET requests to admin routes are likely API calls
    
    if (isAjax) {
      return res.status(401).json({ 
        ok: false, 
        error: 'authentication_invalid',
        message: 'Unable to decode authentication principal'
      });
    } else {
      return res.status(401).send('Unauthenticated: Unable to decode authentication principal.');
    }
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

// Test endpoint for authentication debugging
app.get('/admin/auth-test', adminAuth, (req, res) => {
  res.json({
    ok: true,
    message: 'Authentication successful',
    headers: {
      'x-requested-with': req.headers['x-requested-with'] || null,
      'accept': req.headers['accept'] || null,
      'content-type': req.headers['content-type'] || null
    },
    principal: req.headers['x-ms-client-principal'] ? 'present' : 'missing',
    method: req.method,
    path: req.path
  });
});

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
