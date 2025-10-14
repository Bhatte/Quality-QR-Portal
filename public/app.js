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

let FOLDER_TREE = [];
let CURRENT_FOLDER_PATH = '';
let CURRENT_DOCS = [];
let CURRENT_FOLDER_DETAIL = null;
let COLLAPSED_FOLDERS = new Set();
let folderSearchTerm = '';

// Removed complex race condition protection for simplicity

const folderTreeEl = document.getElementById('folderTree');
const folderTreeContainer = document.getElementById('folderTreeContainer');
const folderTreeEmpty = document.getElementById('folderTreeEmpty');
const folderSelectEl = document.getElementById('folderSelect');
const folderParentSelect = document.getElementById('folderParent');
const folderSearchInput = document.getElementById('folderSearch');
const folderCountLabel = document.getElementById('folderCountLabel');
const collapseAllBtn = document.getElementById('collapseAllFolders');
const expandAllBtn = document.getElementById('expandAllFolders');
const folderNameInput = document.getElementById('folderName');
const createFolderBtn = document.getElementById('createFolderBtn');
const createFolderForm = document.getElementById('createFolderForm');
const docsRoot = document.getElementById('docs');
const docsSearch = document.getElementById('docsSearch');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('file');
const fileNameEl = document.getElementById('fileName');
const portalUrlEl = document.getElementById('portalUrl');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const dropZone = document.getElementById('dropZone');
const currentFolderLabel = document.getElementById('currentFolderLabel');
const currentFolderDocCount = document.getElementById('currentFolderDocCount');
const folderQrSection = document.getElementById('folderQrSection');
const folderQrStatus = document.getElementById('folderQrStatus');
const folderQrPreview = document.getElementById('folderQrPreview');
const generateFolderQrBtn = document.getElementById('generateFolderQr');
const downloadFolderQrBtn = document.getElementById('downloadFolderQr');
const removeFolderQrBtn = document.getElementById('removeFolderQr');

const safeEncodePath = function (segments) {
  return (segments || []).map(function (segment) { return encodeURIComponent(segment); }).join('/');
};

const toSegments = function (path) {
  return String(path || '').split('/').filter(Boolean);
};

function flattenTree(tree, depth, acc) {
  depth = depth || 0;
  acc = acc || [];
  tree.forEach(function (folder) {
    acc.push({
      path: folder.path,
      displayName: folder.displayName,
      depth: depth,
      pathSegments: folder.pathSegments || toSegments(folder.path),
      documentCount: folder.documentCount || 0,
      hasQr: folder.hasQr || false,
      children: folder.children || []
    });
    if (folder.children && folder.children.length) {
      flattenTree(folder.children, depth + 1, acc);
    }
  });
  return acc;
}

function filterFolderTree(tree, term) {
  const value = (term || '').trim().toLowerCase();
  if (!value) return tree;
  const walk = function (node) {
    const children = (node.children || []).map(walk).filter(Boolean);
    const label = String(node.displayName || node.path || '').toLowerCase();
    if (label.includes(value) || children.length) {
      return Object.assign({}, node, { children });
    }
    return null;
  };
  return tree.map(walk).filter(Boolean);
}

function collectExpandablePaths(tree, acc) {
  acc = acc || [];
  tree.forEach(function (node) {
    if (node.children && node.children.length) {
      acc.push(node.path);
      collectExpandablePaths(node.children, acc);
    }
  });
  return acc;
}

function pruneCollapsedFolders() {
  const validPaths = new Set(flattenTree(FOLDER_TREE).map(function (item) { return item.path; }));
  Array.from(COLLAPSED_FOLDERS).forEach(function (path) {
    if (!validPaths.has(path)) {
      COLLAPSED_FOLDERS.delete(path);
    }
  });
}

function findFolder(tree, path) {
  for (let i = 0; i < tree.length; i += 1) {
    const folder = tree[i];
    if (folder.path === path) return folder;
    if (folder.children && folder.children.length) {
      const found = findFolder(folder.children, path);
      if (found) return found;
    }
  }
  return null;
}

