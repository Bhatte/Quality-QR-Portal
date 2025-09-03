# QR Portal - Quality Document Management System

A secure, self-contained quality document management system for Jones Engineering that enables field workers to access Critical-To-Quality (CTQ) documents via QR codes at physical "Quality Verification Stations" on job sites.

## Architecture Overview

The QR Portal uses a **single SQLite database** to store both metadata and document files as BLOBs, providing maximum security and simplicity. This approach eliminates external storage dependencies while ensuring permanent, secure access to quality documents.

### Key Features

- **Embedded File Storage**: All PDF documents stored securely as BLOBs in SQLite database
- **Permanent Portal URLs**: Stable URLs that never break, served through application security layer
- **Admin Interface**: Drag-and-drop upload with folder organization and version management
- **Azure AD Authentication**: Secure admin access via Passport.js + Azure AD sessions
- **Mobile-Optimized**: Responsive design for field access on mobile devices
- **Single File Deployment**: Entire application state contained in one SQLite database file

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

# Authentication Configuration
ADMIN_EMAILS=admin@example.com,manager@example.com
DISABLE_AUTH=false

# Azure AD Configuration (Required for Production)
AZURE_TENANT_ID=your-tenant-id-here
AZURE_CLIENT_ID=your-client-id-here
AZURE_CLIENT_SECRET=your-client-secret-here
AZURE_REDIRECT_URL=https://your-domain.com/auth/callback

# Session Configuration
SESSION_SECRET=your-super-secret-session-key-change-in-production
```

## Deployment

### Azure App Service Deployment

1. **Create Azure Resources**
   - Resource Group
   - App Service Plan (B1/B2 recommended)
   - Web App (Node.js runtime)
   - Azure AD App Registration

2. **Configure App Settings**
   ```bash
   az webapp config appsettings set \
     --resource-group rg-quality-portal \
     --name <your-webapp-name> \
     --settings \
       SQLITE_DB_PATH=/home/data/quality.sqlite \
       AZURE_TENANT_ID="your-tenant-id" \
       AZURE_CLIENT_ID="your-client-id" \
       AZURE_CLIENT_SECRET="your-client-secret" \
       AZURE_REDIRECT_URL="https://your-app.azurewebsites.net/auth/callback" \
       ADMIN_EMAILS="admin@company.com,manager@company.com" \
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
- `GET /docs/:folder/:fileName` - Serve document file (latest version)
- `GET /healthz` - Health check
- `GET /readyz` - Readiness check

### Admin Endpoints (Authentication Required)

- `GET /admin` - Admin dashboard
- `POST /admin/folder` - Create new folder
- `PATCH /admin/folder/:name` - Update folder display name
- `DELETE /admin/folder/:name` - Delete folder and all documents
- `POST /admin/upload` - Upload document (multipart/form-data)
- `DELETE /admin/document/:id` - Delete specific document version

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
```

## Usage Workflow

### For Quality Team (Admins)

1. **Login** to admin interface at `/admin`
2. **Create Folders** for different quality categories (welding, electrical, etc.)
3. **Upload Documents** via drag-and-drop or file selection
4. **Copy Portal URLs** for QR code generation
5. **Generate QR Codes** manually using any QR service with the portal URL
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

- **Authentication**: Azure AD integration via Passport.js sessions
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

3. **Authentication Issues**
   - Verify `ADMIN_EMAILS` configuration
   - Check Azure AD app registration and redirect URI
   - Confirm Azure AD environment variables are set
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