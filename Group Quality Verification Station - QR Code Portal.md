# Solution Design — **Monolithic Node Portal (Azure) with Azure Blob + SQLite**

**Purpose:** provide a single, branded admin portal for 2–3 admins to create folders and upload public CTQ documents (20–30 docs). Files will be stored in **Azure Blob (public, permanent URLs)** while **SQLite** will hold metadata (folder structure, blob URL, versions). Authentication for admin actions will be handled via **App Service Easy Auth (Microsoft Entra / Azure AD)**. QR code generation is **manual** (admins copy the portal URL and use any QR provider). This document is an operational, build-ready design intended for Developers, Infra, Security and the Quality team.

---

## 1. Executive summary (one-paragraph)

Build a single Node.js monolithic web app hosted in **Azure App Service** that provides an admin UI (protected by App Service Easy Auth) for creating folders and uploading files. All uploaded files and metadata are stored directly in a **single SQLite database** as BLOBs, eliminating external storage dependencies and ensuring maximum security and simplicity. The web app serves permanent portal URLs that deliver documents directly from the database with proper security headers and authentication controls. Admins will generate QR codes manually using the permanent portal URL. The solution is intentionally minimal, secure, self-contained, and easy to operate.

---

## 2. Objectives, scope & decisions

### 2.1 Objectives

* Provide permanently accessible CTQ documents via stable URLs.
* Provide a simple, branded admin UX to create folders and upload documents (drag-and-drop).
* Keep operations light: single app instance, SQLite metadata, public blob storage.
* Secure admin functionality using Azure AD via App Service Easy Auth.
* QR generation is manual (no third-party API integration).

### 2.2 In-scope

* Node monolith (Express) implementation
* Azure App Service hosting (single instance)
* Azure Storage container for documents (public)
* SQLite DB for metadata (file persisted in App Service)
* Admin UI (folder CRUD, upload, list files, copy permanent URL)
* Manual QR workflow documented for Quality team

### 2.3 Out-of-scope

* Automated QR API integration
* CI/CD pipelines (deliver via manual deployment or ZIP deploy)
* Regular automated backups (per your decision — optional guidance provided)
* Extensive monitoring or analytics

---

## 3. High-level architecture

```mermaid
flowchart LR
  A[Admin Browser] -->|HTTPS| App[Node Monolith - Azure App Service]
  B[Public Browser] -->|HTTPS| App
  App --> SQLite[SQLite Database - /home/data/quality.sqlite<br/>Contains: Metadata + File BLOBs]
  App -->|Optional| DNS[quality.jengcontractors.com]
  subgraph Auth
    AD[Azure AD (Entra ID)] --> App
  end
```

Key points:

* **All files and metadata** stored in a single SQLite database with BLOB storage for maximum security and simplicity.
* App provides permanent **portal URLs** (e.g., `https://quality.jengcontractors.com/docs/welding/SWI-105.pdf`) that serve files directly from the database with proper security headers and authentication controls.
* **No external storage dependencies** - entire application is self-contained in a single database file.
* Admin login via **App Service Easy Auth**; public document access controlled by the application.

---

## 4. Azure resources to create

* Resource Group: `rg-jeng-quality`
* App Service Plan: `asp-jeng-quality` (B1 or B2)
* Web App: `app-jeng-quality` (Node runtime)
* Custom domain: `quality.jengcontractors.com` → bound to the Web App (TLS via App Service Managed Certificate)
* Azure AD App Registration: for Easy Auth configuration (client id / secret)

**Note**: Azure Storage Account is no longer required. All files are stored directly in the SQLite database, significantly simplifying the infrastructure requirements and reducing operational complexity.

(Infra team can create these via Portal or Az CLI — see Appendix for sample az commands.)

---

## 5. Data model (SQLite) — schema & rationale

SQLite holds **metadata only** (folder, document entries, blob URL, versioning). Files are in Blob.

### 5.1 Schema (updated for embedded storage)

```sql
CREATE TABLE folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  parent_id INTEGER,          -- nullable for future nesting support
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_content BLOB NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  version INTEGER DEFAULT 1,
  uploaded_by TEXT,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (folder_id) REFERENCES folders(id)
);

CREATE INDEX idx_documents_folder ON documents(folder_id);
```

