# QR Portal - Quality Document Management System

A secure, self-contained quality document management system for Jones Engineering that enables field workers to access Critical-To-Quality (CTQ) documents via QR codes at physical "Quality Verification Stations" on job sites.

## Architecture Overview

The QR Portal uses a **single SQLite database** to store both metadata and document files as BLOBs, providing maximum security and simplicity. This approach eliminates external storage dependencies while ensuring permanent, secure access to quality documents.

### Key Features

- **Embedded File Storage**: All PDF documents stored securely as BLOBs in SQLite database
- **Permanent Portal URLs**: Stable URLs that never break, served through application security layer
- **Admin Interface**: Drag-and-drop upload with folder organization and version management
- **Nested Folders**: Create multi-level folder structures with per-folder QR codes for quick navigation
- **Local Authentication**: Simple session-based login using email allowlist + shared access code
- **Mobile-Optimized**: Responsive design for field access on mobile devices
- **Single File Deployment**: Entire application state contained in one SQLite database file
 - **ME‑QR Integration**: Server-side QR generation via ME‑QR Link API with default helmet frame

## Security Model

- **No Public Storage**: All files served through authenticated application layer
- **Content Validation**: PDF-only uploads with size limits (50MB max)
- **Security Headers**: Proper Content-Type, Cache-Control, and security headers
- **Admin Controls**: Role-based access with email allowlist
- **HTTPS Enforced**: All traffic encrypted via Azure App Service

## Quick Start

### Prerequisites

- Node.js 18+ 
- Git (optional)

### Local Development

1. **Clone and Setup**
   ```bash
   git clone <repository-url>
   cd qr-portal
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your local settings
   ```

3. **Initialize Database**
   ```bash
   npm run prepare:db
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

5. **Access Application**
   - Public Portal: http://localhost:3000
   - Admin Interface: http://localhost:3000/admin

### Environment Variables

```bash
# Database Configuration
SQLITE_DB_PATH=./data/quality.sqlite

# Application Configuration
PORT=3000
NODE_ENV=development
PUBLIC_BASE_URL=http://localhost:3000

# Authentication Configuration (Local-only)
AUTH_MODE=local
ADMIN_USERS=admin@example.com,manager@example.com
LOCAL_ACCESS_CODE=change-me
DISABLE_AUTH=false

# Session Configuration
SESSION_SECRET=your-super-secret-session-key-change-in-production

# ME‑QR Configuration (frames only work with base design)
MEQR_API_TOKEN=your-me-qr-api-token
MEQR_QR_DESIGN_TYPE=base
MEQR_QR_FRAME_NAME=hundredTventyFive
MEQR_QR_SIZE=1024
MEQR_QR_ECL=H
MEQR_QR_PATTERN_COLOR=#000000
MEQR_QR_BG_COLOR=#FFFFFF
MEQR_QR_CORNERS_OUTER_COLOR=#000000
MEQR_QR_CORNERS_INNER_COLOR=#000000
MEQR_QR_LOGO_URL=http://localhost:3000/logo.png
MEQR_QR_FRAME_COLOR=#000000
MEQR_QR_FRAME_BG_COLOR=#FFFFFF

