const passport = require('passport');
const OIDCStrategy = require('passport-azure-ad').OIDCStrategy;

// Configure Passport Azure AD strategy
function configurePassport() {
  const strategy = new OIDCStrategy({
    identityMetadata: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/.well-known/openid_configuration`,
    clientID: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    responseType: 'code',
    responseMode: 'query',
    redirectUrl: process.env.AZURE_REDIRECT_URL || `${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/auth/callback`,
    allowHttpForRedirectUrl: process.env.NODE_ENV !== 'production',
    validateIssuer: true,
    passReqToCallback: false,
    scope: ['profile', 'email'],
    loggingLevel: 'info'
  }, (iss, sub, profile, accessToken, refreshToken, done) => {
    // Extract user information from Azure AD profile
    const user = {
      id: profile.oid,
      email: profile.preferred_username || profile.upn || profile.email,
      name: profile.name,
      provider: 'azure-ad'
    };
    
    console.log(`[AUTH] User authenticated: ${user.email}`);
    return done(null, user);
  });

  passport.use('azuread-openidconnect', strategy);

  // Serialize user for session storage
  passport.serializeUser((user, done) => {
    done(null, user);
  });

  // Deserialize user from session
  passport.deserializeUser((user, done) => {
    done(null, user);
  });

  return passport;
}

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  
  // Store the original URL for redirect after login
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
}

// Middleware to check if user is admin
function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase());
  const userEmail = (req.user.email || '').toLowerCase();
  
  if (!adminEmails.length || !adminEmails.includes(userEmail)) {
    console.log(`[AUTH] Access denied for ${userEmail}. Admin emails: ${adminEmails.join(', ')}`);
    return res.status(403).json({ 
      error: 'access_denied', 
      message: 'Admin access required',
      loginUrl: '/auth/login'
    });
  }

  console.log(`[AUTH] Admin access granted for ${userEmail}`);
  next();
}

module.exports = {
  configurePassport,
  requireAuth,
  requireAdmin
};