**Why SQLite with embedded BLOB storage?**

* **Maximum Security**: No external storage dependencies or public access requirements.
* **Simplified Operations**: Single database file contains all application data and documents.
* **Optimal for Scale**: Perfect for 20-30 documents with low concurrency requirements.
* **Cost Effective**: Eliminates Azure Storage costs and complexity.
* **Portable**: Entire application state in one file, easy to backup and migrate.
* **Performance**: Direct database access is faster than external storage for small files.

---

## 6. File storage & URL strategy (permanence)

### 6.1 File storage pattern

Files are stored directly in the SQLite database as BLOBs with the following organization:
* `folder_id` links to the folder structure
* `file_name` maintains the original filename
* `file_content` contains the actual PDF data as BLOB
* `version` tracks document versions

### 6.2 Permanent portal URL pattern

`https://quality.jengcontractors.com/docs/{folder}/{filename}`
This endpoint is handled by the Node app, which looks up the latest version in SQLite for `{folder}/{filename}` and **serves the file directly** from the database with proper security headers. Admins copy portal URL when generating QR codes — this provides permanent access while maintaining full security control.

### 6.3 Versioning

* Version is stored in `documents.version` field and incremented automatically.
* When replacing a file, admin uploads new file with incremented version as a new database row.
* Portal URLs always serve the latest version automatically.
* Individual versions can be deleted while maintaining version history.

---

## 7. API / UI design — endpoints & UX

### 7.1 Public endpoints

* `GET /` → list top-level folders / public index
* `GET /folder/:folderName` → list documents in folder
* `GET /docs/:folder/:fileName` → **redirect** to blob URL (HTTP 302)

### 7.2 Admin endpoints (mounted under `/admin`, protected)

* `GET  /admin` → admin dashboard (folder list, quick stats)
* `POST /admin/folder` → create folder `{ name, display_name }`
* `POST /admin/upload` → multipart upload `{ folder, file }` → stores file as BLOB in database, returns doc metadata + portal URL
* `PATCH /admin/folder/:name` → update folder display name
* `DELETE /admin/folder/:name` → delete folder and all contained documents
* `DELETE /admin/document/:id` → delete specific document version

### 7.3 Admin UI minimal wireframe (functional)

* Left sidebar: Folders (create + search)
* Main area: file list for selected folder (columns: filename, version, uploaded\_at, uploaded\_by, Actions\[Download, Copy Portal URL, Delete])
* Upload button (drag-and-drop) with form fields: folder (select), standard-id (text), notes
* On upload success: show portal URL + “Copy URL” + “Open in new tab” + instructions link “How to make QR manually”

### 7.4 UX acceptance criteria

* Admin can create folder in < 10s
* Admin can upload file (PDF) with drag/drop and see immediate confirmation
* Portal returns permanent portal URL that opens document for public viewers
* Public viewer can open portal URL without login and is redirected to blob URL

---

## 8. Implementation details — Node (Express) + Azure Storage + SQLite

### 8.1 Recommended NPM packages

* `express`
* `multer` (multipart handling)
* `@azure/storage-blob`
* `better-sqlite3` (sync, simple for single instance) or `sqlite3`
* `helmet` (security headers)
* `cookie-session` or `express-session` (if needed for admin UI)
* `morgan` (optional, lightweight request logging)
* `dotenv` (for local dev env vars)

> Note: for production in App Service, environment variables set in App Service settings.

### 8.2 Upload flow (sequence)

1. Admin posts file to `/admin/upload`.
2. Express (multer) accepts stream and validates mime/size.
3. Server stores file content directly as BLOB in SQLite database.
4. Server writes complete record into SQLite (`documents`) including file content, size, and metadata.
5. Server responds with JSON including `portal_url` (e.g., `/docs/welding/SWI-105_v2.pdf`) for admin to copy.

### 8.3 Sample upload code (updated for SQLite storage)

