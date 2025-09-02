const express = require('express');
const router = express.Router();
const db = require('../services/database.service');

// Health/Readiness
router.get('/healthz', (req, res) => {
  res.json({ ok: true, status: 'healthy' });
});
router.get('/readyz', (req, res) => {
  try {
    // basic check: DB folder list query should not throw
    db.getFolders();
    res.json({ ok: true, status: 'ready' });
  } catch (e) {
    res.status(500).json({ ok: false, status: 'not_ready', error: String(e.message || e) });
  }
});

// Diagnostic endpoint for troubleshooting
router.get('/debug/info', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    const dbPath = process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'quality.sqlite');
    const dbDir = path.dirname(dbPath);
    
    const info = {
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        SQLITE_DB_PATH: process.env.SQLITE_DB_PATH,
        actualDbPath: dbPath,
        dbDirectory: dbDir
      },
      filesystem: {
        dbDirectoryExists: fs.existsSync(dbDir),
        dbFileExists: fs.existsSync(dbPath),
        currentWorkingDir: process.cwd()
      },
      database: {
        folderCount: 0,
        documentCount: 0,
        error: null,
        tables: [],
        folderTableSchema: [],
        rawFolderQuery: null
      }
    };
    
    try {
      const dbInstance = require('../db/init');
      
      // Check what tables exist
      const tables = dbInstance.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      info.database.tables = tables.map(t => t.name);
      
      // Check folders table schema
      const schema = dbInstance.prepare("PRAGMA table_info(folders)").all();
      info.database.folderTableSchema = schema;
      
      // Raw folder query
      const rawFolders = dbInstance.prepare('SELECT * FROM folders').all();
      info.database.rawFolderQuery = rawFolders;
      
      const folders = db.getFolders();
      info.database.folderCount = folders.length;
      info.database.folders = folders;
      
      // Try to get document count
      const docCount = dbInstance.prepare('SELECT COUNT(*) as count FROM documents').get();
      info.database.documentCount = docCount.count;
      
      // Test database write capability
      try {
        const testResult = dbInstance.prepare("INSERT INTO folders (name, display_name) VALUES ('__test__', 'Test Folder')").run();
        const testFolder = dbInstance.prepare("SELECT * FROM folders WHERE name = '__test__'").get();
        dbInstance.prepare("DELETE FROM folders WHERE name = '__test__'").run();
        info.database.writeTest = { success: true, insertId: testResult.lastInsertRowid, retrieved: !!testFolder };
      } catch (writeError) {
        info.database.writeTest = { success: false, error: String(writeError.message || writeError) };
      }
      
    } catch (dbError) {
      info.database.error = String(dbError.message || dbError);
    }
    
    res.json({ ok: true, info });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

// Test folder creation endpoint
router.post('/debug/test-folder', (req, res) => {
  try {
    const testName = `test-${Date.now()}`;
    console.log(`[DEBUG] Testing folder creation: ${testName}`);
    
    const dbInstance = require('../db/init');
    
    // Direct database insert
    const stmt = dbInstance.prepare('INSERT INTO folders (name, display_name) VALUES (?, ?)');
    const result = stmt.run(testName, `Test Folder ${Date.now()}`);
    
    console.log(`[DEBUG] Direct insert result:`, result);
    
    // Verify it exists
    const verification = dbInstance.prepare('SELECT * FROM folders WHERE name = ?').get(testName);
    console.log(`[DEBUG] Verification query result:`, verification);
    
    // Clean up
    dbInstance.prepare('DELETE FROM folders WHERE name = ?').run(testName);
    
    res.json({ 
      ok: true, 
      test: {
        insertResult: result,
        verification: verification,
        cleaned: true
      }
    });
  } catch (error) {
    console.error('[DEBUG] Test folder creation error:', error);
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

// Home: list folders
router.get('/', (req, res) => {
  const folders = db.getFolders();
  res.json({ ok: true, folders });
});

// List folders
router.get('/folders', (req, res) => {
  const folders = db.getFolders();
  res.json({ ok: true, folders });
});

// List documents in a folder
router.get('/folder/:folderName', (req, res) => {
  const { folderName } = req.params;
  const folder = db.getFolderByName(folderName);
  if (!folder) return res.status(404).json({ ok: false, error: 'folder_not_found' });
  const documents = db.getDocumentsInFolder(folderName);
  res.json({ ok: true, folder, documents });
});

// Serve the latest version of a document in a folder
router.get('/docs/:folder/:fileName', (req, res) => {
  const { folder, fileName } = req.params;
  const doc = db.getDocumentByFolderAndFileName(folder, fileName);
  if (!doc) return res.status(404).json({ ok: false, error: 'document_not_found' });
  
  // Get the file content
  const content = db.getDocumentContent(doc.id);
  if (!content) return res.status(404).json({ ok: false, error: 'file_content_not_found' });
  
  // Set appropriate headers for PDF serving
  res.setHeader('Content-Type', content.mime_type);
  res.setHeader('Content-Length', content.file_size);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(content.file_name)}"`);
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  return res.send(content.file_content);
});

// Friendly path: GET /:folderName -> list documents (avoid reserved paths)
router.get('/:folderName', (req, res, next) => {
  const reserved = new Set(['folders', 'docs', 'admin']);
  const { folderName } = req.params;
  if (reserved.has(folderName)) return next();
  const folder = db.getFolderByName(folderName);
  if (!folder) return res.status(404).json({ ok: false, error: 'folder_not_found' });
  const documents = db.getDocumentsInFolder(folderName);
  return res.json({ ok: true, folder, documents });
});

// Friendly path: GET /docs/:folder -> list documents in folder
router.get('/docs/:folder', (req, res) => {
  const { folder } = req.params;
  const f = db.getFolderByName(folder);
  if (!f) return res.status(404).json({ ok: false, error: 'folder_not_found' });
  const documents = db.getDocumentsInFolder(folder);
  return res.json({ ok: true, folder: f, documents });
});

module.exports = router;
