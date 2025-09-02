# QR Portal – Deploy Runbook (Single SQLite Database)

This runbook describes how to provision Azure resources, configure the app, package source, and deploy via Zip Deploy to Azure App Service. The application now uses a single SQLite database for both metadata and file storage, eliminating the need for Azure Blob Storage.

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

### 2.4 Configure App Settings (Environment Variables)
1. Go to your Web App in Azure Portal
2. In the left menu, click "Configuration"
3. Click "Application settings" tab
4. Add each setting by clicking "+ New application setting":

   **Setting 1:**
   - Name: `SQLITE_DB_PATH`
   - Value: `/home/data/quality.sqlite`
   - Click "OK"

   **Setting 2:**
   - Name: `ADMIN_EMAILS`
   - Value: `admin1@company.com,admin2@company.com,admin3@company.com` (comma-separated list of admin emails)
   - Click "OK"

   **Setting 3:**
   - Name: `NODE_ENV`
   - Value: `production`
   - Click "OK"

   **Setting 4:**
   - Name: `PUBLIC_BASE_URL`
   - Value: `https://[your-webapp-name].azurewebsites.net` (replace with your actual app URL)
   - Click "OK"

5. Click "Save" at the top
6. Click "Continue" when prompted about app restart

### 2.5 Configure Easy Auth (App Service Authentication)
1. In your Web App, click "Authentication" in the left menu
2. Click "Add identity provider"
3. Select "Microsoft" as the identity provider
4. Fill in:
   - **App registration type**: Create new app registration
   - **Name**: `quality-portal-auth` (or your preferred name)
   - **Supported account types**: Current tenant - Single tenant
   - **Restrict access**: **Allow unauthenticated access** (this is key!)
   - **Unauthenticated requests**: HTTP 302 Found redirect: recommended for websites
5. Click "Add"
6. Wait for the configuration to complete

### 2.6 Understanding the Configuration
With this setup:
- **Public routes** (like `/docs/*`, `/healthz`) work without authentication
- **Admin routes** (`/admin`) will redirect unauthenticated users to Microsoft login
- **After login**, users are redirected back and the app receives the `x-ms-client-principal` header
- **The app code** handles checking if the logged-in user is in the `ADMIN_EMAILS` list

This configuration allows Easy Auth to provide authentication services while letting your application control which routes require authentication.

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

### 5.3 Test Admin Authentication
1. Go to `https://your-app-name.azurewebsites.net/admin`
2. You should be redirected to Microsoft login
3. Sign in with the email you specified in `ADMIN_EMAILS`
4. You should see the admin interface after successful login
5. Try uploading a test PDF file
6. Verify you get a success message and a portal URL

### 5.4 Test Document Access
1. After uploading a document, copy the generated portal URL
2. Open an incognito/private browser window
3. Paste the portal URL
4. The PDF should display directly without requiring authentication

### 5.5 Troubleshooting

#### Authentication Issues
The correct Easy Auth configuration should be:

1. Go to your Web App → Authentication
2. Click "Edit" next to your Microsoft provider
3. Set **Restrict access** to "Allow unauthenticated access"
4. Set **Unauthenticated requests** to "HTTP 302 Found redirect: recommended for websites"
5. Click "Save"

**How this works now:**
- Public routes (like `/docs/*`, `/healthz`) work without authentication
- When you visit `/admin`, the app automatically redirects you to Microsoft login
- After login, you're redirected back to `/admin` and can access the admin interface
- The app checks if your email is in the `ADMIN_EMAILS` list

**If you still get "Unauthenticated":**
This means the app code change hasn't been deployed yet. Redeploy your app with the updated code.

#### Other Common Issues
1. **App not starting**: Check "Configuration" → "Application settings"
2. **Database errors**: Verify `SQLITE_DB_PATH` setting  
3. **Log checking**: Go to Web App → "Log stream" for real-time logs
4. **Multiple admins**: Use comma-separated emails in `ADMIN_EMAILS` (no spaces around commas)

#### Manual Login URL
If automatic redirect doesn't work, you can always login manually by visiting:
`https://your-app-name.azurewebsites.net/.auth/login/aad`

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