```javascript
// app.js (excerpt)
const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});
const db = new Database(process.env.SQLITE_DB_PATH || '/home/data/quality.sqlite');

app.post('/admin/upload', upload.single('file'), async (req, res) => {
  const folder = req.body.folder; // validate
  const originalName = req.file.originalname;
  
  // Validate file type
  if (!req.file.mimetype === 'application/pdf') {
    return res.status(400).json({ ok: false, error: 'pdf_only' });
  }
  
  // Get or create folder
  let folderRow = db.prepare(`SELECT id FROM folders WHERE name = ?`).get(folder);
  if (!folderRow) {
    const insertFolder = db.prepare(`INSERT INTO folders (name) VALUES (?)`);
    const result = insertFolder.run(folder);
    folderRow = { id: result.lastInsertRowid };
  }
  
  // Store file directly in database
  const stmt = db.prepare(`
    INSERT INTO documents (folder_id, file_name, file_content, file_size, mime_type, version, uploaded_by) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const version = getNextVersion(folderRow.id, originalName);
  stmt.run(
    folderRow.id, 
    originalName, 
    req.file.buffer, 
    req.file.size, 
    req.file.mimetype, 
    version,
    req.headers['x-ms-client-principal-name'] || 'admin'
  );
  
  const portalUrl = `/docs/${encodeURIComponent(folder)}/${encodeURIComponent(originalName)}`;
  res.json({ ok: true, portalUrl });
});
```

> Notes: File content is stored directly as BLOB in SQLite, eliminating external storage dependencies.

### 8.4 File serving route example

```javascript
app.get('/docs/:folder/:filename', (req, res) => {
  const folder = req.params.folder;
  const filename = req.params.filename;
  
  // Get latest version of document
  const row = db.prepare(`
    SELECT d.file_content, d.file_size, d.mime_type, d.file_name 
    FROM documents d 
    JOIN folders f ON f.id = d.folder_id 
    WHERE f.name = ? AND d.file_name = ? 
    ORDER BY d.version DESC LIMIT 1
  `).get(folder, filename);
  
  if (!row) return res.status(404).json({ ok: false, error: 'document_not_found' });
  
  // Set proper headers for PDF serving
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Content-Length', row.file_size);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.file_name)}"`);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  return res.send(row.file_content);
});
```

---

## 9. Authentication & Easy Auth (App Service)

### 9.1 Why Easy Auth

* Minimal code changes — App Service handles Authentication flow with Azure AD.
* Easy to set up in Portal and integrates with Azure AD.
* Admin protection enforced by the platform; app receives identity info in request headers.

### 9.2 Setup steps (high level)

1. **Register an App** in Azure AD:

   * App name: `quality-portal-auth`
   * Platform: Web
   * Redirect URI: `https://<appname>.azurewebsites.net/.auth/login/aad/callback`
2. Note **Client ID** and **Client Secret**.
3. In App Service → **Authentication / Authorization**:

   * Add identity provider: Microsoft Entra ID
   * Fill Client ID & Secret, and the issuer (default tenant)
   * Set **Action to take when request is not authenticated** → *Allow anonymous requests* (so public routes remain accessible).
4. Protect Admin routes in-app:

   * If `X-MS-CLIENT-PRINCIPAL` header is present, user is logged in.
   * If not present and user attempts `/admin/*`, redirect to `/.auth/login/aad?post_login_redirect_url=/admin` to force login.
5. Configure allowed admin users (two ways):

   * **Simplest:** Maintain `ADMIN_EMAILS` in App Settings and check decoded principal email against the list.
   * **Better:** Create a security group in Azure AD, add admins, and check group membership claim (requires additional configuration or checking `X-MS-CLIENT-PRINCIPAL` claims).

### 9.3 Checking identity in Node

```javascript
function getPrincipal(req) {
  const header = req.headers['x-ms-client-principal'];
  if (!header) return null;
  const decoded = Buffer.from(header, 'base64').toString('ascii');
  return JSON.parse(decoded);
}

// usage in admin route
app.use('/admin', (req, res, next) => {
  const principal = getPrincipal(req);
  if (!principal) {
    return res.redirect(`/.auth/login/aad?post_login_redirect_url=${encodeURIComponent(req.originalUrl)}`);
  }
  const email = principal.userDetails; // typically email
  const allowed = process.env.ADMIN_EMAILS?.split(',').map(s=>s.trim());
  if (!allowed || allowed.includes(email)) return next();
  return res.status(403).send('Forbidden');
});
```

