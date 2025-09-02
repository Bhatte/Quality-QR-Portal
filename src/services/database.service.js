const path = require('path');
const db = require('../db/init');

// Retry wrapper for database operations
function withRetry(operation, maxRetries = 3, delay = 100) {
  return function(...args) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return operation.apply(this, args);
      } catch (error) {
        lastError = error;
        if (error.code === 'SQLITE_BUSY' || error.message.includes('locked')) {
          console.log(`[DB] Database locked, retry ${i + 1}/${maxRetries} after ${delay}ms`);
          // Synchronous sleep for simplicity
          const start = Date.now();
          while (Date.now() - start < delay) {
            // Busy wait
          }
          delay *= 2; // Exponential backoff
          continue;
        }
        throw error; // Re-throw non-lock errors immediately
      }
    }
    throw lastError;
  };
}

function mapFolder(row) {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name || row.name,
    parentId: row.parent_id || null,
    createdAt: row.created_at
  };
}

module.exports = {
  getFolders() {
    const getFoldersWithRetry = withRetry(() => {
      const rows = db.prepare('SELECT * FROM folders ORDER BY name ASC').all();
      console.log(`[DB] getFolders() returned ${rows.length} rows:`, rows);
      return rows.map(mapFolder);
    });
    
    return getFoldersWithRetry();
  },

  getFolderByName(name) {
    const row = db.prepare('SELECT * FROM folders WHERE name = ?').get(name);
    return row ? mapFolder(row) : null;
  },

  createFolder({ name, displayName = null, parentId = null }) {
    console.log(`[DB] Creating folder: name="${name}", displayName="${displayName}", parentId="${parentId}"`);
    
    // Use retry wrapper for the entire operation
    const createWithRetry = withRetry(() => {
      // Use explicit transaction to ensure data persistence
      const transaction = db.transaction(() => {
        const stmt = db.prepare(
          'INSERT INTO folders (name, display_name, parent_id) VALUES (?, ?, ?)'
        );
        const info = stmt.run(name, displayName, parentId);
        console.log(`[DB] Insert result:`, info);
        
        // Force WAL checkpoint to ensure persistence
        db.pragma('wal_checkpoint(PASSIVE)');
        
        const folder = this.getFolderById(info.lastInsertRowid);
        console.log(`[DB] Retrieved folder after creation:`, folder);
        
        if (!folder) {
          throw new Error('Folder creation verification failed');
        }
        
        return folder;
      });
      
      return transaction();
    });
    
    return createWithRetry();
  },

  getFolderById(id) {
    const row = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
    return row ? mapFolder(row) : null;
  },

  addDocument({ folderId, fileName, fileContent, fileSize, mimeType, version = 1, uploadedBy = null, notes = null }) {
    const stmt = db.prepare(
      'INSERT INTO documents (folder_id, file_name, file_content, file_size, mime_type, version, uploaded_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const info = stmt.run(folderId, fileName, fileContent, fileSize, mimeType, version, uploadedBy, notes);
    return this.getDocumentById(info.lastInsertRowid);
  },

  getDocumentById(id) {
    return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) || null;
  },

  getDocumentContent(id) {
    const row = db.prepare('SELECT file_content, file_name, mime_type, file_size FROM documents WHERE id = ?').get(id);
    return row || null;
  },

  getNextVersion(folderId, fileName) {
    const row = db.prepare(
      'SELECT COALESCE(MAX(version), 0) AS maxv FROM documents WHERE folder_id = ? AND file_name = ?'
    ).get(folderId, fileName);
    return (row?.maxv || 0) + 1;
  },

  getDocumentByFolderAndFileName(folderName, fileName) {
    const row = db.prepare(
      `SELECT d.id, d.folder_id, d.file_name, d.file_size, d.mime_type, d.version, d.uploaded_by, d.uploaded_at, d.notes 
       FROM documents d
       JOIN folders f ON f.id = d.folder_id
       WHERE f.name = ? AND d.file_name = ?
       ORDER BY d.version DESC LIMIT 1`
    ).get(folderName, fileName);
    return row || null;
  },

  getDocumentsInFolder(folderName) {
    // Get only the latest version of each document for public display
    const rows = db.prepare(
      `SELECT d.id, d.folder_id, d.file_name, d.file_size, d.mime_type, d.version, d.uploaded_by, d.uploaded_at, d.notes 
       FROM documents d
       JOIN folders f ON f.id = d.folder_id
       WHERE f.name = ? AND d.version = (
         SELECT MAX(d2.version) 
         FROM documents d2 
         WHERE d2.folder_id = d.folder_id AND d2.file_name = d.file_name
       )
       ORDER BY d.file_name ASC, d.uploaded_at DESC`
    ).all(folderName);
    return rows;
  },

  getAllDocumentsInFolder(folderName) {
    // Get ALL versions of documents (for admin use)
    const rows = db.prepare(
      `SELECT d.id, d.folder_id, d.file_name, d.file_size, d.mime_type, d.version, d.uploaded_by, d.uploaded_at, d.notes 
       FROM documents d
       JOIN folders f ON f.id = d.folder_id
       WHERE f.name = ?
       ORDER BY d.file_name ASC, d.version DESC, d.uploaded_at DESC`
    ).all(folderName);
    return rows;
  },

  getDocumentsByFolderAndFileName(folderName, fileName) {
    const rows = db.prepare(
      `SELECT d.id, d.folder_id, d.file_name, d.file_size, d.mime_type, d.version, d.uploaded_by, d.uploaded_at, d.notes 
       FROM documents d
       JOIN folders f ON f.id = d.folder_id
       WHERE f.name = ? AND d.file_name = ?
       ORDER BY d.version DESC`
    ).all(folderName, fileName);
    return rows;
  },

  deleteDocumentsByFolderAndFileName(folderName, fileName) {
    const folder = this.getFolderByName(folderName);
    if (!folder) return { changes: 0 };
    const info = db.prepare('DELETE FROM documents WHERE folder_id = ? AND file_name = ?')
      .run(folder.id, fileName);
    return { changes: info.changes };
  },

  deleteDocumentById(id) {
    const info = db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    return { changes: info.changes };
  },

  deleteDocumentsInFolder(folderName) {
    const folder = this.getFolderByName(folderName);
    if (!folder) return { changes: 0 };
    const info = db.prepare('DELETE FROM documents WHERE folder_id = ?').run(folder.id);
    return { changes: info.changes };
  },

  deleteFolderByName(name) {
    const info = db.prepare('DELETE FROM folders WHERE name = ?').run(name);
    return { changes: info.changes };
  },

  updateFolderDisplayName(name, displayName) {
    const stmt = db.prepare('UPDATE folders SET display_name = ? WHERE name = ?');
    const info = stmt.run(displayName, name);
    return { changes: info.changes };
  }
};