function renderFolderTree() {
  if (!folderTreeEl) return;

  const totalList = flattenTree(FOLDER_TREE);
  const totalCount = totalList.length;
  const filteredTree = filterFolderTree(FOLDER_TREE, folderSearchTerm);
  const visibleList = flattenTree(filteredTree);
  const isEmpty = filteredTree.length === 0;

  folderTreeEl.innerHTML = '';

  if (folderTreeContainer) {
    folderTreeContainer.classList.toggle('folder-tree-container--empty', isEmpty);
  }
  if (folderTreeEmpty) {
    if (isEmpty) {
      folderTreeEmpty.textContent = folderSearchTerm
        ? 'No folders match "' + folderSearchTerm + '".'
        : 'No folders yet. Create your first folder above.';
      folderTreeEmpty.style.display = 'block';
    } else {
      folderTreeEmpty.style.display = 'none';
    }
  }

  if (!isEmpty) {
    filteredTree.forEach(function (folder) {
      folderTreeEl.appendChild(createFolderNode(folder, 0));
    });
  }

  if (folderCountLabel) {
    if (folderSearchTerm) {
      folderCountLabel.textContent = visibleList.length + ' matching of ' + totalCount;
    } else {
      folderCountLabel.textContent = totalCount + ' folder' + (totalCount === 1 ? '' : 's');
    }
  }

  highlightSelectedFolder();
}

function createFolderNode(folder, depth) {
  const li = document.createElement('li');
  li.className = 'folder-tree-item';
  li.dataset.path = folder.path;
  li.setAttribute('role', 'treeitem');
  li.setAttribute('aria-level', depth + 1);

  const hasChildren = Array.isArray(folder.children) && folder.children.length > 0;
  const isCollapsed = !folderSearchTerm && COLLAPSED_FOLDERS.has(folder.path);

  if (hasChildren) {
    li.setAttribute('aria-expanded', String(!isCollapsed));
  }

  const row = document.createElement('div');
  row.className = 'folder-row';
  row.style.paddingLeft = String(depth * 16) + 'px';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'folder-toggle';
  if (!hasChildren) {
    toggle.classList.add('folder-toggle--spacer');
    toggle.disabled = true;
  } else {
    toggle.innerHTML = '<span aria-hidden="true">' + (isCollapsed ? '▸' : '▾') + '</span>';
    toggle.setAttribute('aria-label', (isCollapsed ? 'Expand' : 'Collapse') + ' folder ' + (folder.displayName || folder.path));
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      if (isCollapsed) {
        COLLAPSED_FOLDERS.delete(folder.path);
      } else {
        COLLAPSED_FOLDERS.add(folder.path);
      }
      renderFolderTree();
    });
  }
  row.appendChild(toggle);

  const label = folder.displayName || (folder.pathSegments && folder.pathSegments.length ? folder.pathSegments[folder.pathSegments.length - 1] : folder.path);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'folder-tree-btn';
  
  // Add folder icon and text
  const folderIcon = hasChildren ? 
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="folder-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2l5 2h9a2 2 0 0 1 2 2z"></path></svg>' :
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="folder-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2l5 2h9a2 2 0 0 1 2 2z"></path></svg>';
  
  button.innerHTML = `<span class="folder-content">${folderIcon}<span class="folder-name">${label}</span></span>`;
  button.addEventListener('click', function () {
    selectFolder(folder.path);
  });
  row.appendChild(button);

  const meta = document.createElement('span');
  meta.className = 'folder-meta';
  meta.textContent = String(folder.documentCount || 0);
  row.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'folder-actions';

  const renameBtn = document.createElement('button');
  renameBtn.className = 'icon-btn icon-btn--edit';
  renameBtn.title = 'Rename folder';
  renameBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    </svg>
  `;
  renameBtn.addEventListener('click', function (event) {
    event.stopPropagation();
    const input = document.createElement('input');
    input.className = 'admin-input folder-rename-input';
    input.value = label;
    input.setAttribute('aria-label', 'Rename folder');
    row.replaceChild(input, button);
    input.focus();
    input.select();

    const commit = async function () {
      const value = input.value.trim();
      if (!value || value === label) {
        row.replaceChild(button, input);
        return;
      }
      try {
        await apiCall('/admin/folder', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: folder.path, displayName: value })
        });
        toast('Folder renamed');
        await refreshFolders(folder.path);
      } catch (error) {
        console.error('Rename failed:', error);
        toast('Rename failed: ' + error.message, 'error');
        row.replaceChild(button, input);
      }
    };

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit();
      }
      if (ev.key === 'Escape') {
        row.replaceChild(button, input);
      }
    });
    input.addEventListener('blur', commit);
  });
  actions.appendChild(renameBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn icon-btn--delete';
  deleteBtn.title = 'Delete folder';
  deleteBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3,6 5,6 21,6"></polyline>
      <path d="M19,6v14a2,2 0,0,1-2,2H7a2,2 0,0,1-2-2V6m3,0V4a2,2 0,0,1,2-2h4a2,2 0,0,1,2,2v2"></path>
      <line x1="10" y1="11" x2="10" y2="17"></line>
      <line x1="14" y1="11" x2="14" y2="17"></line>
    </svg>
  `;
  deleteBtn.addEventListener('click', async function (event) {
    event.stopPropagation();
    const count = folder.documentCount || 0;
    const confirmMessage = count
      ? 'Delete folder "' + (folder.displayName || folder.path) + '" and ' + count + ' document' + (count === 1 ? '' : 's') + '?'
      : 'Delete folder "' + (folder.displayName || folder.path) + '"?';
    if (!window.confirm(confirmMessage)) return;
    try {
      await apiCall('/admin/folder', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folder.path })
      });
      toast('Folder deleted');
      COLLAPSED_FOLDERS.delete(folder.path);
      const parentPath = folder.pathSegments.slice(0, -1).join('/');
      await refreshFolders(parentPath);
    } catch (error) {
      console.error('Delete failed:', error);
      toast('Failed to delete folder: ' + error.message, 'error');
    }
  });
  actions.appendChild(deleteBtn);

  row.appendChild(actions);
  li.appendChild(row);

  if (hasChildren && !isCollapsed) {
    const childList = document.createElement('ul');
    childList.className = 'folder-tree';
    folder.children.forEach(function (child) {
      childList.appendChild(createFolderNode(child, depth + 1));
    });
    li.appendChild(childList);
  }

  return li;
}

