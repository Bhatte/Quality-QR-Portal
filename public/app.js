// Toast helper with different types
function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  (document.getElementById('toasts') || document.body).appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 4000 : 2400);
}

// Session-based authentication - no token management needed
// Authentication is handled via session cookies with Passport.js

// Retry wrapper for API calls with detailed debugging
async function apiCall(url, options = {}, maxRetries = 3) {
  let lastError;
  
  // Add standard AJAX headers for admin routes (session-based auth)
  if (url.startsWith('/admin/')) {
    options.headers = {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json',
      ...(options.headers || {})
    };
    // Attach CSRF token for mutating requests (double-submit cookie)
    const method = (options.method || 'GET').toUpperCase();
    const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const xsrf = getCookie('XSRF-TOKEN');
    if (isMutating && xsrf) {
      options.headers['x-csrf-token'] = xsrf;
    }
    if (!options.credentials) {
      options.credentials = 'same-origin';
    }
  }
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`[API] ${options.method || 'GET'} ${url} (attempt ${i + 1}/${maxRetries})`);
      const response = await fetch(url, options);
      
      console.log(`[API] Response status: ${response.status} ${response.statusText}`);
      console.log(`[API] Response headers:`, Object.fromEntries(response.headers.entries()));
      const contentType = response.headers.get('content-type') || '';
      // Handle authentication redirections
      if (response.redirected && response.url.includes('/auth/login')) {
        console.log('[API] Redirected to login, forwarding browser.');
        window.location.href = response.url;
        return;
      }
      if (contentType.includes('text/html')) {
        console.log('[API] HTML response detected for API call; redirecting to login.');
        window.location.href = '/auth/login';
        return;
      }

      // Get response text first to debug what we're actually receiving
      const responseText = await response.text();
      console.log(`[API] Response body:`, responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error(`[API] JSON parse error:`, parseError);
        throw new Error(`Invalid JSON response: ${responseText.substring(0, 100)}`);
      }
      
      if (!response.ok && !data.ok) {
        // Handle authentication errors
        if (response.status === 401 || data.error === 'authentication_required') {
          console.log('[API] Authentication required, redirecting to login');
          window.location.href = '/auth/login';
          return; // Don't throw error, just redirect
        }
        
        // Check if it's a database lock error that we should retry
        const isRetryableError = data.error && (
          data.error.includes('locked') || 
          data.error.includes('busy') ||
          data.error.includes('SQLITE_BUSY') ||
          data.error.includes('SQLITE_LOCKED')
        );
        
        if (isRetryableError && i < maxRetries - 1) {
          const delay = Math.pow(2, i) * 100 + Math.random() * 100; // Exponential backoff with jitter
          console.log(`[API] Retrying ${i + 1}/${maxRetries} after ${Math.round(delay)}ms for:`, url);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      console.log(`[API] Success:`, data);
      return data;
    } catch (error) {
      console.error(`[API] Error on attempt ${i + 1}:`, error);
      lastError = error;
      
      // Network errors - retry
      if ((error.name === 'TypeError' || error.message.includes('fetch')) && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 200;
        console.log(`[API] Network retry ${i + 1}/${maxRetries} after ${delay}ms for:`, url);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Don't retry other errors
      break;
    }
  }
  
  throw lastError;
}

// Read cookie helper
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

