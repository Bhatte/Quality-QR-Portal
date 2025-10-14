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

const db = require('../services/database.service');
const storage = require('../services/storage.service');

function resolvePublicBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function normalizeFolderPath(value) {
  return String(value || '').trim();
}

function buildFolderQrFileName(folder) {
  const slug = folder.slug || folder.pathSegments?.slice(-1)[0] || 'folder';
  return `${slug}-folder-qr.png`;
}

function encodePathSegments(segments = []) {
  return segments.map(segment => encodeURIComponent(segment)).join('/');
}

function performFolderDelete(pathValue) {
  const result = db.deleteFolderDeep(pathValue);
  if (!result.foldersDeleted) {
    return { ok: false, status: 404, body: { ok: false, error: 'folder_not_found' } };
  }
  return { ok: true, status: 200, body: { ok: true, deleted: result } };
}

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

// Structured folder information for admin UI (tree view)
router.get('/folders/tree', (req, res) => {
  const startTime = Date.now();
  try {
    console.log('[ADMIN] Loading folder tree...');
    const tree = db.getFolderTree();
    const docCounts = db.getFolderDocumentCountMap();
    const qrMap = db.getFolderQrPresenceMap();

    const enrich = (node) => {
      node.documentCount = docCounts.get(node.id) || 0;
      node.hasQr = qrMap.has(node.id);
      node.children = node.children || [];
      node.children.forEach(enrich);
      return node;
    };

    const enriched = tree.map(enrich);
    const duration = Date.now() - startTime;
    console.log(`[ADMIN] Folder tree loaded: ${enriched.length} folders in ${duration}ms`);
    return res.json({ ok: true, tree: enriched, debug: { loadTimeMs: duration } });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[ADMIN] Folder tree error after ${duration}ms:`, error);
    return res.status(500).json({ ok: false, error: 'folder_tree_failed', details: String(error.message || error) });
  }
});

// Folder detail including children, documents, QR metadata
router.get('/folders/detail', (req, res) => {
  try {
    const pathValue = normalizeFolderPath(req.query.path || '');
    if (!pathValue) {
      const children = db.getChildFolders(null);
      return res.json({
        ok: true,
        folder: null,
        breadcrumbs: [],
        children,
        latestDocuments: [],
        allDocuments: [],
        qr: null,
        qrDownloadUrl: null,
      });
    }

    const detail = db.getFolderDetail(pathValue);
    if (!detail) {
      return res.status(404).json({ ok: false, error: 'folder_not_found' });
    }

    const allDocuments = db.getAllDocumentsInFolder(detail.folder.path);
    const publicBase = resolvePublicBaseUrl(req);
    const qrDownloadUrl = detail.qr
      ? `${publicBase}/folders/qr.png?path=${encodeURIComponent(detail.folder.path)}`
      : null;

    return res.json({
      ok: true,
      folder: detail.folder,
      breadcrumbs: detail.breadcrumbs,
      children: detail.children,
      latestDocuments: detail.documents,
      allDocuments,
      qr: detail.qr,
      qrDownloadUrl,
    });
  } catch (error) {
    console.error('Folder detail error', error);
    return res.status(500).json({ ok: false, error: 'folder_detail_failed', details: String(error.message || error) });
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
  const folder = db.getFolderByPath(folderName);
  if (!folder) return res.status(404).json({ ok: false, error: 'folder_not_found' });
  const documents = db.getAllDocumentsInFolder(folder.path);
  res.json({ ok: true, folder, documents });
});

// Delete a folder (and all descendants/documents)
router.delete('/folder', async (req, res) => {
  try {
    const pathValue = normalizeFolderPath(req.query.path || req.body?.path || '');
    if (!pathValue) return res.status(400).json({ ok: false, error: 'path_required' });
    const outcome = performFolderDelete(pathValue);
    return res.status(outcome.status).json(outcome.body);
  } catch (err) {
    console.error('Folder delete error', err);
    return res.status(500).json({ ok: false, error: 'folder_delete_failed', details: String(err.message || err) });
  }
});

// Legacy path deletion support for backward compatibility (single-segment names)
router.delete('/folder/:name', async (req, res) => {
  try {
    const pathValue = normalizeFolderPath(req.params.name || '');
    if (!pathValue) return res.status(400).json({ ok: false, error: 'path_required' });
    const outcome = performFolderDelete(pathValue);
    return res.status(outcome.status).json(outcome.body);
  } catch (err) {
    console.error('Folder delete error', err);
    return res.status(500).json({ ok: false, error: 'folder_delete_failed', details: String(err.message || err) });
  }
});

// Update folder display name (inline rename)
router.patch('/folder', (req, res) => {
  try {
    const pathValue = normalizeFolderPath(req.body?.path || req.query.path || '');
    const { displayName } = req.body || {};
    if (!pathValue) return res.status(400).json({ ok: false, error: 'path_required' });
    if (typeof displayName !== 'string' || !displayName.trim()) {
      return res.status(400).json({ ok: false, error: 'displayName required' });
    }

    const result = db.updateFolderDisplayName(pathValue, displayName.trim());
    if (!result.changes) {
      return res.status(404).json({ ok: false, error: 'folder_not_found' });
    }

    const updated = db.getFolderByPath(pathValue);
    return res.json({ ok: true, updated: true, folder: updated });
  } catch (err) {
    console.error('Folder rename error', err);
    return res.status(500).json({ ok: false, error: 'folder_rename_failed', details: String(err.message || err) });
  }
});

router.patch('/folder/:name', (req, res) => {
  try {
    const name = String(req.params.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    const { displayName } = req.body || {};
    if (typeof displayName !== 'string') return res.status(400).json({ ok: false, error: 'displayName required' });

    const folder = db.getFolderByPath(name);
    if (!folder) return res.status(404).json({ ok: false, error: 'folder_not_found' });

    const out = db.updateFolderDisplayName(folder.path, displayName.trim() || null);
    if (!out.changes) return res.json({ ok: true, updated: false });
    const updated = db.getFolderByPath(folder.path);
    return res.json({ ok: true, updated: true, folder: updated });
  } catch (err) {
    console.error('Folder rename error', err);
    return res.status(500).json({ ok: false, error: 'folder_rename_failed', details: String(err.message || err) });
  }
});

// Create folder
router.post('/folder', (req, res) => {
  try {
    const { name, displayName, parentPath, parent, slug } = req.body || {};
    const label = String(displayName || name || '').trim();
    const parentPathValue = normalizeFolderPath(parentPath || parent || '');

    if (!label) return res.status(400).json({ ok: false, error: 'name required' });

    const folder = db.createFolder({
      name: label,
      displayName: displayName || label,
      parentPath: parentPathValue || null,
      slug: slug || null,
    });

    console.log('Folder created successfully:', folder);
    return res.status(201).json({ ok: true, folder, created: true });
  } catch (error) {
    if (error.message === 'parent_not_found') {
      return res.status(404).json({ ok: false, error: 'parent_not_found' });
    }
    console.error('Folder creation error:', error);
    return res.status(500).json({ ok: false, error: 'folder_creation_failed', details: String(error.message || error) });
  }
});

// Upload a document to a folder
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const folderPath = normalizeFolderPath(req.body?.path || req.body?.folder || '');
    if (!folderPath) return res.status(400).json({ ok: false, error: 'folder required' });
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
    const folder = db.getFolderByPath(folderPath);
    if (!folder) {
      return res.status(404).json({ ok: false, error: 'folder_not_found' });
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

    const encodedFolderPath = encodePathSegments(folder.pathSegments || []);
    const portalUrl = `/docs/${encodedFolderPath}/${encodeURIComponent(origName)}`;
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

    // We'll potentially cascade delete an associated QR if this was the last version
    const folder = db.getFolderById(d.folder_id);
    const folderPath = folder?.path;

    // Delete the selected document version
    const result = db.deleteDocumentById(id);

    let qrDeleted = 0;
    if (folderPath) {
      // Check if any versions of the same PDF remain in the folder
      const remaining = db.getDocumentsByFolderAndFileName(folderPath, d.file_name) || [];
      if (remaining.length === 0) {
        // Compute the QR filename for this PDF and remove all versions of it
        const base = String(d.file_name).replace(/\.[^.]+$/, '');
        const qrFileName = `${base}-qr.png`;
        const out = db.deleteDocumentsByFolderAndFileName(folderPath, qrFileName);
        qrDeleted = out.changes || 0;
      }
    }

    return res.json({ ok: true, deleted: result.changes, qrDeleted });
  } catch (err) {
    console.error('Delete error', err);
    return res.status(500).json({ ok: false, error: 'delete_failed', details: String(err.message || err) });
  }
});

// Generate or regenerate a folder-level QR code
router.post('/qr/folder', async (req, res) => {
  try {
    const pathValue = normalizeFolderPath(req.body?.path || '');
    if (!pathValue) return res.status(400).json({ ok: false, error: 'path_required' });

    const detail = db.getFolderDetail(pathValue);
    if (!detail) return res.status(404).json({ ok: false, error: 'folder_not_found' });

    const folder = detail.folder;
    const encodedPath = encodePathSegments(folder.pathSegments || []);
    const publicBase = resolvePublicBaseUrl(req);
    const link = `${publicBase}/folder.html?path=${encodeURIComponent(folder.path)}`;

    const payload = {
      link,
      title: req.body?.title || folder.displayName,
      qrOptions: req.body?.options?.qrOptions || {},
    };

    if (req.body?.options?.qrFrame) {
      payload.qrFrame = req.body.options.qrFrame;
    }

    const result = await meqr.createLinkQrPng(payload);

    const notes = {
      source: folder.path,
      entryUID: result.entryUID || null,
      generatedAt: new Date().toISOString(),
    };

    const fileName = buildFolderQrFileName(folder);
    const saved = db.saveFolderQr({
      folderId: folder.id,
      fileName,
      fileContent: result.pngBuffer,
      entryUid: result.entryUID || null,
      notes,
    });

    const downloadUrl = `/folders/qr.png?path=${encodeURIComponent(folder.path)}`;

    return res.status(201).json({
      ok: true,
      qr: {
        fileName,
        version: saved.version,
        entryUid: saved.entryUid || null,
        url: downloadUrl,
        folder: folder.path,
      },
    });
  } catch (err) {
    console.error('Folder QR generate error', err);
    const status = err.status && Number(err.status) >= 400 && Number(err.status) < 500 ? 502 : 500;
    return res.status(status).json({ ok: false, error: 'folder_qr_generation_failed', details: String(err.message || err) });
  }
});

router.delete('/qr/folder', (req, res) => {
  try {
    const pathValue = normalizeFolderPath(req.body?.path || req.query.path || '');
    if (!pathValue) return res.status(400).json({ ok: false, error: 'path_required' });
    const result = db.deleteFolderQr(pathValue);
    if (!result.changes) {
      return res.status(404).json({ ok: false, error: 'qr_not_found' });
    }
    return res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    console.error('Folder QR delete error', err);
    return res.status(500).json({ ok: false, error: 'folder_qr_delete_failed', details: String(err.message || err) });
  }
});

// Generate a QR code (PNG) for a given PDF in a folder and store it alongside as {name}-qr.png
router.post('/qr/link', async (req, res) => {
  try {
    const { folder, fileName, options, title } = req.body || {};
    if (!folder || !fileName) return res.status(400).json({ ok: false, error: 'folder_and_fileName_required' });

    const folderPath = normalizeFolderPath(String(folder));
    const f = db.getFolderByPath(folderPath);
    if (!f) return res.status(404).json({ ok: false, error: 'folder_not_found' });

    const doc = db.getDocumentByFolderAndFileName(folderPath, String(fileName));
    if (!doc) return res.status(404).json({ ok: false, error: 'document_not_found' });

    // Ensure it's a PDF (defensive)
    const isPdf = (doc.mime_type || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(doc.file_name || '');
    if (!isPdf) return res.status(400).json({ ok: false, error: 'pdf_only' });

    // Build absolute link for QR using PUBLIC_BASE_URL or request origin
    const publicBase = resolvePublicBaseUrl(req);
    const encodedFolderPath = encodePathSegments(f.pathSegments || []);
    const link = `${publicBase}/docs/${encodedFolderPath}/${encodeURIComponent(fileName)}`;

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

    const downloadUrl = `/docs/${encodedFolderPath}/${encodeURIComponent(qrFileName)}`;
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
