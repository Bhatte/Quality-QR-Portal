# Authentication System Update

## Overview
The QR Portal has been updated from Azure App Service Easy Auth to a robust Passport.js + Azure AD session-based authentication system.

## User Login Flow

### For Administrators
1. **Access Admin Panel**: Navigate to `/admin` or `/admin.html`
2. **Automatic Redirect**: If not logged in, automatically redirected to `/auth/login`
3. **Azure AD Login**: Standard Microsoft login page with company credentials
4. **Session Creation**: Upon successful login, session cookie is created
5. **Return to Admin**: Redirected back to the original admin page
6. **Session Persistence**: Stay logged in for 24 hours (configurable)
7. **Logout**: Click "Logout" button or visit `/auth/logout`

### For Public Users
- No authentication required for viewing documents
- Public routes (`/`, `/folders`, `/docs/*`) remain open
- QR codes continue to work without any login

## Technical Implementation

### Authentication Routes
- `GET /auth/login` - Redirects to Azure AD login
- `POST /auth/callback` - Handles Azure AD response
- `GET /auth/logout` - Logs out and clears session
- `GET /auth/status` - Returns current authentication status

### Session Management
- Uses `express-session` with secure cookies
- Session data stored in memory (suitable for single instance)
- 24-hour session timeout
- Secure cookies in production (HTTPS)

### Admin Protection
- All `/admin/*` routes require authentication
- Email-based admin allowlist via `ADMIN_EMAILS` environment variable
- Graceful handling of AJAX vs browser requests

## Configuration Required

### Environment Variables
```bash
# Azure AD Configuration
AZURE_TENANT_ID=31998f14-4995-40af-8e9a-9e62c284c01c
AZURE_CLIENT_ID=874274e9-b028-40eb-9da6-6228ae8c9de7
AZURE_CLIENT_SECRET=your-client-secret-here
AZURE_REDIRECT_URL=https://your-domain.com/auth/callback

# Admin Access Control
ADMIN_EMAILS=tb500@joneseng.com,other-admin@joneseng.com

# Session Security
SESSION_SECRET=your-super-secret-session-key-change-in-production

# Optional: Disable auth for testing
DISABLE_AUTH=false
```

### Azure AD App Registration
The existing app registration can be reused:
- **Client ID**: `874274e9-b028-40eb-9da6-6228ae8c9de7`
- **Tenant ID**: `31998f14-4995-40af-8e9a-9e62c284c01c`
- **Redirect URI**: Add `https://your-domain.com/auth/callback`

### Azure App Service Configuration
1. **Remove Easy Auth**: Disable App Service Authentication in Azure Portal
2. **Set Environment Variables**: Add the above variables in App Service → Configuration
3. **Install Dependencies**: Run `npm install` to get new packages

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
- ✅ Proper logout with Azure AD session clearing

### Maintainability
- ✅ Well-documented authentication middleware
- ✅ Easy to debug authentication issues
- ✅ Standard Passport.js patterns
- ✅ Clear error messages and logging

## Migration Steps

1. **Install Dependencies**: `npm install` (already updated in package.json)
2. **Configure Environment**: Set Azure AD and session variables
3. **Update Azure AD**: Add redirect URI for `/auth/callback`
4. **Disable Easy Auth**: Turn off App Service Authentication
5. **Deploy and Test**: Verify login/logout flow works
6. **Update Admin Emails**: Ensure `ADMIN_EMAILS` includes all administrators

## Troubleshooting

### Login Issues
- Check Azure AD app registration redirect URI
- Verify `AZURE_TENANT_ID` and `AZURE_CLIENT_ID` are correct
- Ensure `AZURE_CLIENT_SECRET` is valid and not expired

### Session Issues
- Verify `SESSION_SECRET` is set and secure
- Check cookie settings for HTTPS in production
- Confirm session timeout settings

### Admin Access
- Verify user email is in `ADMIN_EMAILS` list
- Check email format matches Azure AD profile
- Review authentication logs for detailed errors

## Rollback Plan
If issues occur, temporarily set `DISABLE_AUTH=true` to bypass authentication while troubleshooting. This allows admin functionality to work while resolving configuration issues.