let ALL_FOLDERS = [];
async function refreshFolders() {
  try {
    const data = await apiCall('/folders');
    ALL_FOLDERS = data.folders || [];
  } catch (error) {
    console.error('Failed to load folders:', error);
    toast(`Failed to load folders: ${error.message}`, 'error');
    ALL_FOLDERS = [];
  }

  const renderList = (items) => {
    const list = document.getElementById('folders');
    list.innerHTML = '';
    items.forEach(f => {
      const li = document.createElement('li');
      li.className = 'folder-item';
      li.dataset.folder = f.name || f;
      li.style.cursor = 'pointer';

      const row = document.createElement('div');
      row.className = 'folder-row';

      const nameWrap = document.createElement('div');
      nameWrap.className = 'folder-name';
      const nameEl = document.createElement('span');
      nameEl.textContent = f.displayName || f.name || f;
      nameEl.title = f.name;
      nameWrap.appendChild(nameEl);

      const actions = document.createElement('div');
      actions.className = 'folder-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.title = 'Rename folder';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // inline rename
        const input = document.createElement('input');
        input.className = 'admin-input';
        input.value = f.displayName || f.name;
        input.style.width = '100%';
        nameWrap.replaceChildren(input);
        input.focus();
        const commit = async () => {
          const newName = input.value.trim();
          if (newName === (f.displayName || f.name)) {
            nameWrap.replaceChildren(nameEl);
            return;
          }
          try {
            const out = await apiCall(`/admin/folder/${encodeURIComponent(f.name)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ displayName: newName })
            });
            await refreshFolders();
            toast('Folder renamed');
          } catch (error) {
            console.error('Rename failed:', error);
            toast(`Rename failed: ${error.message}`, 'error');
            nameWrap.replaceChildren(nameEl);
          }
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') commit();
          if (ev.key === 'Escape') nameWrap.replaceChildren(nameEl);
        });
        input.addEventListener('blur', commit);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.title = 'Delete folder';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const sure = confirm(`Delete folder "${f.name}" and all its documents? This cannot be undone.`);
        if (!sure) return;
        try {
          await apiCall(`/admin/folder/${encodeURIComponent(f.name)}`, { method: 'DELETE' });
          toast('Folder deleted');
          const select = document.getElementById('folderSelect');
          if (select && select.value === f.name) {
            select.value = '';
            document.getElementById('docs').innerHTML = '<div class="text-center py-12"><p class="text-muted">Select a folder to view documents.</p></div>';
          }
          refreshFolders();
        } catch (error) {
          console.error('Delete failed:', error);
          toast(`Failed to delete folder: ${error.message}`, 'error');
        }
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      row.appendChild(nameWrap);
      row.appendChild(actions);
      li.appendChild(row);

      li.addEventListener('click', () => {
        // highlight selection
        [...list.querySelectorAll('li.active')].forEach(el => el.classList.remove('active'));
        li.classList.add('active');
        const select = document.getElementById('folderSelect');
        if (select) select.value = f.name;
        loadDocuments(f.name);
        updateUploadState();
      });

      list.appendChild(li);
    });
  };

  // initial render & search binding
  const folderSearch = document.getElementById('folderSearch');
  const applyFilter = () => {
    const q = (folderSearch?.value || '').toLowerCase().trim();
    const items = q ? ALL_FOLDERS.filter(x => (x.displayName||x.name).toLowerCase().includes(q) || x.name.toLowerCase().includes(q)) : ALL_FOLDERS;
    renderList(items);
  };
  if (folderSearch && !folderSearch._bound) {
    folderSearch.addEventListener('input', applyFilter);
    folderSearch._bound = true;
  }
  applyFilter();

  // populate dropdown
  const select = document.getElementById('folderSelect');
  if (select) {
    const current = select.value;
    select.innerHTML = '<option value="">-- select folder --</option>';
    ALL_FOLDERS.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.name;
      opt.textContent = f.displayName || f.name;
      select.appendChild(opt);
    });
    if (current && [...select.options].some(o => o.value === current)) {
      select.value = current;
    }
  }
}

document.getElementById('createFolderBtn').addEventListener('click', async () => {
  const nameInput = document.getElementById('folderName');
  const createBtn = document.getElementById('createFolderBtn');
  const name = nameInput.value.trim();
  
  if (!name) { 
    toast('Enter folder name', 'error'); 
    nameInput.focus();
    return; 
  }
  
  // Disable button during creation
  createBtn.disabled = true;
  createBtn.textContent = 'Creating...';
  
  try {
    const result = await apiCall('/admin/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    nameInput.value = '';
    await refreshFolders();
    
    if (result.created) {
      toast('Folder created successfully');
    } else {
      toast('Folder already exists');
    }
  } catch (error) {
    console.error('Folder creation failed:', error);
    toast(`Failed to create folder: ${error.message}`, 'error');
  } finally {
    // Re-enable button
    createBtn.disabled = false;
    createBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Create';
  }
});

// Add keyboard support for folder creation
document.getElementById('folderName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('createFolderBtn').click();
  }
});

document.getElementById('uploadBtn').addEventListener('click', async () => {
  const category = document.getElementById('folderSelect').value.trim();
  const fileInput = document.getElementById('file');
  const uploadBtn = document.getElementById('uploadBtn');
  const status = document.getElementById('status');
  const progress = document.getElementById('progress');
  
  if (!category || !fileInput.files.length) { 
    toast('Select folder and choose a PDF', 'error'); 
    return; 
  }
  
  const f = fileInput.files[0];
  const isPdf = f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!isPdf) { 
    status.textContent = 'Only PDF files are supported.';
    status.style.color = 'var(--destructive)';
    toast('Only PDF files are supported', 'error');
    return; 
  }
  
  // Disable upload button and show progress
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';
  status.style.color = '';
  status.textContent = 'Uploading...';
  if (progress) progress.style.display = 'block';
  
  try {
    const form = new FormData();
    form.append('folder', category);
    form.append('file', f);
    
    const data = await apiCall('/admin/upload', { 
      method: 'POST', 
      body: form 
    }, 5); // More retries for uploads
    
    status.style.color = 'var(--success)';
    status.textContent = `Upload successful - ${data.document.fileName} (${Math.round(data.document.fileSize/1024)}KB)`;
    document.getElementById('portalUrl').textContent = data.portalUrl || '-';
    const copyBtn = document.getElementById('copyUrlBtn');
    if (copyBtn) copyBtn.disabled = !data.portalUrl;
    fileInput.value = '';
    document.getElementById('fileName').textContent = 'No file selected';
    
    if (category) loadDocuments(category);
    toast('Upload successful');
    
  } catch (error) {
    console.error('Upload failed:', error);
    const errorMsg = error.message.includes('pdf_only') ? 'Only PDF files are supported.' : 
                     error.message.includes('file_too_large') ? 'File too large (max 50MB).' :
                     error.message.includes('locked') ? 'Database busy, please try again.' :
                     `Upload failed: ${error.message}`;
    status.textContent = errorMsg;
    status.style.color = 'var(--destructive)';
    toast(errorMsg, 'error');
  } finally {
    // Re-enable upload button and hide progress
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7,10 12,15 17,10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>Upload';
    if (progress) progress.style.display = 'none';
    updateUploadState();
  }
});

refreshFolders();

let CURRENT_DOCS = [];
async function loadDocuments(folder) {
  const docsRoot = document.getElementById('docs');
  docsRoot.innerHTML = '<div class="text-center py-12"><p class="text-muted">Loading...</p></div>';
  
  try {
    // Use admin endpoint to get ALL versions of documents
    const data = await apiCall(`/admin/folder/${encodeURIComponent(folder)}/documents`);
    
    if (!data.documents || !data.documents.length) {
      docsRoot.textContent = '';
      const container = document.createElement('div');
      container.className = 'text-center py-12';
      const p = document.createElement('p');
      p.className = 'text-muted';
      p.textContent = 'No documents uploaded yet.';
      container.appendChild(p);
      docsRoot.appendChild(container);
      CURRENT_DOCS = [];
      return;
    }
    
    CURRENT_DOCS = data.documents;
    renderDocuments(folder);
  } catch (error) {
    console.error('Failed to load documents:', error);
    docsRoot.textContent = '';
    const container = document.createElement('div');
    container.className = 'text-center py-12';
    const p = document.createElement('p');
    p.className = 'text-muted text-destructive';
    p.textContent = `Failed to load documents: ${error.message}`;
    container.appendChild(p);
    docsRoot.appendChild(container);
    toast(`Failed to load documents: ${error.message}`, 'error');
    CURRENT_DOCS = [];
  }
}

function renderDocuments(folder) {
  const docsRoot = document.getElementById('docs');
  const docsSearch = document.getElementById('docsSearch');
  const q = (docsSearch?.value || '').toLowerCase().trim();
  let items = CURRENT_DOCS;
  if (q) items = items.filter(x => (x.file_name||'').toLowerCase().includes(q));

  // Sort all documents by filename, then by version descending
  items.sort((a, b) => {
    if (a.file_name !== b.file_name) {
      return a.file_name.localeCompare(b.file_name);
    }
    return b.version - a.version; // Higher versions first
  });

  docsRoot.innerHTML = '';
  if (!items.length) { docsRoot.textContent = 'No matching documents.'; return; }
  
  const ul = document.createElement('ul');

  // Helper: get latest QR document for a base name
  const getLatestQr = (base) => {
    const target = `${base}-qr.png`;
    const versions = CURRENT_DOCS.filter(d => d.file_name === target);
    if (!versions.length) return null;
    versions.sort((a, b) => b.version - a.version);
    return versions[0];
  };

  // Render each document version as a separate row
  for (const doc of items) {
    // Hide standalone QR image rows (they will be shown inline with their PDF)
    const isQrPng = /-qr\.png$/i.test(doc.file_name || '');
    if (isQrPng) {
      const base = String(doc.file_name).replace(/-qr\.png$/i, '');
      const hasPdfSibling = CURRENT_DOCS.some(d => /\.pdf$/i.test(d.file_name) && d.file_name.replace(/\.[^.]+$/, '') === base);
      if (hasPdfSibling) {
        continue; // skip separate QR row to reduce confusion
      }
    }
    const li = document.createElement('li');
    const left = document.createElement('div');
    const sizeKB = Math.round(doc.file_size / 1024);
    
    // Check if this is the latest version for this filename
    const allVersionsOfFile = CURRENT_DOCS.filter(d => d.file_name === doc.file_name);
    const maxVersion = Math.max(...allVersionsOfFile.map(d => d.version));
    const isLatest = doc.version === maxVersion;
    // Build left content safely
    const strong = document.createElement('strong');
    strong.textContent = doc.file_name;
    left.appendChild(strong);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = isLatest ? `v${doc.version} (latest)` : `v${doc.version}`;
    if (isLatest) { badge.style.background = 'var(--success)'; badge.style.color = 'white'; }
    left.appendChild(document.createTextNode(' '));
    left.appendChild(badge);
    const sizeEl = document.createElement('span');
    sizeEl.className = 'text-muted';
    sizeEl.textContent = ` (${sizeKB}KB)`;
    left.appendChild(document.createTextNode(' '));
    left.appendChild(sizeEl);

    const right = document.createElement('div');
    right.className = 'row';
    
    const open = document.createElement('a');
    open.href = `/docs/${encodeURIComponent(folder)}/${encodeURIComponent(doc.file_name)}`;
    open.target = '_blank';
    open.className = 'link';
    open.textContent = 'Open';
    
    const copy = document.createElement('button');
    copy.className = 'btn btn--outline btn--sm';
    copy.title = 'Copy Portal URL (always latest)';
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      const url = open.href;
      try { await navigator.clipboard.writeText(url); toast('Portal URL copied'); } catch(_) {}
    });
    
    right.appendChild(open);
    right.appendChild(copy);

    // QR Generation controls for PDF documents
    const isPdfDoc = (doc.mime_type || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(doc.file_name || '');
    if (isPdfDoc) {
      const base = String(doc.file_name).replace(/\.[^.]+$/, '');
      const qrDoc = getLatestQr(base);

      if (qrDoc) {
        const openQr = document.createElement('a');
        openQr.href = `/docs/${encodeURIComponent(folder)}/${encodeURIComponent(qrDoc.file_name)}`;
        openQr.target = '_blank';
        openQr.className = 'link';
        openQr.textContent = 'Open QR';
        right.appendChild(openQr);

        // Download QR
        const downloadQr = document.createElement('a');
        downloadQr.href = openQr.href;
        downloadQr.download = qrDoc.file_name;
        downloadQr.className = 'btn btn--outline btn--sm';
        downloadQr.textContent = 'Download';
        right.appendChild(downloadQr);

        // Inline preview thumbnail (placed under left column)
        const previewWrap = document.createElement('div');
        previewWrap.style.display = 'block';
        previewWrap.style.marginTop = '8px';
        const thumb = document.createElement('img');
        thumb.src = openQr.href;
        thumb.alt = `QR preview for ${doc.file_name}`;
        thumb.width = 96;
        thumb.loading = 'lazy';
        thumb.style.height = 'auto';
        thumb.style.border = '1px solid var(--border)';
        thumb.style.borderRadius = '12px';
        previewWrap.appendChild(thumb);
        left.appendChild(previewWrap);
      }

      const gen = document.createElement('button');
      gen.className = 'btn btn--primary btn--sm';
      gen.title = qrDoc ? 'Regenerate QR' : 'Generate QR';
      gen.textContent = qrDoc ? 'Regenerate QR' : 'Generate QR';
      gen.addEventListener('click', async () => {
        const prev = gen.textContent;
        gen.disabled = true;
        gen.textContent = 'Generating...';
        try {
          const payload = { folder, fileName: doc.file_name };
          await apiCall('/admin/qr/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          toast('QR generated');
          await loadDocuments(folder);
        } catch (error) {
          console.error('QR generation failed:', error);
          toast(`QR generation failed: ${error.message}`, 'error');
        } finally {
          gen.disabled = false;
          gen.textContent = prev;
        }
      });

      right.appendChild(gen);
    }

    const del = document.createElement('button');
    del.className = 'btn btn--outline btn--sm';
    del.title = `Delete version ${doc.version}`;
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      const versionText = isLatest ? `latest version v${doc.version}` : `version v${doc.version}`;
      if (!confirm(`Delete ${versionText} of ${doc.file_name}?`)) return;
      
      del.disabled = true;
      del.textContent = 'Deleting...';
      
      try {
        await apiCall(`/admin/document/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
        toast(`Deleted v${doc.version}`);
        loadDocuments(folder);
      } catch (error) {
        console.error('Delete failed:', error);
        toast(`Delete failed: ${error.message}`, 'error');
        del.disabled = false;
        del.textContent = 'Delete';
      }
    });
    
    right.appendChild(open);
    right.appendChild(copy);
    right.appendChild(del);

    li.appendChild(left);
    li.appendChild(right);
    ul.appendChild(li);
  }
  docsRoot.appendChild(ul);
}

// Copy button
document.getElementById('copyUrlBtn').addEventListener('click', async () => {
  const url = document.getElementById('portalUrl').textContent.trim();
  if (!url || url === '-') return;
  const absolute = url.startsWith('http') ? url : `${location.origin}${url}`;
  try {
    await navigator.clipboard.writeText(absolute);
    toast('Copied');
  } catch (e) {
    console.error('Clipboard failed', e);
  }
});

// Drag & drop upload
const dropZone = document.getElementById('dropZone');
['dragenter','dragover'].forEach(evt => dropZone.addEventListener(evt, e => {
  e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag');
}));
['dragleave','drop'].forEach(evt => dropZone.addEventListener(evt, e => {
  e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag');
}));
// Click to open file chooser
dropZone.addEventListener('click', () => {
  const fileEl = document.getElementById('file');
  if (fileEl) fileEl.click();
});
dropZone.addEventListener('drop', async (e) => {
  const category = document.getElementById('folderSelect').value.trim();
  const file = e.dataTransfer?.files?.[0];
  const status = document.getElementById('status');
  const progress = document.getElementById('progress');
  const uploadBtn = document.getElementById('uploadBtn');
  
  if (!category || !file) { 
    toast('Select folder first, then drop a PDF', 'error'); 
    return; 
  }
  
  const isPdf = file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
  if (!isPdf) { 
    status.textContent = 'Only PDF files are supported.';
    status.style.color = 'var(--destructive)';
    toast('Only PDF files are supported', 'error');
    return; 
  }
  
  // Update UI to show upload in progress
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';
  status.style.color = '';
  status.textContent = 'Uploading via drag & drop...';
  if (progress) progress.style.display = 'block';
  
  try {
    const form = new FormData();
    form.append('folder', category);
    form.append('file', file);
    
    const data = await apiCall('/admin/upload', { 
      method: 'POST', 
      body: form 
    }, 5); // More retries for uploads
    
    status.style.color = 'var(--success)';
    status.textContent = `Upload successful - ${data.document.fileName} (${Math.round(data.document.fileSize/1024)}KB)`;
    document.getElementById('portalUrl').textContent = data.portalUrl || '-';
    const copyBtn = document.getElementById('copyUrlBtn');
    if (copyBtn) copyBtn.disabled = !data.portalUrl;
    
    if (category) loadDocuments(category);
    toast('Upload successful');
    
  } catch (error) {
    console.error('Drag & drop upload failed:', error);
    const errorMsg = error.message.includes('pdf_only') ? 'Only PDF files are supported.' : 
                     error.message.includes('file_too_large') ? 'File too large (max 50MB).' :
                     error.message.includes('locked') ? 'Database busy, please try again.' :
                     `Upload failed: ${error.message}`;
    status.textContent = errorMsg;
    status.style.color = 'var(--destructive)';
    toast(errorMsg, 'error');
  } finally {
    // Re-enable upload button and hide progress
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7,10 12,15 17,10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>Upload';
    if (progress) progress.style.display = 'none';
    updateUploadState();
  }
});

// React to folder dropdown change
document.getElementById('folderSelect').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v) loadDocuments(v);
  updateUploadState();
});