# Optional feature flags
ENABLE_PROBE=false  # set true temporarily to use probe endpoints
```

## Deployment

### Azure App Service Deployment (Local Auth)

See `DEPLOY.md` for end‑to‑end GitHub‑linked CI/CD instructions and post‑deploy tests (including probe usage).

1. **Create Azure Resources**
   - Resource Group
   - App Service Plan (B1/B2 recommended)
   - Web App (Node.js runtime)

2. **Configure App Settings (Environment Variables)**
   ```bash
   az webapp config appsettings set \
     --resource-group rg-quality-portal \
     --name <your-webapp-name> \
     --settings \
       SQLITE_DB_PATH=/home/data/quality.sqlite \
       AUTH_MODE=local \
       ADMIN_USERS="admin@company.com,manager@company.com" \
       LOCAL_ACCESS_CODE="change-me-to-a-long-random-string" \
       SESSION_SECRET="your-long-random-session-secret" \
       NODE_ENV=production \
       PUBLIC_BASE_URL="https://quality.company.com"
   ```

3. **Deploy Application**
   ```bash
   # Create deployment package
   zip -r deploy/qr-portal.zip index.js package*.json public src -x "node_modules/*" ".env" "data/*"
   
   # Deploy via Azure CLI
   az webapp deploy \
     --resource-group rg-quality-portal \
     --name <your-webapp-name> \
     --src-path deploy/qr-portal.zip \
     --type zip
   ```

## API Reference

### Public Endpoints

- `GET /` - List all folders
- `GET /folders` - List all folders (JSON)
- `GET /folder/:folderName` - List documents in folder
- `GET /folder?path=...` - Folder detail with subfolders and documents
- `GET /docs/:folder/:fileName` - Serve document file (latest version)
- `GET /docs?path=...` - List documents within a specific folder path
- `GET /folders/tree` - Public folder hierarchy for navigation UI
- `GET /folders/detail?path=...` - Public folder detail including child folders
- `GET /folders/qr.png?path=...` - Fetch stored folder QR image (if available)
- `GET /healthz` - Health check
- `GET /readyz` - Readiness check

### Admin Endpoints (Authentication Required)

- `GET /admin` - Admin dashboard
- `POST /admin/folder` - Create new folder
- `PATCH /admin/folder/:name` - Update folder display name
- `DELETE /admin/folder/:name` - Delete folder and all documents
- `POST /admin/upload` - Upload document (multipart/form-data)
- `DELETE /admin/document/:id` - Delete specific document version
- `POST /admin/qr/link` - Generate a QR PNG for a specific PDF and store alongside it
- `GET /admin/folders/tree` - Return hierarchical folder tree for admin UI
- `GET /admin/folders/detail` - Folder metadata, children, document list, and QR state
- `POST /admin/qr/folder` - Generate or refresh QR code for a folder path
- `DELETE /admin/qr/folder` - Remove stored folder QR code
- Probe utilities (feature‑flagged; require `ENABLE_PROBE=true`):
  - `GET /admin/qr/probe/frames?link=...&start=0&count=12` - Base64 previews to identify frames
  - `POST /admin/qr/probe/export?link=...&size=512` - Writes gallery to `public/frame-probe/<timestamp>/`

## Database Schema

```sql
CREATE TABLE folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  parent_id INTEGER,
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

CREATE TABLE folder_qr_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_content BLOB NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  version INTEGER DEFAULT 1,
  entry_uid TEXT,
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (folder_id) REFERENCES folders(id)
);
```

## Usage Workflow

### For Quality Team (Admins)

1. **Login** to admin interface at `/admin`
2. **Create Folders** for different quality categories (welding, electrical, etc.)
3. **Upload Documents** via drag-and-drop or file selection
4. **Copy Portal URLs** for QR code generation
5. **Generate QR Codes** via Admin action (`POST /admin/qr/link`) — defaults to ME‑QR base design with helmet frame `hundredTventyFive` and black‑on‑white styling
6. **Print and Deploy** QR codes at quality verification stations

### For Field Workers

1. **Scan QR Code** at quality verification station
2. **Access Document** instantly via mobile browser
3. **View Content** without login or special apps

## File Management

- **Supported Formats**: PDF only
- **File Size Limit**: 50MB maximum
- **Version Control**: Automatic version incrementing
- **Storage**: Embedded in SQLite database as BLOBs
- **Security**: All files served through application authentication layer

## Monitoring and Maintenance

### Health Checks

- `/healthz` - Basic application health
- `/readyz` - Database connectivity and readiness

### Backup Strategy

The entire application state is contained in a single SQLite file:
- **Production**: `/home/data/quality.sqlite`
- **Local**: `./data/quality.sqlite`

Regular backups should copy this single file.

### Performance Optimization

- **Caching**: Documents served with appropriate cache headers
- **Compression**: Gzip compression enabled
- **Database**: Optimized queries with proper indexing
- **Memory**: Efficient BLOB handling for file serving

## Security Considerations

- **Authentication**: Local session-based login (email allowlist + shared code)
- **Authorization**: Email-based admin allowlist
- **File Validation**: MIME type and size validation
- **Security Headers**: Helmet.js for security headers
- **Rate Limiting**: Built-in rate limiting for admin endpoints
- **Content Security**: Proper Content-Type headers prevent XSS

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Check `SQLITE_DB_PATH` environment variable
   - Ensure directory exists and is writable
   - Run `npm run prepare:db` to initialize

2. **File Upload Failures**
   - Verify file is PDF format
   - Check file size is under 50MB limit
   - Ensure folder exists or will be created

3. **Authentication Issues (Local)**
   - Verify `ADMIN_USERS` includes your email (comma-separated, no spaces)
   - Ensure `LOCAL_ACCESS_CODE` matches what you enter on the login page
   - Test authentication status at `/auth/status`

### Logs and Debugging

- **Application Logs**: Available via Azure App Service Log Stream
- **Request Logging**: Morgan middleware provides request logs
- **Error Handling**: Centralized error handling with detailed messages

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes and test locally
4. Submit a pull request

## License

Proprietary - Jones Engineering Internal Use Only

## Support

For technical support or questions, contact the development team or refer to the comprehensive documentation in the `/docs` directory.
