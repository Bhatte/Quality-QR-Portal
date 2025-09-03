# Authentication System Update

## Overview
The QR Portal has been migrated to a simple, robust local-only authentication system using Express sessions. Azure AD and Easy Auth are no longer used. Admin access is controlled via an email allowlist plus a shared access code.

## User Login Flow

### For Administrators
1. **Access Admin Panel**: Navigate to `/admin` or `/admin.html`
2. **Automatic Redirect**: If not logged in, automatically redirected to `/login.html`
3. **Local Login**: Enter your email (must be in `ADMIN_USERS`) and the shared `LOCAL_ACCESS_CODE`
4. **Session Creation**: Upon successful login, a session cookie is created
5. **Return to Admin**: Automatically redirected back to the original admin page
6. **Session Persistence**: Stays logged in for 24 hours (configurable)
7. **Logout**: Click "Logout" or visit `/auth/logout`

### For Public Users
- No authentication required for viewing documents
- Public routes (`/`, `/folders`, `/docs/*`) remain open
- QR codes continue to work without any login

## Technical Implementation

### Authentication Routes
- `GET /auth/login` - Redirects to `/login.html`
- `POST /auth/local/login` - Validates email + access code and creates a session
- `GET /auth/logout` - Destroys session and redirects to login
- `GET /auth/status` - Returns current authentication status

### Session Management
- Uses `express-session` with secure cookies
- Session data stored in memory (suitable for single instance)
- 24-hour session timeout
- Secure cookies in production (HTTPS)

### Admin Protection
- All `/admin/*` routes require authentication
- Email-based admin allowlist via `ADMIN_USERS` environment variable
- Graceful handling of AJAX vs browser requests

## Configuration Required

### Environment Variables
```bash
# Local Authentication
AUTH_MODE=local
ADMIN_USERS=admin@example.com,manager@example.com
LOCAL_ACCESS_CODE=change-me-to-a-long-random-string

# Session Security
SESSION_SECRET=your-super-secret-session-key-change-in-production

# Optional: Disable auth for testing
DISABLE_AUTH=false
```

### Azure AD App Registration
Not required. All Azure AD references have been removed.

### Azure App Service Configuration
1. Ensure App Service Authentication is not enforcing a provider
2. Set environment variables above in App Service → Configuration
3. Install dependencies and deploy as usual

## Benefits of New System

### Reliability
- ✅ No more 403 errors from token audience mismatches
- ✅ Standard session-based authentication pattern
- ✅ Full control over authentication flow
- ✅ Proper error handling and debugging

### Simplicity
- ✅ No complex token management in frontend
- ✅ Standard cookies handle authentication
- ✅ Clean separation of public vs admin routes
- ✅ Familiar login/logout user experience

### Security
- ✅ Secure session cookies with HttpOnly flag
- ✅ HTTPS enforcement in production
- ✅ Admin email allowlist validation
- ✅ Proper logout with server-side session destruction

### Maintainability
- ✅ Well-documented authentication middleware
- ✅ Easy to debug authentication issues
- ✅ Standard Passport.js patterns
- ✅ Clear error messages and logging

## Migration Steps

1. Remove any Azure AD-related environment variables from your configuration
2. Set `AUTH_MODE=local`, `ADMIN_USERS`, `LOCAL_ACCESS_CODE`, and `SESSION_SECRET`
3. Deploy and test: visit `/admin` to ensure redirect to `/login.html` and successful login
4. Update admin allowlist as needed

## Troubleshooting

### Login Issues
- Verify your email is present in `ADMIN_USERS`
- Ensure `LOCAL_ACCESS_CODE` is correct

### Session Issues
- Verify `SESSION_SECRET` is set and secure
- Check cookie settings for HTTPS in production
- Confirm session timeout settings

### Admin Access
- Verify user email is in `ADMIN_USERS`
- Review authentication logs for detailed errors

## Rollback Plan
If issues occur, temporarily set `DISABLE_AUTH=true` to bypass authentication while troubleshooting. This allows admin functionality to work while resolving configuration issues.
