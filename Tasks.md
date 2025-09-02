# Build Playbook: QR Portal (Local-First, Lift-and-Shift Ready)

This is the single source of truth for building, testing, and deploying the QR Portal. It optimizes for:

- Minimal local-to-cloud drift (env parity, same paths/variables)
- Clear checklists and commands
- Smooth “lift and shift” to Azure App Service

---

## 0) Objectives and Principles

- Permanence: URLs must remain stable; all files stored securely in SQLite database.
- Simplicity: Monolithic Node + SQLite for both metadata and file storage; Easy Auth for admin auth.
- Security: No public storage, all files served through authenticated application layer.
- Self-contained: Single database file contains entire application state.
- Manual deploy: Zip Deploy to App Service. No CI/CD initially.

---

## 1) Prerequisites

- Node.js LTS installed
- Azure CLI (for validation later)
- Git (optional, recommended)

**Note**: Storage emulator (Azurite) is no longer needed as all files are stored in SQLite.

---

## 2) Environment Variables (shared across local and production)

Create `.env` locally and align App Service App Settings with the same keys.

```bash
# Database (contains all data and files)
SQLITE_DB_PATH=./data/quality.sqlite                     # local path mirrors /home/data in prod

# App URLs
PUBLIC_BASE_URL=http://localhost:3000                    # local
# In production: https://quality.jengcontractors.com

# Admin
ADMIN_EMAILS=alice@jengcontractors.com,bob@jengcontractors.com
NODE_ENV=development
EASY_AUTH=false
PORT=3000
```

Production App Settings must match keys exactly. Only values change:

- SQLITE_DB_PATH: /home/data/quality.sqlite
- PUBLIC_BASE_URL: https://quality.jengcontractors.com
- NODE_ENV: production
- EASY_AUTH: true (optional, implied by production)

---

## 3) Project Structure (create these paths)

```
qr-portal/
  data/                 # holds local SQLite file (gitignored)
  public/               # static assets + admin HTML/JS
  src/
    db/                 # db init & migrations
    routes/             # public + admin routes
    services/           # db + storage services
  .env
  .env.example
  .gitignore
  index.js              # express app bootstrap
  package.json
```

---

## 4) NPM Scripts and Commands

Add to `package.json`:

```json
{
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "start:azurite": "azurite --silent --location ./azurite --debug ./azurite/debug.log",
    "prepare:db": "node ./src/db/init.js"
  }
}
```

Typical local terminal sequence (single terminal):

- `npm run dev` (starts the application with file watching)

---

## 5) Day-by-Day Execution Plan (Do-Confirm style)

### Day 0 — Scaffold & Parity

- Create Node project and structure (Section 3)
- Install deps: express, helmet, morgan, dotenv, better-sqlite3, multer
- Create `.env` from `.env.example`
- Add scripts (Section 4)

Done-When:
- `npm run dev` serves `GET /` returning 200 (placeholder)
- SQLite database initializes correctly

### Day 1 — Data Layer

- Implement `src/db/init.js` with idempotent migrations (folders, documents tables with BLOB storage + index)
- Implement `src/services/database.service.js` with CRUD functions:
  - `createFolder(name, displayName)`
  - `getFolderByName(name)`
  - `listFolders()`
  - `addDocument({ folderId, fileName, fileContent, fileSize, mimeType, version, uploadedBy, notes })`
  - `listDocuments(folderName)`
  - `findLatestDocument(folderName, fileName)`
  - `getDocumentContent(id)` for file serving
- Implement `src/services/storage.service.js` with validation utilities:
  - `validateFileType(mimeType, fileName)` for PDF validation
  - `validateFileSize(size)` for size limits
  - `sanitizeFileName(fileName)` for security

Done-When:
- `npm run prepare:db` creates `data/quality.sqlite` with BLOB support
- Test script can write/read rows and file content

### Day 2 — API Endpoints

- Public routes `src/routes/public.routes.js`:
  - `GET /` → list folders
  - `GET /folder/:folderName` → list docs in folder
  - `GET /docs/:folder/:fileName` → serve file directly from database (latest version)