function highlightSelectedFolder() {
  if (!folderTreeEl) return;
  const nodes = folderTreeEl.querySelectorAll('.folder-tree-item');
  let scrolled = false;
  nodes.forEach(function (node) {
    if (node.dataset.path === CURRENT_FOLDER_PATH) {
      node.classList.add('active');
      node.setAttribute('aria-selected', 'true');
      if (!folderSearchTerm && folderTreeContainer && !scrolled) {
        node.scrollIntoView({ block: 'nearest' });
        scrolled = true;
      }
    } else {
      node.classList.remove('active');
      node.removeAttribute('aria-selected');
    }
  });
}

async function refreshFolders(selectPath) {
  console.log('[FOLDERS] Refreshing folders...');
  
  // Show loading indicator
  if (folderTreeContainer) {
    folderTreeContainer.classList.add('loading');
  }
  
  try {
    const data = await apiCall('/admin/folders/tree');
    FOLDER_TREE = data.tree || [];
    console.log('[FOLDERS] Successfully loaded', FOLDER_TREE.length, 'folders');
  } catch (error) {
    console.error('Failed to load folders:', error);
    toast('Failed to load folders: ' + error.message, 'error');
    // Don't clear existing folders on error - preserve what we have
    // FOLDER_TREE = []; // REMOVED - this was causing folders to disappear
  } finally {
    // Always remove loading indicator
    if (folderTreeContainer) {
      folderTreeContainer.classList.remove('loading');
    }
  }

  pruneCollapsedFolders();
  renderFolderTree();
  populateFolderSelect();
  populateFolderParentSelect();

  const flattened = flattenTree(FOLDER_TREE);
  const fallback = flattened.length ? flattened[0].path : '';
  const target = selectPath || CURRENT_FOLDER_PATH || fallback;

  if (target) {
    selectFolder(target, { reload: true });
  } else {
    selectFolder('', { reload: false });
  }
}

