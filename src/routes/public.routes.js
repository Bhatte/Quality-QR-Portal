const express = require('express');
const router = express.Router();
const db = require('../services/database.service');

function normalizeFolderPath(value) {
  return String(value || '').trim();
}


function decodeDocPathParameter(param) {
  const raw = String(param || '');
  const parts = raw.split('/').filter(Boolean);
  return parts.map(part => decodeURIComponent(part));
}

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
  if (process.env.ENABLE_DEBUG !== 'true') return res.status(404).json({ ok: false, error: 'not_found' });
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
  if (process.env.ENABLE_DEBUG !== 'true') return res.status(404).json({ ok: false, error: 'not_found' });
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
  if (process.env.ENABLE_DEBUG !== 'true') return res.status(404).json({ ok: false, error: 'not_found' });
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
  if (process.env.ENABLE_DEBUG !== 'true') return res.status(404).json({ ok: false, error: 'not_found' });
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

// Authentication status check
router.get('/debug/auth-status', (req, res) => {
  if (process.env.ENABLE_DEBUG !== 'true') return res.status(404).json({ ok: false, error: 'not_found' });
  try {
    const easyAuthOn = /^(true|1|yes)$/i.test(String(process.env.EASY_AUTH || ''));
    const mustEnforce = process.env.NODE_ENV === 'production' || easyAuthOn;
    const principal = req.headers['x-ms-client-principal'];
    
    const authInfo = {
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        EASY_AUTH: process.env.EASY_AUTH,
        ADMIN_EMAILS: process.env.ADMIN_EMAILS ? '[REDACTED]' : undefined
      },
      authentication: {
        mustEnforce,
        easyAuthOn,
        hasPrincipal: !!principal,
        principalLength: principal ? principal.length : 0
      },
      headers: {
        'x-ms-client-principal': principal ? '[PRESENT]' : '[MISSING]',
        'x-ms-client-principal-name': req.headers['x-ms-client-principal-name'] || '[MISSING]',
        'x-requested-with': req.headers['x-requested-with'] || '[MISSING]',
        'accept': req.headers['accept'] || '[MISSING]',
        'user-agent': req.headers['user-agent'] || '[MISSING]'
      },
      request: {
        method: req.method,
        path: req.path,
        originalUrl: req.originalUrl
      }
    };
    
    // Try to decode principal if present
    if (principal) {
      try {
        const decoded = JSON.parse(Buffer.from(principal, 'base64').toString('utf8'));
        authInfo.principal = {
          hasUserDetails: !!decoded.userDetails,
          hasClaims: Array.isArray(decoded.claims),
          claimsCount: Array.isArray(decoded.claims) ? decoded.claims.length : 0
        };
      } catch (decodeError) {
        authInfo.principal = { decodeError: decodeError.message };
      }
    }
    
    res.json({ ok: true, authInfo });
  } catch (error) {
    console.error('[DEBUG] Auth status error:', error);
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

// Echo selected headers for debugging
router.all('/debug/echo-headers', (req, res) => {
  if (process.env.ENABLE_DEBUG !== 'true') return res.status(404).json({ ok: false, error: 'not_found' });
  try {
    const auth = req.headers['authorization'];
    const zumo = req.headers['x-zumo-auth'];
    res.json({
      ok: true,
      method: req.method,
      path: req.path,
      headers: {
        authorization: auth ? `[PRESENT:${(String(auth).split(' ')[0] || '').toUpperCase()} ${String(auth).length} bytes]` : '[MISSING]',
        'x-zumo-auth': zumo ? `[PRESENT:${String(zumo).length} bytes]` : '[MISSING]',
        'x-requested-with': req.headers['x-requested-with'] || '[MISSING]',
        accept: req.headers['accept'] || '[MISSING]',
        'content-type': req.headers['content-type'] || '[MISSING]'
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Test admin functionality without auth (for debugging)
router.post('/debug/test-admin-folder', (req, res) => {
  if (process.env.ENABLE_DEBUG !== 'true') return res.status(404).json({ ok: false, error: 'not_found' });
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });

    const testName = `debug-${name}-${Date.now()}`;
    console.log(`[DEBUG] Testing admin folder creation without auth: ${testName}`);
    
    const existing = db.getFolderByName(testName);
    if (existing) {
      return res.json({ 
        ok: true, 
        message: 'Folder already exists',
        folder: existing
      });
    }
    
    const folder = db.createFolder({ name: testName, displayName: `Debug ${testName}` });
    console.log(`[DEBUG] Created folder without auth:`, folder);
    
    res.json({ 
      ok: true, 
      folder,
      message: 'Folder created successfully without authentication'
    });
  } catch (error) {
    console.error('[DEBUG] Test admin folder creation error:', error);
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

// Comprehensive functionality test
router.post('/debug/full-test', async (req, res) => {
  if (process.env.ENABLE_DEBUG !== 'true') return res.status(404).json({ ok: false, error: 'not_found' });
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

// Home: list top-level folders
router.get('/', (req, res) => {
  const folders = db.getChildFolders(null);
  res.json({ ok: true, folders });
});

// List top-level folders (/folders retained for backward compatibility)
router.get('/folders', (req, res) => {
  const folders = db.getChildFolders(null);
  res.json({ ok: true, folders });
});

// Hierarchical folder tree (public view)
router.get('/folders/tree', (req, res) => {
  const tree = db.getFolderTree();
  res.json({ ok: true, tree });
});

// Folder detail (children + latest documents)
router.get('/folders/detail', (req, res) => {
  const pathValue = normalizeFolderPath(req.query.path || '');
  if (!pathValue) {
    const children = db.getChildFolders(null);
    return res.json({ ok: true, folder: null, breadcrumbs: [], children, documents: [] });
  }

  const detail = db.getFolderDetail(pathValue);
  if (!detail) {
    return res.status(404).json({ ok: false, error: 'folder_not_found' });
  }

  return res.json({
    ok: true,
    folder: detail.folder,
    breadcrumbs: detail.breadcrumbs,
    children: detail.children,
    documents: detail.documents,
    qr: detail.qr ? { version: detail.qr.version, entryUid: detail.qr.entryUid || null } : null,
  });
});

// List documents in a folder
router.get('/folder/:folderName', (req, res) => {
  const detail = db.getFolderDetail(req.params.folderName);
  if (!detail) return res.status(404).json({ ok: false, error: 'folder_not_found' });
  return res.json({ ok: true, folder: detail.folder, breadcrumbs: detail.breadcrumbs, children: detail.children, documents: detail.documents });
});

router.get('/folder', (req, res) => {
  const pathValue = normalizeFolderPath(req.query.path || '');
  if (!pathValue) {
    const children = db.getChildFolders(null);
    return res.json({ ok: true, folder: null, breadcrumbs: [], children, documents: [] });
  }
  const detail = db.getFolderDetail(pathValue);
  if (!detail) return res.status(404).json({ ok: false, error: 'folder_not_found' });
  return res.json({ ok: true, folder: detail.folder, breadcrumbs: detail.breadcrumbs, children: detail.children, documents: detail.documents });
});

// Serve latest version of a document using hierarchical path (/docs/<folder path>/<file>)
router.get(/^\/docs\/(.+)/, (req, res) => {
  const rawDocPath = String(req.params[0] || '');
  const parts = decodeDocPathParameter(rawDocPath);
  if (parts.length < 2) {
    return res.status(400).json({ ok: false, error: 'invalid_document_path' });
  }

  const fileName = parts.pop();
  const folderPath = normalizeFolderPath(parts.join('/'));
  const doc = db.getDocumentByFolderAndFileName(folderPath, fileName);
  if (!doc) return res.status(404).json({ ok: false, error: 'document_not_found' });

  const content = db.getDocumentContent(doc.id);
  if (!content) return res.status(404).json({ ok: false, error: 'file_content_not_found' });

  res.setHeader('Content-Type', content.mime_type);
  res.setHeader('Content-Length', content.file_size);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(content.file_name)}"`);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return res.send(content.file_content);
});

// List documents using query parameter (?path=...)
router.get('/docs', (req, res) => {
  const pathValue = normalizeFolderPath(req.query.path || '');
  if (!pathValue) return res.status(400).json({ ok: false, error: 'path_required' });
  const folder = db.getFolderByPath(pathValue);
  if (!folder) return res.status(404).json({ ok: false, error: 'folder_not_found' });
  const documents = db.getDocumentsInFolder(folder.path);
  return res.json({ ok: true, folder, documents });
});

// Serve stored folder QR image (if generated by admin)
router.get('/folders/qr.png', (req, res) => {
  const pathValue = normalizeFolderPath(req.query.path || '');
  if (!pathValue) return res.status(400).json({ ok: false, error: 'path_required' });
  const qr = db.getFolderQr(pathValue, { includeContent: true });
  if (!qr || !qr.fileContent) {
    return res.status(404).json({ ok: false, error: 'qr_not_found' });
  }

  res.setHeader('Content-Type', qr.mimeType || 'image/png');
  res.setHeader('Content-Length', qr.fileSize);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(qr.fileName)}"`);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return res.send(qr.fileContent);
});

// Friendly path: GET /:folderName -> list documents (avoid reserved paths)
router.get('/:folderName', (req, res, next) => {
  const reserved = new Set(['folders', 'docs', 'admin', 'healthz', 'readyz', 'folder']);
  const { folderName } = req.params;
  if (reserved.has(folderName)) return next();
  const detail = db.getFolderDetail(folderName);
  if (!detail) return res.status(404).json({ ok: false, error: 'folder_not_found' });
  return res.json({ ok: true, folder: detail.folder, breadcrumbs: detail.breadcrumbs, children: detail.children, documents: detail.documents });
});

module.exports = router;
