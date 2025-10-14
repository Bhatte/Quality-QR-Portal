(function(){
  const page = document.body.dataset.page;

  const toast = (msg) => {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 2200);
  };

  const encodeSegments = (segments = []) => segments.map((segment) => encodeURIComponent(segment)).join('/');

  const query = new URLSearchParams(location.search);

  if (page === 'folders') {
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    const search = document.getElementById('search');

    const render = (folders) => {
      grid.innerHTML = '';
      if (!folders.length) { empty.style.display = 'block'; return; }
      empty.style.display = 'none';
      for (const f of folders) {
        const card = document.createElement('a');
        card.className = 'card card--link';
        card.href = `/folder.html?path=${encodeURIComponent(f.path || f.name)}`;

        const title = document.createElement('div');
        title.className = 'card__title';
        title.textContent = f.displayName || f.name;

        const meta = document.createElement('div');
        meta.className = 'card__meta';
        meta.textContent = f.path || f.name;

        card.appendChild(title);
        card.appendChild(meta);
        grid.appendChild(card);
      }
    };

    const load = async () => {
      try {
        const res = await fetch('/folders');
        const data = await res.json();
        if (!data.ok) throw new Error('load_error');
        let folders = data.folders || [];
        const applyFilter = () => {
          const q = (search.value || '').toLowerCase().trim();
          const filtered = q ? folders.filter(x => (x.displayName || x.name).toLowerCase().includes(q) || (x.path || x.name).toLowerCase().includes(q)) : folders;
          render(filtered);
        };
        search.addEventListener('input', applyFilter);
        applyFilter();
      } catch(e) {
        grid.innerHTML = '';
        empty.textContent = 'Failed to load folders. Try again.';
        empty.style.display = 'block';
      }
    };
    load();
  }

  if (page === 'folder') {
    const list = document.getElementById('list');
    const empty = document.getElementById('empty');
    const search = document.getElementById('search');
    const subtitle = document.getElementById('subtitle');
    const badge = document.getElementById('badge');
    const subfoldersSection = document.getElementById('subfolders-section');
    const subfoldersGrid = document.getElementById('subfolders');
    const breadcrumbsEl = document.getElementById('breadcrumbs');

    const folderPath = query.get('path') || query.get('name') || '';
    if (!folderPath) { location.href = '/'; return; }

    let docs = [];
    let encodedPath = '';

    const render = (docsToRender) => {
      list.innerHTML = '';
      if (!docsToRender.length) { empty.style.display = 'block'; return; }
      empty.style.display = 'none';
      for (const d of docsToRender) {
        const li = document.createElement('li');
        const left = document.createElement('div');
        const right = document.createElement('div');

        const a = document.createElement('a');
        a.className = 'link';
        a.target = '_blank';
        a.href = `/docs/${encodedPath}/${encodeURIComponent(d.file_name)}`;
        a.textContent = d.file_name;
        left.appendChild(a);

        const badgeEl = document.createElement('span');
        badgeEl.className = 'badge';
        badgeEl.textContent = `v${d.version}`;
        right.appendChild(badgeEl);

        li.appendChild(left); li.appendChild(right);
        list.appendChild(li);
      }
    };

    const renderSubfolders = (children) => {
      if (!subfoldersSection || !subfoldersGrid) return;
      if (!children.length) {
        subfoldersSection.style.display = 'none';
        subfoldersGrid.innerHTML = '';
        return;
      }
      subfoldersSection.style.display = 'block';
      subfoldersGrid.innerHTML = '';
      children.forEach((child) => {
        const card = document.createElement('a');
        card.className = 'card card--link';
        card.href = `/folder.html?path=${encodeURIComponent(child.path || child.name)}`;

        const title = document.createElement('div');
        title.className = 'card__title';
        title.textContent = child.displayName || child.name;

        const meta = document.createElement('div');
        meta.className = 'card__meta';
        meta.textContent = child.path || child.name;

        card.appendChild(title);
        card.appendChild(meta);
        subfoldersGrid.appendChild(card);
      });
    };

    const renderBreadcrumbs = (breadcrumbs) => {
      if (!breadcrumbsEl) return;
      breadcrumbsEl.innerHTML = '';
      if (!breadcrumbs.length) {
        breadcrumbsEl.style.display = 'none';
        return;
      }
      breadcrumbsEl.style.display = 'flex';
      breadcrumbs.forEach((crumb, idx) => {
        const link = document.createElement('a');
        link.className = 'breadcrumb';
        link.textContent = crumb.displayName || crumb.name;
        link.href = `/folder.html?path=${encodeURIComponent(crumb.name)}`;
        breadcrumbsEl.appendChild(link);
        if (idx < breadcrumbs.length - 1) {
          const sep = document.createElement('span');
          sep.className = 'breadcrumb-separator';
          sep.textContent = '›';
          breadcrumbsEl.appendChild(sep);
        }
      });
    };

    const load = async () => {
      try {
        const res = await fetch(`/folders/detail?path=${encodeURIComponent(folderPath)}`);
        const data = await res.json();
        if (!data.ok) throw new Error('load_error');
        const folder = data.folder;
        encodedPath = encodeSegments(folder?.pathSegments || [folderPath]);
        subtitle.textContent = folder ? `Folder — ${folder.displayName || folder.path}` : 'Folder';
        badge.style.display = 'inline-block';
        badge.textContent = `${(data.documents || []).length} docs`;
        docs = data.documents || [];
        renderSubfolders(data.children || []);
        renderBreadcrumbs(data.breadcrumbs || []);
        const applyFilter = () => {
          const q = (search.value || '').toLowerCase().trim();
          const filtered = q ? docs.filter(x => (x.file_name||'').toLowerCase().includes(q)) : docs;
          render(filtered);
        };
        search.addEventListener('input', applyFilter);
        applyFilter();
      } catch(e) {
        list.innerHTML = '';
        empty.textContent = 'Failed to load documents. Try again.';
        empty.style.display = 'block';
      }
    };

    load();
  }
})();