function selectFolder(path, options) {
  options = options || {};
  CURRENT_FOLDER_PATH = path || '';
  if (folderSelectEl) {
    const matchOption = Array.from(folderSelectEl.options).some(function (option) { return option.value === CURRENT_FOLDER_PATH; });
    folderSelectEl.value = matchOption ? CURRENT_FOLDER_PATH : '';
  }
  syncCreateFolderParent();
  highlightSelectedFolder();
  updateUploadState();

  if (!path) {
    CURRENT_DOCS = [];
    CURRENT_FOLDER_DETAIL = null;
    renderFolderSummary(null);
    renderFolderQrState(null);
    renderDocumentList();
    return;
  }

  if (options.reload !== false) {
    loadFolderDetail(path);
  }
}


async function loadFolderDetail(path) {
  try {
    const detail = await apiCall('/admin/folders/detail?path=' + encodeURIComponent(path));
    CURRENT_FOLDER_DETAIL = detail;
    CURRENT_DOCS = detail.allDocuments || [];
    renderFolderSummary(detail);
    renderFolderQrState(detail);
    renderDocumentList();
  } catch (error) {
    console.error('Failed to load folder detail:', error);
    toast('Failed to load folder: ' + error.message, 'error');
  }
}

function renderFolderSummary(detail) {
  if (currentFolderLabel) {
    currentFolderLabel.textContent = detail && detail.folder ? detail.folder.path : 'Select a folder to begin';
  }
  if (currentFolderDocCount) {
    const count = detail && detail.latestDocuments ? detail.latestDocuments.length : 0;
    currentFolderDocCount.textContent = count + ' document' + (count === 1 ? '' : 's');
  }
}

function renderFolderQrState(detail) {
  if (!folderQrSection) return;
  if (!detail || !detail.folder) {
    folderQrSection.style.display = 'none';
    return;
  }

  folderQrSection.style.display = 'block';
  const qr = detail.qr;
  const downloadUrl = detail.qrDownloadUrl;

  if (qr) {
    folderQrStatus.textContent = 'Latest QR version v' + qr.version;
    if (downloadFolderQrBtn) {
      downloadFolderQrBtn.style.display = 'inline-flex';
      downloadFolderQrBtn.href = downloadUrl;
      downloadFolderQrBtn.target = '_blank';
      downloadFolderQrBtn.download = 'folder-' + qr.version + '.png';
    }
    if (folderQrPreview) {
      const cacheBust = downloadUrl.indexOf('?') >= 0 ? '&' : '?';
      folderQrPreview.innerHTML = '<img src="' + downloadUrl + cacheBust + 'v=' + Date.now() + '" alt="Folder QR preview" class="folder-qr-image">';
    }
    if (removeFolderQrBtn) {
      removeFolderQrBtn.style.display = 'inline-flex';
    }
  } else {
    folderQrStatus.textContent = 'No QR generated yet.';
    if (downloadFolderQrBtn) {
      downloadFolderQrBtn.style.display = 'none';
      downloadFolderQrBtn.removeAttribute('href');
    }
    if (folderQrPreview) {
      folderQrPreview.innerHTML = '<p class="text-muted text-sm">Generate a QR to preview and download.</p>';
    }
    if (removeFolderQrBtn) {
      removeFolderQrBtn.style.display = 'none';
    }
  }

  if (generateFolderQrBtn) {
    generateFolderQrBtn.disabled = !CURRENT_FOLDER_PATH;
  }
}

