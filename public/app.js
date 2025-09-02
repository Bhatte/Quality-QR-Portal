// Toast helper with different types
function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  (document.getElementById('toasts') || document.body).appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 4000 : 2400);
}

// Acquire and cache Easy Auth id_token to use as Authorization header when calling admin APIs.
// This helps avoid upstream Easy Auth CSRF rejections for state-changing methods.
let __EA_TOKEN = null;
let __EA_TOKEN_EXP = 0;
async function getEasyAuthIdToken() {
  try {
    const now = Date.now();
    if (__EA_TOKEN && now < __EA_TOKEN_EXP) return __EA_TOKEN;
    const r = await fetch('/.auth/me', { credentials: 'same-origin' });
    if (!r.ok) return null;
    const arr = await r.json();
    const entry = Array.isArray(arr) ? arr[0] : null;
    const bearer = entry?.access_token || entry?.id_token;
    if (bearer) {
      __EA_TOKEN = bearer;
      __EA_TOKEN_EXP = now + 9 * 60 * 1000; // cache ~9 minutes
      return __EA_TOKEN;
    }
  } catch (_) { /* ignore */ }
  return null;
}

// Retry wrapper for API calls with detailed debugging
async function apiCall(url, options = {}, maxRetries = 3) {
  let lastError;
  
  // Only add AJAX headers for admin routes to help with Azure Easy Auth detection
  if (url.startsWith('/admin/')) {
    const token = await getEasyAuthIdToken().catch(() => null);
    options.headers = {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}`, 'X-ZUMO-AUTH': token } : {}),
      ...(options.headers || {})
    };
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
      // Handle Azure Easy Auth redirections or HTML login pages
      if (response.redirected && response.url.includes('/.auth/login')) {
        console.log('[API] Redirected to Easy Auth login, forwarding browser.');
        window.location.href = response.url;
        return;
      }
      if (contentType.includes('text/html')) {
        console.log('[API] HTML response detected for API call; redirecting to login.');
        const returnUrl = encodeURIComponent(window.location.href);
        window.location.href = `/.auth/login/aad?post_login_redirect_url=${returnUrl}`;
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
          if (data.loginUrl) {
            window.location.href = data.loginUrl;
          } else {
            window.location.href = '/.auth/login/aad';
          }
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
      docsRoot.innerHTML = '<div class="text-center py-12"><p class="text-muted">No documents uploaded yet.</p></div>';
      CURRENT_DOCS = [];
      return;
    }
    
    CURRENT_DOCS = data.documents;
    renderDocuments(folder);
  } catch (error) {
    console.error('Failed to load documents:', error);
    docsRoot.innerHTML = `<div class="text-center py-12"><p class="text-muted text-destructive">Failed to load documents: ${error.message}</p></div>`;
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
  
  // Render each document version as a separate row
  for (const doc of items) {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const sizeKB = Math.round(doc.file_size / 1024);
    
    // Check if this is the latest version for this filename
    const allVersionsOfFile = CURRENT_DOCS.filter(d => d.file_name === doc.file_name);
    const maxVersion = Math.max(...allVersionsOfFile.map(d => d.version));
    const isLatest = doc.version === maxVersion;
    const versionBadge = isLatest ? 
      `<span class="badge" style="background: var(--success); color: white;">v${doc.version} (latest)</span>` :
      `<span class="badge">v${doc.version}</span>`;
    
    left.innerHTML = `<strong>${doc.file_name}</strong> ${versionBadge} <span class="text-muted">(${sizeKB}KB)</span>`;

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
