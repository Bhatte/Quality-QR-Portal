const express = require('express');
const router = express.Router();

const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    if (!isPdf) return cb(new Error('pdf_only'));
    cb(null, true);
  }
});

const db = require('../services/database.service');
const storage = require('../services/storage.service');

// Echo selected headers for admin routes (debug only)
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

// Get all documents in a folder (including all versions) - Admin only
router.get('/folder/:folderName/documents', (req, res) => {
  const { folderName } = req.params;
  const folder = db.getFolderByName(folderName);
  if (!folder) return res.status(404).json({ ok: false, error: 'folder_not_found' });
  const documents = db.getAllDocumentsInFolder(folderName);
  res.json({ ok: true, folder, documents });
});

// Delete a folder (all documents and records under it)
router.delete('/folder/:name', async (req, res) => {
  try {
    const name = String(req.params.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });

    const folder = db.getFolderByName(name);
    if (!folder) return res.status(404).json({ ok: false, error: 'folder_not_found' });

    // Delete DB documents and folder (files are stored in DB, so no separate cleanup needed)
    db.deleteDocumentsInFolder(folder.name);
    const out = db.deleteFolderByName(folder.name);

    return res.json({ ok: true, deleted: out.changes });
  } catch (err) {
    console.error('Folder delete error', err);
    return res.status(500).json({ ok: false, error: 'folder_delete_failed', details: String(err.message || err) });
  }
});

// Update folder display name (inline rename)
router.patch('/folder/:name', (req, res) => {
  try {
    const name = String(req.params.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    const { displayName } = req.body || {};
    if (typeof displayName !== 'string') return res.status(400).json({ ok: false, error: 'displayName required' });

    const folder = db.getFolderByName(name);
    if (!folder) return res.status(404).json({ ok: false, error: 'folder_not_found' });

    const out = db.updateFolderDisplayName(name, displayName.trim() || null);
    if (!out.changes) return res.json({ ok: true, updated: false });
    const updated = db.getFolderByName(name);
    return res.json({ ok: true, updated: true, folder: updated });
  } catch (err) {
    console.error('Folder rename error', err);
    return res.status(500).json({ ok: false, error: 'folder_rename_failed', details: String(err.message || err) });
  }
});

// Create folder
router.post('/folder', (req, res) => {
  try {
    const { name, displayName, parentId } = req.body || {};
    console.log('Creating folder:', { name, displayName, parentId });
    
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });

    const existing = db.getFolderByName(name);
    if (existing) {
      console.log('Folder already exists:', existing);
      return res.json({ ok: true, folder: existing, created: false });
    }

    const folder = db.createFolder({ name, displayName: displayName || null, parentId: parentId || null });
    console.log('Folder created successfully:', folder);
    
    // Verify the folder was actually created by querying it back
    const verification = db.getFolderByName(name);
    if (!verification) {
      console.error('Folder creation verification failed');
      return res.status(500).json({ ok: false, error: 'folder_creation_verification_failed' });
    }
    
    return res.status(201).json({ ok: true, folder, created: true });
  } catch (error) {
    console.error('Folder creation error:', error);
    return res.status(500).json({ ok: false, error: 'folder_creation_failed', details: String(error.message || error) });
  }
});

// Upload a document to a folder
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { folder: folderName } = req.body || {};
    if (!folderName) return res.status(400).json({ ok: false, error: 'folder required' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'file required' });

    // Validate file type and size
    if (!storage.validateFileType(req.file.mimetype, req.file.originalname)) {
      return res.status(400).json({ ok: false, error: 'pdf_only' });
    }
    
    if (!storage.validateFileSize(req.file.size)) {
      return res.status(400).json({ ok: false, error: 'file_too_large' });
    }

    // Magic bytes validation for PDF: file should start with %PDF-
    try {
      const header = req.file.buffer?.subarray(0, 5).toString('utf8');
      if (header !== '%PDF-') {
        return res.status(400).json({ ok: false, error: 'pdf_only' });
      }
    } catch (_) {
      return res.status(400).json({ ok: false, error: 'pdf_only' });
    }

    // Ensure folder exists
    let folder = db.getFolderByName(folderName);
    if (!folder) {
      folder = db.createFolder({ name: folderName });
    }

    // Sanitize filename
    const origName = storage.sanitizeFileName(req.file.originalname);

    // Determine next version for this file within the folder
    const nextVersion = db.getNextVersion(folder.id, origName);

    // Save document record with file content stored in database
    const doc = db.addDocument({
      folderId: folder.id,
      fileName: origName,
      fileContent: req.file.buffer,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      version: nextVersion,
      uploadedBy: req.headers['x-ms-client-principal-name'] || null,
      notes: null
    });

    const portalUrl = `/docs/${encodeURIComponent(folder.name)}/${encodeURIComponent(origName)}`;
    return res.status(201).json({ 
      ok: true, 
      document: {
        id: doc.id,
        fileName: doc.file_name,
        fileSize: doc.file_size,
        mimeType: doc.mime_type,
        version: doc.version,
        uploadedBy: doc.uploaded_by,
        uploadedAt: doc.uploaded_at
      }, 
      portalUrl 
    });
  } catch (err) {
    console.error('Upload error', err);
    return res.status(500).json({ ok: false, error: 'upload_failed', details: String(err.message || err) });
  }
});

// Delete a specific document record by ID (single version)
router.delete('/document/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });

    const d = db.getDocumentById(id);
    if (!d) return res.status(404).json({ ok: false, error: 'document_not_found' });

    // Delete document record (file content is stored in DB, so this removes everything)
    const result = db.deleteDocumentById(id);
    return res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    console.error('Delete error', err);
    return res.status(500).json({ ok: false, error: 'delete_failed', details: String(err.message || err) });
  }
});

module.exports = router;