function renderDocumentList() {
  if (!docsRoot) return;
  docsRoot.innerHTML = '';

  if (!CURRENT_FOLDER_PATH) {
    docsRoot.innerHTML = '<div class="text-center py-12"><p class="text-muted">Select a folder to view documents.</p></div>';
    return;
  }

  const searchTerm = (docsSearch && docsSearch.value ? docsSearch.value : '').toLowerCase().trim();
  let items = CURRENT_DOCS.slice();
  if (searchTerm) {
    items = items.filter(function (doc) {
      return (doc.file_name || '').toLowerCase().includes(searchTerm);
    });
  }

  items.sort(function (a, b) {
    if (a.file_name !== b.file_name) {
      return a.file_name.localeCompare(b.file_name);
    }
    return b.version - a.version;
  });

  if (!items.length) {
    docsRoot.textContent = 'No matching documents.';
    return;
  }

  const encodedPath = safeEncodePath(CURRENT_FOLDER_DETAIL && CURRENT_FOLDER_DETAIL.folder ? CURRENT_FOLDER_DETAIL.folder.pathSegments : toSegments(CURRENT_FOLDER_PATH));
  const latestByFile = new Map();
  CURRENT_DOCS.forEach(function (doc) {
    const existing = latestByFile.get(doc.file_name);
    if (!existing || doc.version > existing.version) {
      latestByFile.set(doc.file_name, doc);
    }
  });

  const qrByBase = new Map();
  CURRENT_DOCS.filter(function (doc) {
    return /-qr\.png$/i.test(doc.file_name || '');
  }).forEach(function (doc) {
    const base = doc.file_name.replace(/-qr\.png$/i, '');
    const existing = qrByBase.get(base);
    if (!existing || doc.version > existing.version) {
      qrByBase.set(base, doc);
    }
  });

  const ul = document.createElement('ul');

  items.forEach(function (doc) {
    const isQr = /-qr\.png$/i.test(doc.file_name || '');
    const baseName = doc.file_name.replace(/-qr\.png$/i, '');
    const hasPdfSibling = CURRENT_DOCS.some(function (d) {
      return /\.pdf$/i.test(d.file_name || '') && d.file_name.replace(/\.[^.]+$/, '') === baseName;
    });
    if (isQr && hasPdfSibling) {
      return;
    }

    const li = document.createElement('li');
    const left = document.createElement('div');
    const right = document.createElement('div');
    right.className = 'row';

    const strong = document.createElement('strong');
    strong.textContent = doc.file_name;
    left.appendChild(strong);

    const latest = latestByFile.get(doc.file_name);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = doc.version === (latest ? latest.version : doc.version) ? 'v' + doc.version + ' (latest)' : 'v' + doc.version;
    if (doc.version === (latest ? latest.version : doc.version)) {
      badge.style.background = 'var(--success)';
      badge.style.color = '#fff';
    }
    left.appendChild(document.createTextNode(' '));
    left.appendChild(badge);

    const sizeEl = document.createElement('span');
    sizeEl.className = 'text-muted';
    sizeEl.textContent = ' (' + Math.round(doc.file_size / 1024) + 'KB)';
    left.appendChild(document.createTextNode(' '));
    left.appendChild(sizeEl);

    const open = document.createElement('a');
    open.href = '/docs/' + encodedPath + '/' + encodeURIComponent(doc.file_name);
    open.target = '_blank';
    open.className = 'link';
    open.textContent = 'Open';
    right.appendChild(open);

    const copy = document.createElement('button');
    copy.className = 'btn btn--outline btn--sm';
    copy.title = 'Copy Portal URL';
    copy.textContent = 'Copy';
    copy.addEventListener('click', async function () {
      const absolute = new URL(open.href, window.location.origin).toString();
      try {
        await navigator.clipboard.writeText(absolute);
        toast('Portal URL copied');
      } catch (error) {
        toast('Clipboard unavailable', 'error');
      }
    });
    right.appendChild(copy);

    const isPdf = (doc.mime_type || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(doc.file_name || '');
    if (isPdf) {
      const qrDoc = qrByBase.get(doc.file_name.replace(/\.[^.]+$/, '')) || null;
      if (qrDoc) {
        const openQr = document.createElement('a');
        openQr.href = '/docs/' + encodedPath + '/' + encodeURIComponent(qrDoc.file_name);
        openQr.target = '_blank';
        openQr.className = 'link';
        openQr.textContent = 'Open QR';
        right.appendChild(openQr);

        const downloadQr = document.createElement('a');
        downloadQr.href = openQr.href;
        downloadQr.download = qrDoc.file_name;
        downloadQr.className = 'btn btn--outline btn--sm';
        downloadQr.textContent = 'Download';
        right.appendChild(downloadQr);

        const previewWrap = document.createElement('div');
        previewWrap.className = 'qr-preview';
        const qrImg = document.createElement('img');
        qrImg.src = openQr.href;
        qrImg.alt = 'QR preview for ' + doc.file_name;
        qrImg.width = 96;
        qrImg.loading = 'lazy';
        previewWrap.appendChild(qrImg);
        left.appendChild(previewWrap);
      }

      const generate = document.createElement('button');
      generate.className = 'btn btn--primary btn--sm';
      generate.textContent = qrDoc ? 'Regenerate QR' : 'Generate QR';
      generate.addEventListener('click', async function () {
        try {
          generate.disabled = true;
          generate.textContent = 'Generating...';
          await apiCall('/admin/qr/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: CURRENT_FOLDER_PATH, fileName: doc.file_name })
          });
          toast('QR generated');
          await loadFolderDetail(CURRENT_FOLDER_PATH);
        } catch (error) {
          console.error('QR generation failed:', error);
          toast('QR generation failed: ' + error.message, 'error');
        } finally {
          generate.disabled = false;
          generate.textContent = qrDoc ? 'Regenerate QR' : 'Generate QR';
        }
      });
      right.appendChild(generate);
    }

    const del = document.createElement('button');
    del.className = 'btn btn--outline btn--sm';
    del.textContent = 'Delete';
    del.addEventListener('click', async function () {
      if (!window.confirm('Delete version v' + doc.version + ' of ' + doc.file_name + '?')) return;
      try {
        del.disabled = true;
        del.textContent = 'Deleting...';
        await apiCall('/admin/document/' + encodeURIComponent(doc.id), { method: 'DELETE' });
        toast('Version deleted');
        await loadFolderDetail(CURRENT_FOLDER_PATH);
      } catch (error) {
        console.error('Delete failed:', error);
        toast('Delete failed: ' + error.message, 'error');
      }
    });
    right.appendChild(del);

    li.appendChild(left);
    li.appendChild(right);
    ul.appendChild(li);
  });

  docsRoot.appendChild(ul);
}

