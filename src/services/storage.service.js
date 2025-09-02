// File storage service - SQLite BLOB storage
// All files are stored directly in the SQLite database as BLOBs

function sanitizeFileName(fileName) {
  return String(fileName).replace(/[^a-zA-Z0-9._\-]/g, '-');
}

function validateFileType(mimeType, fileName) {
  const isPdf = mimeType === 'application/pdf' || /\.pdf$/i.test(fileName || '');
  return isPdf;
}

function validateFileSize(size, maxSizeMB = 50) {
  const maxBytes = maxSizeMB * 1024 * 1024;
  return size <= maxBytes;
}

module.exports = { 
  sanitizeFileName, 
  validateFileType, 
  validateFileSize 
};
