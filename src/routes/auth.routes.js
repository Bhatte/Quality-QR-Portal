const express = require('express');
const passport = require('passport');
const router = express.Router();

// Login route - redirects to Azure AD
router.get('/login', (req, res, next) => {
  console.log('[AUTH] Login requested, redirecting to Azure AD');
  console.log('[AUTH] Session ID:', req.sessionID);
  
  // Store return URL in session
  if (req.query.returnTo) {
    req.session.returnTo = req.query.returnTo;
  }
  
  passport.authenticate('azuread-openidconnect', {
    failureRedirect: '/auth/login?error=1'
  })(req, res, next);
});

// Callback route - handles Azure AD response (POST for form_post mode)
router.post('/callback', (req, res, next) => {
  console.log('[AUTH] POST Callback received from Azure AD');
  console.log('[AUTH] Session ID:', req.sessionID);
  console.log('[AUTH] Request body keys:', Object.keys(req.body || {}));
  
  passport.authenticate('azuread-openidconnect', {
    failureRedirect: '/auth/login?error=1',
    failureFlash: true
  })(req, res, next);
}, (req, res) => {
  // Successful authentication
  console.log(`[AUTH] Login successful for ${req.user.email}`);
  
  // Redirect to original URL or admin dashboard
  const returnTo = req.session.returnTo || '/admin';
  delete req.session.returnTo;
  res.redirect(returnTo);
});

// Also handle GET for fallback compatibility
router.get('/callback', (req, res, next) => {
  console.log('[AUTH] GET Callback received from Azure AD');
  console.log('[AUTH] Session ID:', req.sessionID);
  console.log('[AUTH] Query params:', Object.keys(req.query || {}));
  
  passport.authenticate('azuread-openidconnect', {
    failureRedirect: '/auth/login?error=1',
    failureFlash: true
  })(req, res, next);
}, (req, res) => {
  // Successful authentication
  console.log(`[AUTH] Login successful for ${req.user.email}`);
  
  // Redirect to original URL or admin dashboard
  const returnTo = req.session.returnTo || '/admin';
  delete req.session.returnTo;
  res.redirect(returnTo);
});

// Logout route
router.get('/logout', (req, res) => {
  const userEmail = req.user?.email || 'unknown';
  console.log(`[AUTH] Logout requested for ${userEmail}`);
  
  req.logout((err) => {
    if (err) {
      console.error('[AUTH] Logout error:', err);
      return res.status(500).json({ error: 'logout_failed' });
    }
    
    req.session.destroy((err) => {
      if (err) {
        console.error('[AUTH] Session destroy error:', err);
      }
      
      // Redirect to Azure AD logout to clear SSO session
      const logoutUrl = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(process.env.PUBLIC_BASE_URL || 'http://localhost:3000')}`;
      res.redirect(logoutUrl);
    });
  });
});

// Login error page
router.get('/login', (req, res) => {
  const error = req.query.error;
  if (error) {
    return res.status(401).json({
      error: 'authentication_failed',
      message: 'Login failed. Please try again.',
      loginUrl: '/auth/login'
    });
  }
  
  // This shouldn't normally be reached as GET /login redirects to Azure AD
  res.redirect('/auth/login');
});

// Status endpoint for debugging
router.get('/status', (req, res) => {
  res.json({
    authenticated: req.isAuthenticated(),
    user: req.isAuthenticated() ? {
      email: req.user.email,
      name: req.user.name
    } : null,
    session: !!req.session
  });
});

module.exports = router;