function populateFolderSelect() {
  if (!folderSelectEl) return;
  const flattened = flattenTree(FOLDER_TREE);
  const previous = folderSelectEl.value;
  folderSelectEl.innerHTML = '<option value="">-- select folder --</option>';
  flattened.forEach(function (item) {
    const option = document.createElement('option');
    const prefix = item.depth ? Array(item.depth + 1).join('— ') : '';
    option.value = item.path;
    option.textContent = (prefix ? prefix + ' ' : '') + (item.displayName || item.path);
    folderSelectEl.appendChild(option);
  });
  const desired = CURRENT_FOLDER_PATH || previous;
  if (desired) {
    const match = Array.from(folderSelectEl.options).some(function (option) { return option.value === desired; });
    if (match) {
      folderSelectEl.value = desired;
    }
  }
}

function populateFolderParentSelect() {
  if (!folderParentSelect) return;
  const flattened = flattenTree(FOLDER_TREE);
  const previous = folderParentSelect.value;
  folderParentSelect.innerHTML = '<option value="">Root (top level)</option>';
  flattened.forEach(function (item) {
    const option = document.createElement('option');
    const prefix = item.depth ? Array(item.depth + 1).join('\u2014 ') : '';
    option.value = item.path;
    option.textContent = (prefix ? prefix + ' ' : '') + (item.displayName || item.path);
    folderParentSelect.appendChild(option);
  });
  const desired = CURRENT_FOLDER_PATH || previous;
  if (desired) {
    const matchOption = Array.from(folderParentSelect.options).some(function (option) { return option.value === desired; });
    if (matchOption) {
      folderParentSelect.value = desired;
      return;
    }
  }
  folderParentSelect.value = '';
}


function syncCreateFolderParent() {
  if (!folderParentSelect) return;
  const target = CURRENT_FOLDER_PATH || '';
  const match = Array.from(folderParentSelect.options).some(function (option) { return option.value === target; });
  folderParentSelect.value = match ? target : '';
}




async function handleCreateFolder() {
  const label = folderNameInput ? folderNameInput.value.trim() : '';
  if (!label) {
    toast('Enter folder name', 'error');
    if (folderNameInput) folderNameInput.focus();
    return;
  }

  const parentValue = folderParentSelect ? String(folderParentSelect.value || '').trim() : '';
  const labelSpan = createFolderBtn ? createFolderBtn.querySelector('span') : null;

  if (createFolderBtn) {
    createFolderBtn.disabled = true;
    if (labelSpan) labelSpan.textContent = 'Creating...';
  }

  try {
    const result = await apiCall('/admin/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: label,
        parentPath: parentValue || null
      })
    });

    if (folderNameInput) {
      folderNameInput.value = '';
      folderNameInput.focus();
    }

    toast('Folder created');

    if (parentValue) {
      COLLAPSED_FOLDERS.delete(parentValue);
    }

    const targetPath = result.folder && result.folder.path ? result.folder.path : (parentValue || CURRENT_FOLDER_PATH);
    await refreshFolders(targetPath);

    if (folderParentSelect) {
      const desired = parentValue || '';
      const matchOption = Array.from(folderParentSelect.options).some(function (option) { return option.value === desired; });
      folderParentSelect.value = matchOption ? desired : '';
    }
  } catch (error) {
    console.error('Folder creation failed:', error);
    toast('Failed to create folder: ' + error.message, 'error');
  } finally {
    if (createFolderBtn) {
      createFolderBtn.disabled = false;
      if (labelSpan) labelSpan.textContent = 'Create Folder';
    }
  }
}


