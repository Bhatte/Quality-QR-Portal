const express = require('express');
const router = express.Router();
const fsp = require('fs/promises');
const path = require('path');
// ME-QR service for generating and probing frames
const meqr = require('../services/meqr.service');

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

// Export all ME-QR frame previews to a browsable gallery under /public/frame-probe/{timestamp}/
// POST /admin/qr/probe/export?link=https://...&size=512
// Returns { ok, total, successCount, errorCount, galleryUrl, manifestUrl }
router.post('/qr/probe/export', async (req, res) => {
  if (process.env.ENABLE_PROBE !== 'true') {
    return res.status(404).json({ ok: false, error: 'not_enabled' });
  }
  try {
    const link = String(req.query.link || '').trim();
    const size = Math.min(1024, Math.max(200, parseInt(req.query.size || '512', 10) || 512));
    if (!link) return res.status(400).json({ ok: false, error: 'link_required' });

    const all = await meqr.getFrameNames();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const galleryRel = path.join('frame-probe', ts);
    const galleryAbs = path.join(__dirname, '..', '..', 'public', galleryRel);

    await fsp.mkdir(galleryAbs, { recursive: true });

    const safe = (s) => String(s).replace(/[^a-z0-9_-]/gi, '-');

    const results = [];
    let idx = 0;
    for (const name of all) {
      const indexStr = String(idx).padStart(3, '0');
      const fileName = `${indexStr}-${safe(name)}.png`;
      const fileAbs = path.join(galleryAbs, fileName);
      try {
        const { pngBuffer } = await meqr.createLinkQrPng({
          link,
          title: `probe-${name}`,
          designType: 'base',
          qrOptions: { size },
          qrFrame: { name, color: '#000000', backgroundColor: '#FFFFFF', text: '' }
        });
        await fsp.writeFile(fileAbs, pngBuffer);
        results.push({ index: idx, name, file: fileName, ok: true });
      } catch (e) {
        results.push({ index: idx, name, file: fileName, ok: false, error: String(e.message || e) });
      }
      idx += 1;
    }

    // Write manifest
    const manifest = { generatedAt: new Date().toISOString(), link, size, total: results.length, items: results };
    const manifestAbs = path.join(galleryAbs, 'manifest.json');
    await fsp.writeFile(manifestAbs, JSON.stringify(manifest, null, 2));

    // Write simple index.html gallery
    const rows = results.map(r => `
      <figure class="item ${r.ok ? 'ok' : 'err'}">
        <img src="./${encodeURIComponent(r.file)}" alt="${r.name}">
        <figcaption>
          <code>${r.index.toString().padStart(3,'0')}</code>
          <span>${r.name}</span>
          ${r.ok ? '' : `<em class="error">${(r.error||'').replace(/</g,'&lt;')}</em>`}
        </figcaption>
      </figure>
    `).join('\n');

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ME-QR Frame Probe ${ts}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 16px; }
    header { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom: 16px; }
    header code { background:#f3f3f3; padding:2px 6px; border-radius:4px; }
    .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
    .item { border:1px solid #e5e5e5; border-radius:8px; padding:8px; background:#fff; }
    .item img { width:100%; height:auto; display:block; background:#fff; }
    figcaption { display:flex; gap:8px; align-items:center; padding-top:8px; }
    figcaption code { background:#f3f3f3; padding:2px 6px; border-radius:4px; font-size:12px; }
    figcaption span { font-weight:600; font-size:13px; }
    .error { color:#a00; font-size:12px; }
  </style>
  <link rel="preload" href="./manifest.json" as="fetch" type="application/json" crossorigin>
  <script>fetch('./manifest.json').then(r=>r.json()).then(j=>console.log('Manifest', j)).catch(()=>{});</script>
  </head>
<body>
  <header>
    <h1>ME-QR Frame Probe</h1>
    <div>Generated: <code>${manifest.generatedAt}</code></div>
    <div>Total: <code>${results.length}</code></div>
    <div>Link: <code>${link}</code></div>
    <div>Size: <code>${size}</code></div>
  </header>
  <main class="grid">
${rows}
  </main>
</body>
</html>`;

    await fsp.writeFile(path.join(galleryAbs, 'index.html'), html);

    const successCount = results.filter(r => r.ok).length;
    const errorCount = results.length - successCount;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const galleryUrl = `${baseUrl}/${galleryRel.replace(/\\/g,'/')}/index.html`;
    const manifestUrl = `${baseUrl}/${galleryRel.replace(/\\/g,'/')}/manifest.json`;

    return res.json({ ok: true, total: results.length, successCount, errorCount, galleryUrl, manifestUrl });
  } catch (err) {
    console.error('Probe export error', err);
    return res.status(500).json({ ok: false, error: 'export_failed', details: String(err.message || err) });
  }
});

 

const db = require('../services/database.service');
const storage = require('../services/storage.service');
// Probe a slice of ME-QR frames to visually identify a desired frame (e.g., "Labor Day"/helmet)
// GET /admin/qr/probe/frames?link=https://...&start=0&count=12
// Returns small PNG previews (base64) and their corresponding frame names
router.get('/qr/probe/frames', async (req, res) => {
  if (process.env.ENABLE_PROBE !== 'true') {
    return res.status(404).json({ ok: false, error: 'not_enabled' });
  }
  try {
    const link = String(req.query.link || '').trim();
    const start = Math.max(0, parseInt(req.query.start || '0', 10) || 0);
    const count = Math.min(24, Math.max(1, parseInt(req.query.count || '12', 10) || 12));
    if (!link) return res.status(400).json({ ok: false, error: 'link_required' });

    const all = await meqr.getFrameNames();
    const total = all.length;
    const slice = all.slice(start, Math.min(start + count, total));

    const frames = [];
    for (const name of slice) {
      try {
        const { pngBuffer, entryUID } = await meqr.createLinkQrPng({
          link,
          title: `probe-${name}`,
          designType: 'base',
          qrOptions: { size: 320 },
          qrFrame: { name, color: '#000000', backgroundColor: '#FFFFFF', text: '' }
        });
        frames.push({
          name,
          entryUID: entryUID || null,
          png: `data:image/png;base64,${pngBuffer.toString('base64')}`
        });
      } catch (e) {
        frames.push({ name, error: String(e.message || e) });
      }
    }

    return res.json({ ok: true, range: { start, count: frames.length, total }, frames });
  } catch (err) {
    console.error('Probe frames error', err);
    return res.status(500).json({ ok: false, error: 'probe_failed', details: String(err.message || err) });
  }
});

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

// Generate a QR code (PNG) for a given PDF in a folder and store it alongside as {name}-qr.png
router.post('/qr/link', async (req, res) => {
  try {
    const { folder, fileName, options, title } = req.body || {};
    if (!folder || !fileName) return res.status(400).json({ ok: false, error: 'folder_and_fileName_required' });

    const f = db.getFolderByName(String(folder));
    if (!f) return res.status(404).json({ ok: false, error: 'folder_not_found' });

    const doc = db.getDocumentByFolderAndFileName(String(folder), String(fileName));
    if (!doc) return res.status(404).json({ ok: false, error: 'document_not_found' });

    // Ensure it's a PDF (defensive)
    const isPdf = (doc.mime_type || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(doc.file_name || '');
    if (!isPdf) return res.status(400).json({ ok: false, error: 'pdf_only' });

    // Build absolute link for QR using PUBLIC_BASE_URL or request origin
    const publicBase = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${publicBase}/docs/${encodeURIComponent(folder)}/${encodeURIComponent(fileName)}`;

    // Create ME-QR PNG
    const payload = {
      link,
      title: title || `${folder}/${fileName}`,
      qrOptions: options?.qrOptions || {},
    };
    if (options?.qrFrame) {
      payload.qrFrame = options.qrFrame;
    }
    const result = await meqr.createLinkQrPng(payload);

    // Determine QR file name and versioning
    const baseName = String(fileName).replace(/\.[^.]+$/, '');
    const qrFileName = `${baseName}-qr.png`;
    const nextVersion = db.getNextVersion(f.id, qrFileName);

    const notes = JSON.stringify({
      source: fileName,
      entryUID: result.entryUID || null,
      generatedAt: new Date().toISOString()
    });

    const saved = db.addDocument({
      folderId: f.id,
      fileName: qrFileName,
      fileContent: result.pngBuffer,
      fileSize: result.pngBuffer.length,
      mimeType: 'image/png',
      version: nextVersion,
      uploadedBy: req.headers['x-ms-client-principal-name'] || null,
      notes
    });

    const downloadUrl = `/docs/${encodeURIComponent(folder)}/${encodeURIComponent(qrFileName)}`;
    return res.status(201).json({
      ok: true,
      qr: {
        id: saved.id,
        fileName: qrFileName,
        version: saved.version,
        url: downloadUrl,
        entryUID: result.entryUID || null
      }
    });
  } catch (err) {
    console.error('QR generate error', err);
    const status = err.status && Number(err.status) >= 400 && Number(err.status) < 500 ? 502 : 500;
    return res.status(status).json({ ok: false, error: 'qr_generation_failed', details: String(err.message || err) });
  }
});

module.exports = router;
