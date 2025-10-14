const db = require('../db/init');

// Retry wrapper for database operations with simple exponential backoff.
// Reduced retries and delays for better UI responsiveness
function withRetry(operation, maxRetries = 3, baseDelay = 20) {
  return function wrapped(...args) {
    let lastError;
    for (let i = 0; i < maxRetries; i += 1) {
      try {
        return operation.apply(this, args);
      } catch (error) {
        lastError = error;
        const message = String(error.message || '');
        const isLockError = error.code === 'SQLITE_BUSY'
          || error.code === 'SQLITE_LOCKED'
          || message.includes('locked')
          || message.includes('busy');

        if (!isLockError || i === maxRetries - 1) break;

        const delay = baseDelay * (2 ** i) + Math.random() * 50;
        console.log(`[DB] Retrying locked statement (${i + 1}/${maxRetries}) after ${Math.round(delay)}ms`);
        const start = Date.now();
        // Busy-wait - acceptable for short retry windows.
        while (Date.now() - start < delay) {
          /* noop */
        }
      }
    }
    throw lastError;
  };
}

const MAX_SLUG_LENGTH = 64;

function toSegments(value) {
  return String(value || '')
    .split('/')
    .map(seg => decodeURIComponent(seg.trim()))
    .filter(Boolean);
}

function slugifySegment(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'folder';
  const slug = trimmed
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);
  return slug || 'folder';
}

function joinPath(segments) {
  return segments.filter(Boolean).join('/');
}

function normalisePathInput(path) {
  if (Array.isArray(path)) return joinPath(path);
  return joinPath(toSegments(path));
}

function mapFolderRow(row) {
  if (!row) return null;
  const segments = toSegments(row.name);
  const depth = segments.length;
  const slug = segments[segments.length - 1] || row.name;
  return {
    id: row.id,
    name: row.name,
    path: row.name,
    slug,
    pathSegments: segments,
    depth,
    displayName: row.display_name || slug,
    parentId: row.parent_id || null,
    createdAt: row.created_at,
  };
}

function mapFolderQrRow(row, includeContent = false) {
  if (!row) return null;
  const base = {
    id: row.id,
    folderId: row.folder_id,
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    version: row.version,
    entryUid: row.entry_uid,
    generatedAt: row.generated_at,
    notes: row.notes ? tryParseJson(row.notes) : null,
  };
  if (includeContent) base.fileContent = row.file_content;
  return base;
}

function tryParseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return value;
  }
}

const fetchFolderById = withRetry((id) => {
  const row = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  return mapFolderRow(row);
});

const fetchFolderByName = withRetry((name) => {
  const row = db.prepare('SELECT * FROM folders WHERE name = ?').get(name);
  return mapFolderRow(row);
});

const fetchFolderRowByName = withRetry((name) => {
  return db.prepare('SELECT * FROM folders WHERE name = ?').get(name) || null;
});

function ensureUniquePath(candidatePath) {
  let pathCandidate = candidatePath;
  let counter = 1;
  while (fetchFolderRowByName(pathCandidate)) {
    counter += 1;
    pathCandidate = `${candidatePath}-${counter}`;
  }
  return pathCandidate;
}

function buildFolderTree(rows) {
  const byId = new Map();
  rows.forEach((row) => {
    const mapped = mapFolderRow(row);
    mapped.children = [];
    byId.set(mapped.id, mapped);
  });

  const roots = [];
  const attach = (folder) => {
    if (folder.parentId && byId.has(folder.parentId)) {
      byId.get(folder.parentId).children.push(folder);
    } else {
      roots.push(folder);
    }
  };

  byId.forEach(attach);

  const sortRecursive = (list) => {
    list.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
    list.forEach(child => sortRecursive(child.children));
  };

  sortRecursive(roots);
  return roots;
}

function getBreadcrumbs(folder) {
  if (!folder) return [];
  const crumbs = [];
  let current = folder;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    crumbs.unshift({ name: current.name, displayName: current.displayName });
    seen.add(current.id);
    current = current.parentId ? fetchFolderById(current.parentId) : null;
  }
  return crumbs;
}