if (createFolderForm) {
  createFolderForm.addEventListener('submit', function (event) {
    event.preventDefault();
    handleCreateFolder();
  });
}

if (folderSearchInput) {
  folderSearchInput.addEventListener('input', function (event) {
    folderSearchTerm = (event.target.value || '').trim();
    renderFolderTree();
  });
}

if (collapseAllBtn) {
  collapseAllBtn.addEventListener('click', function () {
    COLLAPSED_FOLDERS = new Set(collectExpandablePaths(FOLDER_TREE));
    renderFolderTree();
  });
}

if (expandAllBtn) {
  expandAllBtn.addEventListener('click', function () {
    COLLAPSED_FOLDERS.clear();
    renderFolderTree();
  });
}

if (folderSelectEl) {
  folderSelectEl.addEventListener('change', function (event) {
    const value = event.target.value.trim();
    if (value) {
      selectFolder(value, { reload: true });
    }
    updateUploadState();
  });
}

if (docsSearch && !docsSearch._bound) {
  docsSearch.addEventListener('input', function () {
    renderDocumentList();
  });
  docsSearch._bound = true;
}

if (uploadBtn) {
  uploadBtn.addEventListener('click', async function () {
    const folderPath = CURRENT_FOLDER_PATH || (folderSelectEl && folderSelectEl.value ? folderSelectEl.value.trim() : '');
    if (!folderPath) {
      toast('Select a folder first', 'error');
      return;
    }
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;
    if (!file) {
      toast('Choose a PDF file', 'error');
      return;
    }

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    if (statusEl) {
      statusEl.style.color = '';
      statusEl.textContent = 'Uploading...';
    }
    if (progressEl) progressEl.style.display = 'block';

    try {
      const form = new FormData();
      form.append('path', folderPath);
      form.append('file', file);
      const data = await apiCall('/admin/upload', {
        method: 'POST',
        body: form
      }, 5);

      if (statusEl) {
        statusEl.style.color = 'var(--success)';
        statusEl.textContent = 'Upload successful - ' + data.document.fileName + ' (' + Math.round(data.document.fileSize / 1024) + 'KB)';
      }
      if (portalUrlEl) {
        portalUrlEl.textContent = data.portalUrl || '-';
      }
      if (copyUrlBtn) {
        copyUrlBtn.disabled = !data.portalUrl;
      }
      if (fileInput) {
        fileInput.value = '';
      }
      if (fileNameEl) {
        fileNameEl.textContent = 'No file selected';
      }
      toast('Upload successful');
      await loadFolderDetail(folderPath);
    } catch (error) {
      console.error('Upload failed:', error);
      if (statusEl) {
        statusEl.style.color = 'var(--destructive)';
        if (error.message.includes('pdf_only')) {
          statusEl.textContent = 'Only PDF files are supported.';
        } else if (error.message.includes('file_too_large')) {
          statusEl.textContent = 'File too large (max 50MB).';
        } else {
          statusEl.textContent = 'Upload failed: ' + error.message;
        }
      }
      toast('Upload failed: ' + error.message, 'error');
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7,10 12,15 17,10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>Upload';
      if (progressEl) progressEl.style.display = 'none';
      updateUploadState();
    }
  });
}

if (fileInput) {
  fileInput.addEventListener('change', function () {
    const file = fileInput.files ? fileInput.files[0] : null;
    fileNameEl.textContent = file ? file.name : 'No file selected';
    updateUploadState();
  });
}