- Admin routes `src/routes/admin.routes.js`:
  - `POST /admin/folder` → create folder
  - `POST /admin/upload` → multer upload → store in database → return `portalUrl`
  - `DELETE /admin/document/:id` → delete specific document version
  - `DELETE /admin/folder/:name` → delete folder and all documents
- Local auth middleware: no-op or header share-secret in dev; pluggable switch for Easy Auth in prod
- Wire routes in `index.js`

Done-When:
- Upload works locally; database contains file BLOB; portal URL serves file directly

### Day 3 — Minimal Admin UI

- Serve static from `/public`
- Build `/public/admin.html` + `/public/app.js`:
  - Show folders/documents
  - Create Folder form
  - Drag-and-drop upload; show returned `portalUrl` + Copy button

Done-When:
- A non-developer can create folder, upload a PDF, and open `portalUrl`

### Day 4 — Hardening and Prod Switches

- File validation (PDF only by default, size ≤ 50 MB)
- Security headers (`helmet`)
- Log basics (`morgan`)
- Add `EASY_AUTH` mode to auth middleware (parse `x-ms-client-principal`)
- Ensure all paths/envs match production choices exactly

Done-When:
- Toggling `NODE_ENV=production` uses Easy Auth code path (locally simulated)

### Day 5 — Lift and Shift

- Prepare zip package (exclude dev-only files)
- Configure App Service settings (Section 8)
- Zip Deploy
- Smoke test admin + public flow

Done-When:
- Public URLs redirect without login
- Admin area gated by Easy Auth

---

## 6) Acceptance & Smoke Tests

- Unauth access to `/admin` → redirects to login (prod) or blocked (local dev mode)
- Upload PDF → blob created, DB row added, `portalUrl` returned
- Open `portalUrl` from incognito → 302 to blob URL → file accessible
- Versioning: upload same file name with incremented version; latest resolves
- Rejection: upload disallowed type → 400

---

## 7) Versioning and Blob Paths

- Blob path: `{folder}/{filename}`
- Example: `welding/SWI-105_v2.pdf`
- DB version increments per replacement; redirect picks latest

---

## 8) Production Configuration (App Service)

Create or verify:

- Resource Group
- App Service Plan (B1/B2) and Web App (Node runtime)
- Custom domain + managed TLS for `quality.jengcontractors.com`
- Easy Auth: Microsoft Entra ID (Allow anonymous requests; enforce on `/admin` via code)

App Settings (must match local keys):

- `SQLITE_DB_PATH=/home/data/quality.sqlite`
- `PUBLIC_BASE_URL=https://quality.jengcontractors.com`
- `ADMIN_EMAILS=<comma-separated>`
- `NODE_ENV=production`
- `EASY_AUTH=true`

**Simplified Infrastructure**: No Azure Storage Account needed, reducing complexity and cost.

---

## 9) Lift-and-Shift Checklist (Minimal Delta)

- [ ] Local `.env` keys match production App Settings keys
- [ ] Local DB path `./data/quality.sqlite` → prod `/home/data/quality.sqlite`
- [ ] No hard-coded localhost URLs in code or UI
- [ ] Admin auth middleware supports both local and Easy Auth modes
- [ ] File serving works correctly with proper security headers
- [ ] Public routes do not require auth for document access
- [ ] Zip package excludes `data/`, `.env`, `node_modules` (App Service will build or include as needed)

**Simplified Deployment**: No external storage configuration needed.

---

## 10) Runbooks

- Local start (single terminal):
  - `npm run dev`
- DB reset (if needed locally): delete `data/quality.sqlite`, then `npm run prepare:db`
- Manual deploy:
  - Zip the project (excluding dev artifacts)
  - App Service → Deployment Center → Zip Deploy
- Backup: Copy `/home/data/quality.sqlite` (contains all data and files)

---

## Appendix — Crosswalk to Original Plan

- This playbook compresses and sequences the original “Master Implementation Roadmap” into checklists with clear Done-When outcomes, Env parity, and a Lift-and-Shift checklist.
- Refer to the original document for expanded rationale and stakeholder notes.