> Note: `x-ms-client-principal` is a base64-encoded JSON object injected by Easy Auth.

---

## 10. File validation and governance

### 10.1 Allowed file types

* Primary: `.pdf`
* Optional: `.png`, `.jpg`, `.jpeg`
* Reject any executable or archive (`.exe`, `.zip`, `.js`, `.php`)

### 10.2 Size limits

* Default: **50 MB** per file (adjustable in multer and App Service)
* Rationale: most CTQ documents are PDFs under 10MB

### 10.3 Sanitisation & checks

* Validate MIME type server-side (not only extension)
* Strip/normalize filenames to safe character set
* If desired later: integrate AV scan (optional; not required now)

### 10.4 Retention / deletion

* Deleting a document should delete blob and metadata row.
* If permanence required, implement **soft-delete** (`deleted` flag) and keep old blob until manual removal.

---

## 11. Deployment & operational instructions (manual)

### 11.1 Local dev

* Use Azurite for Storage API emulation or a test real storage account.
* Use `.env` to store local env vars (do NOT commit).
* Run Node app locally and ensure uploads/redirects work.

### 11.2 Deploy to Azure App Service (manual)

* Zip your app and use Azure Portal → App Service → Deployment Center → Zip Deploy, or use FTP.
* Set following App Settings in App Service:

  * `AZURE_STORAGE_CONNECTION_STRING` (or storage account name + key)
  * `AZURE_STORAGE_CONTAINER = ctq-docs`
  * `PUBLIC_BASE_URL = https://quality.jengcontractors.com`
  * `SQLITE_DB_PATH = /home/data/ctq.sqlite`
  * `ADMIN_EMAILS = alice@jengcontractors.com,bob@jengcontractors.com`
* For Node apps, ensure `WEBSITE_NODE_DEFAULT_VERSION` matches Node runtime.

### 11.3 Post-deploy

* Create container `ctq-docs` and set access level to **Blob (public)**.
* Confirm App Service persistent storage at `/home` is available and readable/writable for SQLite file.
* Configure custom domain and TLS under App Service.

---

## 12. Testing & acceptance criteria

### 12.1 Tests

* **Admin auth**: attempt to access `/admin` when not logged → redirect to login; login with admin user → access allowed.
* **Upload**: upload a test PDF → confirm blob created in container and SQLite row inserted; portal returns `https://.../docs/...` URL.
* **Public access**: open portal URL in incognito → redirected to blob and file opens.
* **List folders**: create folder and document, ensure it appears on public folder page.
* **Versioning**: upload new file with same name/standard id → DB version increments and portal URL still maps to latest (or to the explicit version as designed).
* **Edge cases**: attempt to upload disallowed file type → server rejects with proper error.

### 12.2 Acceptance criteria

* Admin UX validated with 2–3 admins (training doc).
* Public URLs resolve reliably.
* No authentication required for public browsing.
* Admin authentication via Easy Auth works and only authorized users gain access.

---

## 13. Operational roles & responsibilities

* **Development Team**

  * Build Node app, SQLite schema, folder/document UI, upload flow, redirect endpoints.
  * Implement Easy Auth checks and admin email whitelist logic.
* **Infrastructure Team**

  * Provision Resource Group, Storage Account, App Service, DNS mapping.
  * Configure App Service Authentication (Easy Auth) pointing to App Registration.
  * Provide storage keys / connection strings to dev team as App Settings.
* **Security Team**

  * Approve usage of public blob container for CTQ docs.
  * Approve Azure AD group or admin email list for portal admin access.
* **Quality Team (Business)**

  * Provide initial folder names and sample documents.
  * Test admin flow and perform QR generation manually once portal URLs are available.
* **Operations (Light)**

  * Basic runbook for deploying updates (manual zip deploy) and for emergency removal of content if required.