if (copyUrlBtn && portalUrlEl) {
  copyUrlBtn.addEventListener('click', async function () {
    const url = portalUrlEl.textContent.trim();
    if (!url || url === '-') return;
    const absolute = url.indexOf('http') === 0 ? url : window.location.origin + url;
    try {
      await navigator.clipboard.writeText(absolute);
      toast('Copied');
    } catch (error) {
      console.error('Clipboard failed', error);
      toast('Clipboard unavailable', 'error');
    }
  });
}

if (dropZone) {
  ['dragenter', 'dragover'].forEach(function (evt) {
    dropZone.addEventListener(evt, function (event) {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropZone.addEventListener(evt, function (event) {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove('drag');
    });
  });
  dropZone.addEventListener('click', function () {
    if (fileInput) fileInput.click();
  });
  dropZone.addEventListener('drop', async function (event) {
    const folderPath = CURRENT_FOLDER_PATH || (folderSelectEl && folderSelectEl.value ? folderSelectEl.value.trim() : '');
    const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
    if (!folderPath || !file) {
      toast('Select folder first, then drop a PDF', 'error');
      return;
    }
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      toast('Only PDF files are supported', 'error');
      return;
    }

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    if (statusEl) {
      statusEl.style.color = '';
      statusEl.textContent = 'Uploading via drag & drop...';
    }
    if (progressEl) progressEl.style.display = 'block';

    try {
      const form = new FormData();
      form.append('path', folderPath);
      form.append('file', file);
      const data = await apiCall('/admin/upload', { method: 'POST', body: form }, 5);
      if (statusEl) {
        statusEl.style.color = 'var(--success)';
        statusEl.textContent = 'Upload successful - ' + data.document.fileName + ' (' + Math.round(data.document.fileSize / 1024) + 'KB)';
      }
      if (portalUrlEl) portalUrlEl.textContent = data.portalUrl || '-';
      if (copyUrlBtn) copyUrlBtn.disabled = !data.portalUrl;
      toast('Upload successful');
      await loadFolderDetail(folderPath);
    } catch (error) {
      console.error('Drag & drop upload failed:', error);
      if (statusEl) {
        statusEl.style.color = 'var(--destructive)';
        statusEl.textContent = 'Upload failed: ' + error.message;
      }
      toast('Upload failed: ' + error.message, 'error');
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7,10 12,15 17,10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>Upload';
      if (progressEl) progressEl.style.display = 'none';
      updateUploadState();
    }
  });
}

if (generateFolderQrBtn) {
  generateFolderQrBtn.addEventListener('click', async function () {
    if (!CURRENT_FOLDER_PATH) return;
    try {
      generateFolderQrBtn.disabled = true;
      generateFolderQrBtn.textContent = 'Generating...';
      await apiCall('/admin/qr/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: CURRENT_FOLDER_PATH })
      });
      toast('Folder QR generated');
      await loadFolderDetail(CURRENT_FOLDER_PATH);
    } catch (error) {
      console.error('Folder QR error', error);
      toast('QR generation failed: ' + error.message, 'error');
    } finally {
      generateFolderQrBtn.disabled = false;
      generateFolderQrBtn.textContent = 'Generate Folder QR';
    }
  });
}

if (removeFolderQrBtn) {
  removeFolderQrBtn.addEventListener('click', async function () {
    if (!CURRENT_FOLDER_PATH) return;
    if (!window.confirm('Remove the stored QR code for this folder?')) return;
    try {
      removeFolderQrBtn.disabled = true;
      await apiCall('/admin/qr/folder', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: CURRENT_FOLDER_PATH })
      });
      toast('Folder QR removed');
      await loadFolderDetail(CURRENT_FOLDER_PATH);
    } catch (error) {
      console.error('Folder QR delete error', error);
      toast('Failed to remove QR: ' + error.message, 'error');
    } finally {
      removeFolderQrBtn.disabled = false;
    }
  });
}

// Update upload button state based on current selections
function updateUploadState() {
  if (!uploadBtn || !folderSelectEl || !fileInput) return;
  
  const hasFolder = CURRENT_FOLDER_PATH || (folderSelectEl.value && folderSelectEl.value.trim());
  const hasFile = fileInput.files && fileInput.files.length > 0;
  
  uploadBtn.disabled = !hasFolder || !hasFile;
}

updateUploadState();
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


