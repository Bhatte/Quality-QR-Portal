const passport = require('passport');

// Local-only configuration: keep simple (de)serializers for session compatibility
function configurePassport() {
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));
  return passport;
}

// Middleware to check if user is authenticated (local sessions)
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  req.session.returnTo = req.originalUrl;
  return res.redirect('/auth/login');
}

// Middleware to check if user is admin (local allowlist)
function requireAdmin(req, res, next) {
  const userEmail = String(req.session?.user?.email || '').toLowerCase();
  const adminUsers = (process.env.ADMIN_USERS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  if (!userEmail) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }

  if (!adminUsers.length || !adminUsers.includes(userEmail)) {
    console.log(`[AUTH] Access denied for ${userEmail}. Admin users: ${adminUsers.join(', ')}`);
    return res.status(403).json({
      error: 'access_denied',
      message: 'Admin access required',
      loginUrl: '/auth/login'
    });
  }

  console.log(`[AUTH] Admin access granted (local) for ${userEmail}`);
  return next();
}

module.exports = {
  configurePassport,
  requireAuth,
  requireAdmin
};
