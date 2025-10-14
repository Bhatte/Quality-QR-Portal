const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'quality.sqlite');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);

// Configure SQLite for cloud environments - optimized approach
try {
  // Use WAL journal mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL'); // Faster than FULL, still safe
  db.pragma('busy_timeout = 3000'); // 3 second timeout (better for UI)
  db.pragma('cache_size = -8000'); // 8MB cache for better performance
  
  // Disable safe integers to avoid BigInt serialization issues
  db.defaultSafeIntegers(false);
  
  console.log('✅ SQLite configured successfully:');
  console.log('- Journal mode:', db.pragma('journal_mode', { simple: true }));
  console.log('- Synchronous:', db.pragma('synchronous', { simple: true }));
  console.log('- Busy timeout:', db.pragma('busy_timeout', { simple: true }));
} catch (error) {
  console.error('⚠️  SQLite configuration warning:', error.message);
}

// Check if we need to migrate from old schema
function migrateIfNeeded() {
  try {
    // Check if documents table exists and what columns it has
    const tableInfo = db.prepare("PRAGMA table_info(documents)").all();
    const hasFileContent = tableInfo.some(col => col.name === 'file_content');
    const hasBlobUrl = tableInfo.some(col => col.name === 'blob_url');
    
    if (tableInfo.length > 0 && !hasFileContent && hasBlobUrl) {
      console.log('🔄 Migrating database schema from blob storage to embedded storage...');
      
      // Backup existing folder data
      const existingFolders = db.prepare("SELECT * FROM folders").all();
      
      // Drop and recreate documents table with new schema
      db.exec(`
        BEGIN TRANSACTION;
        
        -- Drop old documents table (data will be lost, but this is expected for architecture change)
        DROP TABLE IF EXISTS documents;
        
        -- Create new documents table with embedded storage
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
        
        -- Recreate index
        CREATE INDEX idx_documents_folder ON documents(folder_id);
        
        COMMIT;
      `);
      
      console.log('✅ Migration completed successfully!');
      console.log('📝 Note: Existing documents need to be re-uploaded due to architecture change.');
      console.log(`📁 Folders preserved: ${existingFolders.length}`);
      return true;
    }
    return false;
  } catch (error) {
    console.log('ℹ️  No migration needed or first-time setup.');
    return false;
  }
}

// Initialize folders table
db.exec(`
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  parent_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Check for migration first
const migrated = migrateIfNeeded();

// Create documents table if it doesn't exist (new installation)
if (!migrated) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
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
  
  CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
  `);
}

// Folder QR codes table stores generated QR images per folder path
db.exec(`
CREATE TABLE IF NOT EXISTS folder_qr_codes (
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

CREATE INDEX IF NOT EXISTS idx_folder_qr_codes_folder ON folder_qr_codes(folder_id);
`);

console.log(`✅ SQLite initialized at: ${DB_PATH}`);

module.exports = db;
