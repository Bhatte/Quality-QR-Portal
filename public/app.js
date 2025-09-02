// Toast helper
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  (document.getElementById('toasts') || document.body).appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

let ALL_FOLDERS = [];
async function refreshFolders() {
  const res = await fetch('/folders');
  const data = await res.json().catch(() => ({}));
  ALL_FOLDERS = data.folders || [];

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
          const resp = await fetch(`/admin/folder/${encodeURIComponent(f.name)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: newName })
          });
          const out = await resp.json().catch(()=>({ ok:false }));
          if (!out.ok) { toast('Rename failed'); nameWrap.replaceChildren(nameEl); return; }
          await refreshFolders();
          toast('Folder renamed');
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
        const res = await fetch(`/admin/folder/${encodeURIComponent(f.name)}`, { method: 'DELETE' });
        const out = await res.json().catch(()=>({ ok:false }));
        if (!out.ok) { toast('Failed to delete folder'); return; }
        toast('Folder deleted');
        const select = document.getElementById('folderSelect');
        if (select && select.value === f.name) {
          select.value = '';
          document.getElementById('docs').textContent = 'Select a folder to view documents.';
        }
        refreshFolders();
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
  const name = document.getElementById('folderName').value.trim();
  if (!name) { toast('Enter folder name'); return; }
  await fetch('/admin/folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  document.getElementById('folderName').value = '';
  refreshFolders();
  toast('Folder created');
});

document.getElementById('uploadBtn').addEventListener('click', async () => {
  const category = document.getElementById('folderSelect').value.trim();
  const fileInput = document.getElementById('file');
  if (!category || !fileInput.files.length) { toast('Select folder and choose a PDF'); return; }
  const status = document.getElementById('status');
  const progress = document.getElementById('progress');
  status.style.color = '';
  status.textContent = '';
  const f = fileInput.files[0];
  const isPdf = f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!isPdf) { status.textContent = 'Only PDF files are supported.'; return; }
  const form = new FormData();
  form.append('folder', category);
  form.append('file', f);
  // show indeterminate progress
  if (progress) progress.style.display = 'block';
  const res = await fetch('/admin/upload', { method: 'POST', body: form });
  const data = await res.json().catch(()=>({}));
  if (!data.ok) {
    status.textContent = data.error === 'pdf_only' ? 'Only PDF files are supported.' : (data.error || 'Upload failed');
    if (progress) progress.style.display = 'none';
    return;
  }
  status.style.color = 'var(--success)';
  status.textContent = `Upload successful - ${data.document.fileName} (${Math.round(data.document.fileSize/1024)}KB)`;
  document.getElementById('portalUrl').textContent = data.portalUrl || '-';
  const copyBtn = document.getElementById('copyUrlBtn');
  if (copyBtn) copyBtn.disabled = !data.portalUrl;
  fileInput.value = '';
  if (category) loadDocuments(category);
  toast('Uploaded');
  if (progress) progress.style.display = 'none';
  updateUploadState();
});

refreshFolders();

let CURRENT_DOCS = [];
async function loadDocuments(folder) {
  const docsRoot = document.getElementById('docs');
  docsRoot.textContent = 'Loading...';
  // Use admin endpoint to get ALL versions of documents
  const res = await fetch(`/admin/folder/${encodeURIComponent(folder)}/documents`);
  const data = await res.json().catch(()=>({ ok:false }));
  if (!data.ok) {
    docsRoot.textContent = 'Failed to load documents.';
    return;
  }
  if (!data.documents || !data.documents.length) {
    docsRoot.textContent = 'No documents uploaded yet.';
    return;
  }
  CURRENT_DOCS = data.documents;
  renderDocuments(folder);
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
      const resp = await fetch(`/admin/document/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
      const out = await resp.json().catch(()=>({ ok:false }));
      if (!out.ok) { toast('Delete failed'); return; }
      toast(`Deleted v${doc.version}`);
      loadDocuments(folder);
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
  if (!category || !file) { toast('Set folder and drop a PDF'); return; }
  const status = document.getElementById('status');
  const progress = document.getElementById('progress');
  status.style.color = '';
  status.textContent = '';
  const isPdf = file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
  if (!isPdf) { status.textContent = 'Only PDF files are supported.'; return; }
  const form = new FormData();
  form.append('folder', category);
  form.append('file', file);
  if (progress) progress.style.display = 'block';
  const res = await fetch('/admin/upload', { method: 'POST', body: form });
  const data = await res.json().catch(()=>({}));
  if (!data.ok) {
    const errorMsg = data.error === 'pdf_only' ? 'Only PDF files are supported.' : 
                     data.error === 'file_too_large' ? 'File too large (max 50MB).' :
                     (data.error || 'Upload failed');
    status.textContent = errorMsg;
    if (progress) progress.style.display = 'none';
    return;
  }
  status.style.color = 'var(--success)';
  status.textContent = `Upload successful - ${data.document.fileName} (${Math.round(data.document.fileSize/1024)}KB)`;
  document.getElementById('portalUrl').textContent = data.portalUrl || '-';
  if (category) loadDocuments(category);
  toast('Uploaded');
  if (progress) progress.style.display = 'none';
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