// Bind docs search to re-render
const docsSearch = document.getElementById('docsSearch');
if (docsSearch) {
  docsSearch.addEventListener('input', () => {
    const folder = document.getElementById('folderSelect').value;
    if (!folder) return;
    renderDocuments(folder);
  });
}

// File input: show chosen file name
const fileInput = document.getElementById('file');
const fileNameEl = document.getElementById('fileName');
if (fileInput && fileNameEl) {
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileNameEl.textContent = f ? f.name : 'No file chosen';
    updateUploadState();
  });
}

// Upload button enable/disable management
function updateUploadState() {
  const uploadBtn = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('file');
  const folder = document.getElementById('folderSelect')?.value?.trim();
  const f = fileInput?.files?.[0];
  const isPdf = f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const ok = Boolean(folder) && Boolean(isPdf);
  if (uploadBtn) uploadBtn.disabled = !ok;
}

// Initialize authentication status and load folders
async function initializeApp() {
  try {
    const authStatus = await fetch('/auth/status', { credentials: 'same-origin' });
    const auth = await authStatus.json();
    
    // Elements that may exist depending on page
    const authInfo = document.getElementById('authInfo'); // legacy floating box (removed on admin.html)
    const userEmail = document.getElementById('userEmail');
    const userBadge = document.getElementById('userBadge'); // inline header badge on admin page
    const logoutBtn = document.getElementById('logoutBtn');
    
    if (auth.authenticated && auth.user) {
      // Legacy support
      if (userEmail) userEmail.textContent = auth.user.email;
      if (authInfo) authInfo.style.display = 'block';
      // New inline badge in header
      if (userBadge) {
        userBadge.textContent = auth.user.email;
        userBadge.style.display = 'inline-flex';
        userBadge.title = `Signed in as ${auth.user.email}`;
      }
    }

    if (logoutBtn && !logoutBtn._bound) {
      logoutBtn.addEventListener('click', logout);
      logoutBtn._bound = true;
    }
  } catch (error) {
    console.log('[AUTH] Could not load auth status:', error);
  }
  
  refreshFolders();
}

// Logout function
function logout() {
  window.location.href = '/auth/logout';
}

// Make logout available globally
window.logout = logout;

initializeApp();