const databaseService = {
  // Folder helpers --------------------------------------------------------
  getFolders() {
    const rows = db.prepare('SELECT * FROM folders ORDER BY name ASC').all();
    return rows.map(mapFolderRow);
  },

  getFolderTree() {
    const rows = db.prepare('SELECT * FROM folders').all();
    return buildFolderTree(rows);
  },

  getFolderDocumentCountMap() {
    const rows = db.prepare('SELECT folder_id, COUNT(DISTINCT file_name) AS count FROM documents GROUP BY folder_id').all();
    const map = new Map();
    rows.forEach((row) => {
      map.set(row.folder_id, row.count);
    });
    return map;
  },

  getFolderQrPresenceMap() {
    const rows = db.prepare('SELECT folder_id, MAX(version) AS version FROM folder_qr_codes GROUP BY folder_id').all();
    const map = new Map();
    rows.forEach((row) => {
      map.set(row.folder_id, row.version);
    });
    return map;
  },

  getFolderByName(name) {
    return fetchFolderByName(name);
  },

  getFolderByPath(path) {
    const normalised = normalisePathInput(path);
    if (!normalised) return null;
    return fetchFolderByName(normalised);
  },

  getFolderById(id) {
    return fetchFolderById(id);
  },

  getChildFolders(parentId = null) {
    const stmt = parentId
      ? db.prepare('SELECT * FROM folders WHERE parent_id = ? ORDER BY display_name COLLATE NOCASE ASC, name ASC')
      : db.prepare('SELECT * FROM folders WHERE parent_id IS NULL ORDER BY display_name COLLATE NOCASE ASC, name ASC');
    const rows = parentId ? stmt.all(parentId) : stmt.all();
    return rows.map(mapFolderRow);
  },

  createFolder({ name, displayName = null, parentId = null, parentPath = null, slug = null } = {}) {
    const label = String(displayName || name || slug || '').trim() || 'Folder';
    let parent = null;

    if (parentId) {
      parent = fetchFolderById(parentId);
      if (!parent) throw new Error('parent_not_found');
    } else if (parentPath) {
      parent = this.getFolderByPath(parentPath);
      if (!parent) throw new Error('parent_not_found');
    }

    const segmentSlug = slug ? slugifySegment(slug) : slugifySegment(name || displayName || 'folder');
    const parentPathValue = parent ? parent.name : null;
    const candidatePath = parentPathValue ? `${parentPathValue}/${segmentSlug}` : segmentSlug;
    const finalPath = ensureUniquePath(candidatePath);

    const transaction = db.transaction(() => {
      const stmt = db.prepare(
        'INSERT INTO folders (name, display_name, parent_id) VALUES (?, ?, ?)',
      );
      const info = stmt.run(finalPath, label, parent ? parent.id : null);
      return info.lastInsertRowid;
    });

    const insertedId = withRetry(() => transaction())();
    return fetchFolderById(insertedId);
  },

  updateFolderDisplayName(path, displayName) {
    const normalised = normalisePathInput(path);
    const stmt = db.prepare('UPDATE folders SET display_name = ? WHERE name = ?');
    const result = stmt.run(displayName, normalised);
    return { changes: result.changes };
  },

  deleteFolderDeep(path) {
    const normalised = normalisePathInput(path);
    const folderRow = fetchFolderRowByName(normalised);
    if (!folderRow) {
      return { foldersDeleted: 0, documentsDeleted: 0, qrDeleted: 0 };
    }

    const descendantRows = db.prepare(
      'SELECT id, name FROM folders WHERE name = ? OR name LIKE ?'
    ).all(normalised, `${normalised}/%`);

    let documentsDeleted = 0;
    let qrDeleted = 0;

    const docStmt = db.prepare('DELETE FROM documents WHERE folder_id = ?');
    const qrStmt = db.prepare('DELETE FROM folder_qr_codes WHERE folder_id = ?');
    descendantRows.forEach((row) => {
      documentsDeleted += docStmt.run(row.id).changes;
      qrDeleted += qrStmt.run(row.id).changes;
    });

    const foldersDeleted = db.prepare('DELETE FROM folders WHERE name = ? OR name LIKE ?')
      .run(normalised, `${normalised}/%`).changes;

    return { foldersDeleted, documentsDeleted, qrDeleted };
  },

  // Document helpers -----------------------------------------------------
  addDocument({ folderId, fileName, fileContent, fileSize, mimeType, version = 1, uploadedBy = null, notes = null }) {
    const transaction = db.transaction(() => {
      const stmt = db.prepare(
        'INSERT INTO documents (folder_id, file_name, file_content, file_size, mime_type, version, uploaded_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const info = stmt.run(folderId, fileName, fileContent, fileSize, mimeType, version, uploadedBy, notes);
      return info.lastInsertRowid;
    });

    const insertId = withRetry(() => transaction())();
    return this.getDocumentById(insertId);
  },

  getDocumentById(id) {
    return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) || null;
  },

  getDocumentContent(id) {
    return db.prepare('SELECT file_content, file_name, mime_type, file_size FROM documents WHERE id = ?').get(id) || null;
  },

  getNextDocumentVersion(folderId, fileName) {
    const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS maxv FROM documents WHERE folder_id = ? AND file_name = ?')
      .get(folderId, fileName);
    return (row?.maxv || 0) + 1;
  },

  // Backwards compatible alias
  getNextVersion(folderId, fileName) {
    return this.getNextDocumentVersion(folderId, fileName);
  },

  getDocumentByFolderAndFileName(folderPath, fileName) {
    const normalised = normalisePathInput(folderPath);
    const row = db.prepare(
      `SELECT d.id, d.folder_id, d.file_name, d.file_size, d.mime_type, d.version, d.uploaded_by, d.uploaded_at, d.notes
       FROM documents d
       JOIN folders f ON f.id = d.folder_id
       WHERE f.name = ? AND d.file_name = ?
       ORDER BY d.version DESC LIMIT 1`,
    ).get(normalised, fileName);
    return row || null;
  },

  getDocumentsInFolder(folderPath) {
    const normalised = normalisePathInput(folderPath);
    const rows = db.prepare(
      `SELECT d.id, d.folder_id, d.file_name, d.file_size, d.mime_type, d.version, d.uploaded_by, d.uploaded_at, d.notes
       FROM documents d
       JOIN folders f ON f.id = d.folder_id
       WHERE f.name = ? AND d.version = (
         SELECT MAX(d2.version) FROM documents d2 WHERE d2.folder_id = d.folder_id AND d2.file_name = d.file_name
       )
       ORDER BY d.file_name COLLATE NOCASE ASC, d.uploaded_at DESC`,
    ).all(normalised);
    return rows;
  },

  getAllDocumentsInFolder(folderPath) {
    const normalised = normalisePathInput(folderPath);
    const rows = db.prepare(
      `SELECT d.id, d.folder_id, d.file_name, d.file_size, d.mime_type, d.version, d.uploaded_by, d.uploaded_at, d.notes
       FROM documents d
       JOIN folders f ON f.id = d.folder_id
       WHERE f.name = ?
       ORDER BY d.file_name COLLATE NOCASE ASC, d.version DESC, d.uploaded_at DESC`,
    ).all(normalised);
    return rows;
  },

  getDocumentsByFolderAndFileName(folderPath, fileName) {
    const normalised = normalisePathInput(folderPath);
    const rows = db.prepare(
      `SELECT d.id, d.folder_id, d.file_name, d.file_size, d.mime_type, d.version, d.uploaded_by, d.uploaded_at, d.notes
       FROM documents d
       JOIN folders f ON f.id = d.folder_id
       WHERE f.name = ? AND d.file_name = ?
       ORDER BY d.version DESC`,
    ).all(normalised, fileName);
    return rows;
  },

  deleteDocumentById(id) {
    const result = db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    return { changes: result.changes };
  },

  deleteDocumentsInFolder(folderPath) {
    const folder = this.getFolderByPath(folderPath);
    if (!folder) return { changes: 0 };
    const result = db.prepare('DELETE FROM documents WHERE folder_id = ?').run(folder.id);
    return { changes: result.changes };
  },

  deleteDocumentsByFolderAndFileName(folderPath, fileName) {
    const folder = this.getFolderByPath(folderPath);
    if (!folder) return { changes: 0 };
    const result = db.prepare('DELETE FROM documents WHERE folder_id = ? AND file_name = ?')
      .run(folder.id, fileName);
    return { changes: result.changes };
  },

  // Folder QR helpers ----------------------------------------------------
  getFolderQr(folderPath, { includeContent = false } = {}) {
    const folder = typeof folderPath === 'object' && folderPath?.id
      ? folderPath
      : this.getFolderByPath(folderPath);
    if (!folder) return null;

    const columns = includeContent
      ? '*'
      : 'id, folder_id, file_name, file_size, mime_type, version, entry_uid, generated_at, notes';
    const row = db.prepare(`SELECT ${columns} FROM folder_qr_codes WHERE folder_id = ? ORDER BY version DESC LIMIT 1`)
      .get(folder.id);
    return mapFolderQrRow(row, includeContent);
  },

  saveFolderQr({ folderPath, folderId, fileName, fileContent, entryUid = null, notes = null }) {
    const folder = folderId ? fetchFolderById(folderId) : this.getFolderByPath(folderPath);
    if (!folder) throw new Error('folder_not_found');

    const versionRow = db.prepare('SELECT COALESCE(MAX(version), 0) AS maxv FROM folder_qr_codes WHERE folder_id = ?')
      .get(folder.id);
    const nextVersion = (versionRow?.maxv || 0) + 1;
    const payloadNotes = notes ? JSON.stringify(notes) : null;

    const stmt = db.prepare(
      `INSERT INTO folder_qr_codes (folder_id, file_name, file_content, file_size, mime_type, version, entry_uid, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    stmt.run(
      folder.id,
      fileName,
      fileContent,
      fileContent.length,
      'image/png',
      nextVersion,
      entryUid || null,
      payloadNotes,
    );

    return this.getFolderQr(folder, { includeContent: false });
  },

  deleteFolderQr(folderPath) {
    const folder = this.getFolderByPath(folderPath);
    if (!folder) return { changes: 0 };
    const result = db.prepare('DELETE FROM folder_qr_codes WHERE folder_id = ?').run(folder.id);
    return { changes: result.changes };
  },

  deleteFolderByName(path) {
    return this.deleteFolderDeep(path);
  },

  // Aggregated helpers ---------------------------------------------------
  getFolderDetail(folderPath) {
    const folder = this.getFolderByPath(folderPath);
    if (!folder) return null;
    const children = this.getChildFolders(folder.id);
    const documents = this.getDocumentsInFolder(folder.name);
    const qr = this.getFolderQr(folder, { includeContent: false });
    const breadcrumbs = getBreadcrumbs(folder);
    return { folder, children, documents, qr, breadcrumbs };
  },
};

module.exports = databaseService;
