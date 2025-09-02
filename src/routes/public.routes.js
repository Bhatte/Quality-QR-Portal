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