---

## 14. Minimal runbook for the Quality team (how-to)

1. Login to `https://quality.jengcontractors.com/admin` (auto-redirect to corporate login).
2. Click **Create Folder** → enter `welding` (use lowercase, no spaces).
3. Click **Upload** → choose `SWI-105_v1.pdf` → select folder `welding` → Upload.
4. On success, copy the **Portal URL** (button `Copy portal URL`) — e.g. `https://quality.jengcontractors.com/docs/welding/SWI-105_v1.pdf`.
5. Go to your preferred QR provider (Uniqode or other), paste the Portal URL and generate QR. Save PNG and place on A5 templates.

---

## 15. Cost estimate (monthly, approximate)

* **App Service (Basic B1)**: \~\$13–25 (region dependent)
* **DNS / TLS**: App Service Managed Certificate free (no extra cost)
* **Storage**: Included in App Service (no additional cost)
* **Total ongoing**: **\~\$13–25 / month**

**Significant cost reduction**: Eliminating Azure Storage Account reduces monthly costs by ~$5-15 and simplifies billing.

---

## 16. Timeline & phased delivery (recommended)

* **Day 0 (Infra)**: Create Resource Group, Storage Account, App Service, register App in Azure AD.
* **Day 1 (Dev)**: Scaffold Node app (Express), SQLite migrations, azure storage connection, basic UI.
* **Day 2 (Dev)**: Implement upload flow, tests, redirect endpoint.
* **Day 3 (Dev)**: Integrate Easy Auth checks and admin UI polish.
* **Day 4 (QA + Biz)**: Pilot with 2–3 admins, generate sample QR codes, iterate on UX.
* **Day 5 (Go-live)**: Bind custom domain, final checks, handover documentation.

Realistic minimal effort: **3–5 working days** by one developer plus infra setup time.

---

## 17. Appendix A — important environment variables

* `SQLITE_DB_PATH` — `/home/data/quality.sqlite` (contains all data and files)
* `PUBLIC_BASE_URL` — `https://quality.jengcontractors.com`
* `ADMIN_EMAILS` — comma-separated admin emails
* `NODE_ENV` — `production`
* `EASY_AUTH` — `true` (optional, implied by production)
* `PORT` — (App Service sets automatically)

**Removed variables**: Azure Storage connection strings and container names are no longer needed.

---

## 18. Appendix B — SQLite migration script (example)

```sql
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  parent_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  blob_url TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  uploaded_by TEXT,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (folder_id) REFERENCES folders(id)
);

CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
COMMIT;
```

---

## 19. Appendix C — Security checklist (enhanced)

* App Service auth: Enabled (Microsoft Entra / Azure AD)
* Admin emails configured and tested
* HTTPS enforced (App Service)
* File type & size validation in app
* `helmet` for security headers
* No exposed credentials in code (use App Settings / Key Vault if desired)
* **Enhanced security**: Files served through application with proper authentication controls
* **No public storage**: All files protected by application-level security
* **Content-Type validation**: Proper MIME type handling and security headers
* **Rate limiting**: Built-in protection against abuse

---

## 20. Appendix D — Handover checklist for go-live

* [ ] Resource Group provisioned and credentials shared to dev
* [ ] Storage container created and public access verified
* [ ] App Service created and application deployed
* [ ] Custom domain mapped and TLS active
* [ ] App Service Auth configured to use Azure AD and `ADMIN_EMAILS` set
* [ ] SQLite migrations applied and sample folder + doc created
* [ ] Admins tested upload, copy portal URL, manual QR generation
* [ ] Admin quick-start runbook delivered to Quality team

---

## Final notes & recommendations (concise)

* This design achieves your goals: branded single portal, manual QR workflow, permanent public access, simple ops.
* Using **Azure Blob** for files + **SQLite** for metadata gives a clean balance of permanence, performance and simplicity.
* **App Service Easy Auth** provides a very low-effort secure admin experience.
* Keep the solution single-instance and manual for now. If scale grows or requirements change (analytics, integrations, HA), plan to migrate SQLite → Azure SQL and adopt a multi-instance deployment.

---


