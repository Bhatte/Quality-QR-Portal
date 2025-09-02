(function(){
  const page = document.body.dataset.page;

  const toast = (msg) => {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 2200);
  };

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
        card.href = `/folder.html?name=${encodeURIComponent(f.name)}`;
        card.innerHTML = `<div class="card__title">${f.displayName || f.name}</div>
          <div class="card__meta">${f.name}</div>`;
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
          const filtered = q ? folders.filter(x => (x.displayName||x.name).toLowerCase().includes(q) || x.name.toLowerCase().includes(q)) : folders;
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

    const folder = query.get('name') || '';
    if (!folder) { location.href = '/'; return; }

    const render = (docs) => {
      list.innerHTML = '';
      if (!docs.length) { empty.style.display = 'block'; return; }
      empty.style.display = 'none';
      for (const d of docs) {
        const li = document.createElement('li');
        const left = document.createElement('div');
        const right = document.createElement('div');
        left.innerHTML = `<a class="link" target="_blank" href="/docs/${encodeURIComponent(folder)}/${encodeURIComponent(d.file_name)}">${d.file_name}</a>`;
        right.innerHTML = `<span class="badge">v${d.version}</span>`;
        li.appendChild(left); li.appendChild(right);
        list.appendChild(li);
      }
    };

    const load = async () => {
      try {
        const res = await fetch(`/folder/${encodeURIComponent(folder)}`);
        const data = await res.json();
        if (!data.ok) throw new Error('load_error');
        subtitle.textContent = `Folder — ${data.folder.displayName || data.folder.name}`;
        badge.style.display = 'inline-block';
        badge.textContent = `${(data.documents||[]).length} docs`;
        let docs = data.documents || [];
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
