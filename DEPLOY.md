# QR Portal – Azure App Service Deployment (Local Auth)

This guide explains how to deploy the QR Portal to Azure App Service using local-only authentication. The app uses a single SQLite database for both metadata and file storage, and session-based authentication with an admin email allowlist plus a shared access code. No Azure AD configuration is required.

## 1) Prerequisites

- Azure subscription + permissions
- Azure CLI (optional but strongly recommended)
- Node.js 18+ (local only)
- Project files (this repo)

## 2) Azure Resources Setup (Azure Portal GUI)

### 2.1 Create Resource Group
1. Go to [Azure Portal](https://portal.azure.com)
2. Click "Resource groups" in the left menu
3. Click "+ Create"
4. Fill in:
   - **Subscription**: Select your subscription
   - **Resource group**: `rg-quality-portal` (or your preferred name)
   - **Region**: Choose your preferred region (e.g., East US)
5. Click "Review + create" → "Create"

### 2.2 Create App Service Plan
1. In Azure Portal, click "+ Create a resource"
2. Search for "App Service Plan" and select it
3. Click "Create"
4. Fill in:
   - **Subscription**: Your subscription
   - **Resource Group**: Select `rg-quality-portal` (created above)
   - **Name**: `asp-quality-portal` (or your preferred name)
   - **Operating System**: Linux
   - **Region**: Same as your resource group
   - **Pricing Tier**: Click "Change size" → Select "Production" tab → Choose "B1" or "B2"
5. Click "Review + create" → "Create"
6. Wait for deployment to complete

### 2.3 Create Web App
1. In Azure Portal, click "+ Create a resource"
2. Search for "Web App" and select it
3. Click "Create"
4. Fill in **Basics** tab:
   - **Subscription**: Your subscription
   - **Resource Group**: Select `rg-quality-portal`
   - **Name**: Choose a unique name (e.g., `quality-portal-[yourname]`)
   - **Publish**: Code
   - **Runtime stack**: Node 18 LTS
   - **Operating System**: Linux
   - **Region**: Same as your resource group
   - **App Service Plan**: Select the plan you created (`asp-quality-portal`)
5. Click "Next: Deployment" → Skip this tab (click "Next: Networking")
6. Click "Next: Monitoring" → Skip this tab (click "Next: Tags")
7. Click "Next: Review + create" → "Create"
8. Wait for deployment to complete (this may take a few minutes)

### 2.4 Authentication Setup
No Azure AD or identity provider setup is required. The application handles authentication locally using:
- `ADMIN_USERS` (comma-separated admin email allowlist)
- `LOCAL_ACCESS_CODE` (shared access code)

### 2.5 Configure App Settings (Environment Variables)
1. Go to your Web App in Azure Portal
2. In the left menu, click "Configuration"
3. Click "Application settings" tab
4. Add each setting by clicking "+ New application setting":

   **Database Configuration:**
   - Name: `SQLITE_DB_PATH`
   - Value: `/home/data/quality.sqlite`

   **Authentication Configuration (Local-only):**
   - Name: `AUTH_MODE`
   - Value: `local`

   - Name: `ADMIN_USERS`
   - Value: `admin@company.com,other-admin@company.com` (comma-separated, no spaces)

   - Name: `LOCAL_ACCESS_CODE`
   - Value: `[a long random string]`

   **Application Configuration:**
   - Name: `NODE_ENV`
   - Value: `production`
   
   - Name: `PUBLIC_BASE_URL`
   - Value: `https://[your-webapp-name].azurewebsites.net`
   
   - Name: `SESSION_SECRET`
   - Value: `[generate-a-long-random-string-here]` (use a password generator for 32+ characters)

5. Click "Save" at the top
6. Click "Continue" when prompted about app restart

### 2.6 App Service Authentication
No built-in provider configuration is required. Ensure App Service Authentication is not enforcing a provider so the app can manage sessions internally.

## 3) Zip Package (What to include)

Include only source files required to run:
- `index.js`, `package.json`, `package-lock.json`
- `public/`, `src/`

Do NOT include:
- `node_modules/` (App Service will install from `package.json`)
- `.env` (use App Settings instead)
- Local data: `data/`

Create zip from repo root (PowerShell):
```powershell
Compress-Archive -Path index.js,package*.json,public,src -DestinationPath deploy/qr-portal.zip -Force
```

Create zip from repo root (bash):
```bash
zip -r deploy/qr-portal.zip index.js package*.json public src -x "node_modules/*" ".env" "data/*"
```

## 4) Deploy via Zip Deploy (Azure Portal)

### 4.1 Create Deployment Package
1. Open PowerShell in your project root directory
2. Create a deploy folder:
   ```powershell
   mkdir deploy -Force
   ```
3. Create the zip package:
   ```powershell
   Compress-Archive -Path index.js,package*.json,public,src -DestinationPath deploy/qr-portal.zip -Force
   ```

### 4.2 Deploy via Azure Portal
1. Go to your Web App in Azure Portal
2. In the left menu, click "Deployment Center"
3. Click "FTPS credentials" tab and note the deployment URL (you won't need credentials for zip deploy)
4. Go back to "Deployment Center" main page
5. Look for "Zip Deploy" section or click "Browse" if you see a file upload area
6. Click "Browse" or "Choose file"
7. Select your `deploy/qr-portal.zip` file
8. Click "Deploy" or "Upload"
9. Wait for deployment to complete (you'll see progress messages)
10. The system will automatically run `npm install` and start your app

### 4.3 Alternative: Advanced Tools (Kudu)
If the above doesn't work:
1. In your Web App, click "Advanced Tools" in the left menu
2. Click "Go" to open Kudu
3. Click "Tools" → "Zip Push Deploy"
4. Drag and drop your `deploy/qr-portal.zip` file to the `/wwwroot` area
5. Wait for deployment to complete

## 5) Post-Deploy Testing

### 5.1 Basic Health Check
1. Go to your Web App overview page in Azure Portal
2. Copy the "Default domain" URL (e.g., `https://your-app-name.azurewebsites.net`)
3. Open a new browser tab and test these URLs:
   - `https://your-app-name.azurewebsites.net/healthz` → Should show `{ "ok": true }`
   - `https://your-app-name.azurewebsites.net/readyz` → Should show `{ "ok": true, "status": "ready" }`

### 5.2 Test Public Access
1. Go to `https://your-app-name.azurewebsites.net`
2. You should see the QR Portal homepage
3. This should work without authentication (public access)

### 5.3 Test Admin Authentication (Local)
1. Go to `https://your-app-name.azurewebsites.net/admin`
2. You will be redirected to the local login page `/login.html`
3. Sign in using an email present in `ADMIN_USERS` and the `LOCAL_ACCESS_CODE`
4. After successful login, you will be redirected back to the admin interface
5. You should see your email and a "Logout" button
6. Try creating a folder and uploading a test PDF file
7. Verify you get a success message and a portal URL

### 5.4 Test Document Access
1. After uploading a document, copy the generated portal URL
2. Open an incognito/private browser window
3. Paste the portal URL
4. The PDF should display directly without requiring authentication

### 5.5 Troubleshooting

#### Database/Folder Creation Issues
If folders appear to be created but don't show up in the UI:

**Step 1: Check Database Status**
1. Visit `https://your-app-name.azurewebsites.net/debug/info`
2. This will show you database path, file system status, and current folder count
3. Look for any errors in the response

**Step 2: Check App Logs**
1. In Azure Portal, go to your Web App
2. Click "Log stream" in the left menu
3. Try creating a folder while watching the logs
4. Look for any error messages

**Step 3: Verify Environment Variables**
1. Go to Web App → Configuration → Application settings
2. Verify `SQLITE_DB_PATH` is set to `/home/data/quality.sqlite`
3. Check that other settings are correct

**Step 4: Test Database Connectivity**
1. Visit `https://your-app-name.azurewebsites.net/readyz`
2. Should return `{"ok":true,"status":"ready"}`
3. If not, there's a database connection issue

**Common Database Issues:**
- **Permission errors**: The `/home/data/` directory should be writable in Azure App Service
- **Path issues**: Make sure `SQLITE_DB_PATH` uses forward slashes: `/home/data/quality.sqlite`
- **Memory issues**: B1/B2 App Service Plan should have sufficient memory for SQLite

#### Authentication Issues (Local)

1. **Admin Email Not Authorized**
   - Ensure your login email exactly matches one in `ADMIN_USERS`
   - No spaces around commas; email comparison is case-insensitive

2. **Invalid Access Code**
   - Verify `LOCAL_ACCESS_CODE` matches what you enter on the login form

3. **Session Issues**
   - Ensure `SESSION_SECRET` is set to a long, random string
   - Try clearing browser cookies and logging in again

**Test Authentication Status:**
Visit `https://your-app-name.azurewebsites.net/auth/status` to see current authentication state.

#### Folder Creation Issues (Advanced Debugging)
If folders appear to be created but don't persist:

**Test Database Transactions:**
1. `POST /debug/test-folder` - Tests direct database operations with transactions
2. `POST /debug/create-folder/testfolder` - Tests the full folder creation flow
3. `GET /debug/info` - Check folder count before and after

**Expected Results:**
- `writeTest.success` should be `true`
- `folderCount` should increase after folder creation
- `rawFolderQuery` should show the created folders

**Common Issues:**
- **WAL mode problems**: SQLite Write-Ahead Logging not syncing properly
- **Transaction isolation**: Changes not being committed properly
- **File system sync**: Database changes not persisting to disk

#### Other Common Issues
1. **App not starting**: Check "Configuration" → "Application settings"
2. **Multiple admins**: Use comma-separated emails in `ADMIN_EMAILS` (no spaces around commas)
3. Remove any references to Azure AD login; the app uses only local auth.

#### SSH Troubleshooting (Advanced)
If you have SSH access to your Azure App Service:

**Connect to SSH:**
1. In Azure Portal, go to your Web App
2. Click "SSH" in the left menu or "Advanced Tools" → "Go" → "SSH"
3. Or use direct SSH if configured

**Check Database and File System:**
```bash
# Navigate to app directory
cd /home/site/wwwroot

# Check if data directory exists and permissions
ls -la /home/data/
ls -la /home/data/quality.sqlite

# Check current working directory and app files
pwd
ls -la

# Check environment variables
env | grep SQLITE
env | grep NODE_ENV

# Check if Node.js process is running
ps aux | grep node

# Check app logs
tail -f /home/LogFiles/Application/console.log

# Test database file creation manually
touch /home/data/test.txt
ls -la /home/data/

# Check disk space
df -h

# Check memory usage
free -m
```

**Manual Database Test:**
```bash
# Test database directly with Node.js (fixed quotes)
node -e "
const Database = require('better-sqlite3');
const db = new Database('/home/data/quality.sqlite');
console.log('Database opened successfully');

// Check tables
const tables = db.prepare('SELECT name FROM sqlite_master WHERE type=?').all('table');
console.log('Tables:', tables);

// Check folders
const folders = db.prepare('SELECT * FROM folders').all();
console.log('Current folders:', folders);

// Test insert
try {
  const result = db.prepare('INSERT INTO folders (name, display_name) VALUES (?, ?)').run('test-manual', 'Manual Test');
  console.log('Insert result:', result);
  
  const check = db.prepare('SELECT * FROM folders WHERE name = ?').get('test-manual');
  console.log('Verification:', check);
  
  db.prepare('DELETE FROM folders WHERE name = ?').run('test-manual');
  console.log('Cleanup completed');
} catch (e) {
  console.error('Insert test failed:', e);
}

db.close();
"

# Check database file integrity
file /home/data/quality.sqlite

# Check database file size and permissions
ls -lah /home/data/quality.sqlite

# Monitor logs while testing folder creation
tail -f /home/LogFiles/Application/console.log &
# Then in another terminal/session, test folder creation via the web UI
```

**Check App Service Logs:**
```bash
# Application logs
tail -f /home/LogFiles/Application/console.log

# System logs  
tail -f /home/LogFiles/System/docker.log

# Check for any permission errors
grep -i "permission\|denied\|error" /home/LogFiles/Application/console.log
```

#### Force App Restart
If issues persist:
1. Go to Web App → Overview
2. Click "Restart" 
3. Wait for restart to complete
4. Test functionality again

## 6) Operational Notes

- **Single Database File**: All data and files are stored in `/home/data/quality.sqlite` (App Service file system). App auto-creates folder/file on first use; no manual step needed.
- **File Storage**: PDF files are stored as BLOBs directly in the SQLite database, eliminating external dependencies.
- **Security**: Files are served through the application with proper authentication checks and security headers.
- **Performance**: Optimized for small-scale usage (20-30 documents) with efficient SQLite queries and caching headers.
- **Logs**: Basic request logs available via App Service Log Stream.
- **Scaling**: B1/B2 App Service Plan is sufficient for expected usage patterns.

**Backups**: Back up `/home/data/quality.sqlite` periodically (App Service backup or custom job). This single file contains all application data and uploaded documents.

## 7) Rollback

- Keep the previous zip artifact. Re-deploy the last known-good zip via Deployment Center or CLI.
- If Storage or DB paths change, revert App Settings accordingly.
