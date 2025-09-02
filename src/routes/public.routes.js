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
      info.database.documentCount = Number(docCount.count);
      
      // Test database write capability
      try {
        const testResult = dbInstance.prepare("INSERT INTO folders (name, display_name) VALUES ('__test__', 'Test Folder')").run();
        const testFolder = dbInstance.prepare("SELECT * FROM folders WHERE name = '__test__'").get();
        dbInstance.prepare("DELETE FROM folders WHERE name = '__test__'").run();
        info.database.writeTest = { 
          success: true, 
          insertId: Number(testResult.lastInsertRowid), 
          retrieved: !!testFolder 
        };
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
    
    // Test with explicit transaction
    const transaction = dbInstance.transaction(() => {
      const stmt = dbInstance.prepare('INSERT INTO folders (name, display_name) VALUES (?, ?)');
      const result = stmt.run(testName, `Test Folder ${Date.now()}`);
      
      console.log(`[DEBUG] Direct insert result:`, result);
      
      // No pragma commands inside transactions
      
      // Verify it exists immediately
      const verification = dbInstance.prepare('SELECT * FROM folders WHERE name = ?').get(testName);
      console.log(`[DEBUG] Verification query result:`, verification);
      
      return { result, verification };
    });
    
    const { result, verification } = transaction();
    
    // Check if it still exists after transaction
    const postTransactionCheck = dbInstance.prepare('SELECT * FROM folders WHERE name = ?').get(testName);
    console.log(`[DEBUG] Post-transaction check:`, postTransactionCheck);
    
    // Check all folders
    const allFolders = dbInstance.prepare('SELECT * FROM folders').all();
    console.log(`[DEBUG] All folders after insert:`, allFolders);
    
    // Clean up
    dbInstance.prepare('DELETE FROM folders WHERE name = ?').run(testName);
    
    res.json({ 
      ok: true, 
      test: {
        insertResult: result,
        verification: verification,
        postTransactionCheck: postTransactionCheck,
        allFoldersAfterInsert: allFolders,
        cleaned: true
      }
    });
  } catch (error) {
    console.error('[DEBUG] Test folder creation error:', error);
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

// Manual folder creation for testing
router.post('/debug/create-folder/:name', (req, res) => {
  try {
    const { name } = req.params;
    console.log(`[DEBUG] Manual folder creation: ${name}`);
    
    const db = require('../services/database.service');
    
    // Check if folder already exists
    const existing = db.getFolderByName(name);
    if (existing) {
      return res.json({ 
        ok: true, 
        message: 'Folder already exists',
        folder: existing,
        allFolders: db.getFolders()
      });
    }
    
    const folder = db.createFolder({ name, displayName: `Debug ${name}` });
    
    // Verify it exists
    const verification = db.getFolderByName(name);
    const allFolders = db.getFolders();
    
    console.log(`[DEBUG] Created folder:`, folder);
    console.log(`[DEBUG] Verification:`, verification);
    console.log(`[DEBUG] All folders:`, allFolders);
    
    res.json({ 
      ok: true, 
      folder,
      verification,
      allFolders
    });
  } catch (error) {
    console.error('[DEBUG] Manual folder creation error:', error);
    const errorDetails = {
      message: error.message,
      code: error.code,
      stack: error.stack
    };
    res.status(500).json({ ok: false, error: String(error.message || error), details: errorDetails });
  }
});

// Database status check
router.get('/debug/db-status', (req, res) => {
  try {
    const dbInstance = require('../db/init');
    
    // Get status without BigInt issues
    const status = {
      journalMode: String(dbInstance.pragma('journal_mode', { simple: true })),
      synchronous: String(dbInstance.pragma('synchronous', { simple: true })),
      busyTimeout: Number(dbInstance.pragma('busy_timeout', { simple: true })),
      cacheSize: Number(dbInstance.pragma('cache_size', { simple: true }))
    };
    
    // Test a simple query
    const testQuery = dbInstance.prepare('SELECT COUNT(*) as count FROM folders').get();
    const folderCount = Number(testQuery.count);
    
    res.json({ 
      ok: true, 
      status,
      folderCount,
      message: 'Database accessible'
    });
  } catch (error) {
    console.error('[DEBUG] Database status error:', error);
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

// Comprehensive functionality test
router.post('/debug/full-test', async (req, res) => {
  const testResults = {
    timestamp: new Date().toISOString(),
    tests: []
  };
  
  try {
    const db = require('../services/database.service');
    const testFolderName = `fulltest-${Date.now()}`;
    
    // Test 1: Create folder
    try {
      const folder = db.createFolder({ name: testFolderName, displayName: 'Full Test Folder' });
      testResults.tests.push({ 
        name: 'Create Folder', 
        status: 'PASS', 
        result: folder 
      });
    } catch (error) {
      testResults.tests.push({ 
        name: 'Create Folder', 
        status: 'FAIL', 
        error: error.message 
      });
    }
    
    // Test 2: List folders
    try {
      const folders = db.getFolders();
      const hasTestFolder = folders.some(f => f.name === testFolderName);
      testResults.tests.push({ 
        name: 'List Folders', 
        status: hasTestFolder ? 'PASS' : 'FAIL', 
        result: { totalFolders: folders.length, hasTestFolder } 
      });
    } catch (error) {
      testResults.tests.push({ 
        name: 'List Folders', 
        status: 'FAIL', 
        error: error.message 
      });
    }
    
    // Test 3: Get folder by name
    try {
      const folder = db.getFolderByName(testFolderName);
      testResults.tests.push({ 
        name: 'Get Folder By Name', 
        status: folder ? 'PASS' : 'FAIL', 
        result: folder 
      });
    } catch (error) {
      testResults.tests.push({ 
        name: 'Get Folder By Name', 
        status: 'FAIL', 
        error: error.message 
      });
    }
    
    // Test 4: Update folder display name
    try {
      const updateResult = db.updateFolderDisplayName(testFolderName, 'Updated Test Folder');
      const updatedFolder = db.getFolderByName(testFolderName);
      testResults.tests.push({ 
        name: 'Update Folder Display Name', 
        status: updatedFolder?.displayName === 'Updated Test Folder' ? 'PASS' : 'FAIL', 
        result: { updateResult, updatedFolder } 
      });
    } catch (error) {
      testResults.tests.push({ 
        name: 'Update Folder Display Name', 
        status: 'FAIL', 
        error: error.message 
      });
    }
    
    // Test 5: Clean up
    try {
      const deleteResult = db.deleteFolderByName(testFolderName);
      testResults.tests.push({ 
        name: 'Delete Folder', 
        status: 'PASS', 
        result: deleteResult 
      });
    } catch (error) {
      testResults.tests.push({ 
        name: 'Delete Folder', 
        status: 'FAIL', 
        error: error.message 
      });
    }
    
    const passCount = testResults.tests.filter(t => t.status === 'PASS').length;
    const totalCount = testResults.tests.length;
    
    res.json({ 
      ok: true, 
      summary: `${passCount}/${totalCount} tests passed`,
      allPassed: passCount === totalCount,
      testResults 
    });
    
  } catch (error) {
    console.error('[DEBUG] Full test error:', error);
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
