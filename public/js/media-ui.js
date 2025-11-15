(function () {
  const root = document.getElementById('media-page');
  if (!root) return;
  const CSRF = root.dataset.csrf || (window.__CSRF__ || '');

  let state = {
    folder_id: null, // null|number|'uncategorized'
    q: '', type: '', sort: 'created_at', dir: 'desc',
    page: 1, page_size: 24,
    total: 0, rows: [],
    selected: new Set()
  };

  // ---- helpers ----
  function h(tag, attrs={}, children=[]) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => {
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.entries(v).forEach(([dk,dv]) => el.dataset[dk]=dv);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    });
    return el;
  }

  async function api(url, opts={}) {
    const res = await fetch(url, {
      headers: { 'CSRF-Token': CSRF, 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...opts
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // ---- Folder tree ----
  async function loadFolders() {
    const res = await fetch('/admin/media/folders', { credentials: 'same-origin' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Lỗi load folders');

    const treeEl = document.getElementById('folder-tree');
    treeEl.innerHTML = '';

    const unc = h('li', {}, [
      h('a', { href:'#', class:'d-inline-block py-1', onclick: (e)=>{e.preventDefault(); state.folder_id = 'uncategorized'; state.page=1; refreshList(); highlightCurrent();}}, '— Chưa phân loại')
    ]);
    const all = h('li', {}, [
      h('a', { href:'#', class:'d-inline-block py-1', onclick: (e)=>{e.preventDefault(); state.folder_id = null; state.page=1; refreshList(); highlightCurrent();}}, 'Tất cả')
    ]);
    treeEl.appendChild(all);
    treeEl.appendChild(unc);

    function render(nodes, container) {
      nodes.forEach((n) => {
        const li = h('li', {dataset:{id:n.id}}, [
          h('a', { href:'#', class:'d-inline-block py-1', onclick: (e)=>{e.preventDefault(); state.folder_id = n.id; state.page=1; refreshList(); highlightCurrent();}}, n.name)
        ]);
        const ul = h('ul', { class:'list-unstyled ml-3' });
        li.appendChild(ul);
        container.appendChild(li);
        if (n.children && n.children.length) render(n.children, ul);
      });
    }
    render(data.tree || [], treeEl);
    enableDnD(treeEl);
    highlightCurrent();
  }

  function highlightCurrent() {
    const links = document.querySelectorAll('#folder-tree a');
    links.forEach(a => a.classList.remove('text-primary', 'fw-bold'));
    const sel = state.folder_id;
    if (sel == null) {
      links.forEach(a => { if (a.textContent==='Tất cả') a.classList.add('text-primary','fw-bold'); });
    } else if (sel === 'uncategorized') {
      links.forEach(a => { if (a.textContent==='— Chưa phân loại') a.classList.add('text-primary','fw-bold'); });
    } else {
      links.forEach(a => {
        const li = a.closest('li');
        if (li && Number(li.dataset.id) === Number(sel)) a.classList.add('text-primary','fw-bold');
      });
    }
  }

  // DnD with SortableJS on each level
  function enableDnD(treeEl) {
    const lists = treeEl.querySelectorAll('ul');
    lists.forEach((ul) => {
      Sortable.create(ul, {
        group: 'folders',
        animation: 150,
        fallbackOnBody: true,
        onEnd: async (evt) => {
          try {
            const item = evt.item; // <li>
            const id = Number(item.dataset.id);
            const newParent = item.parentElement.closest('li')?.dataset?.id || '';
            const newIndex = Array.from(item.parentElement.children).indexOf(item);

            await api('/admin/media/folders/move', {
              method: 'PUT',
              body: JSON.stringify({ id, new_parent_id: newParent, new_index: newIndex })
            });
            loadFolders();
          } catch (e) { console.error(e); }
        }
      });
    });
  }

  // CRUD folder buttons
  document.getElementById('btn-new-folder').addEventListener('click', async () => {
    const name = prompt('Tên thư mục mới?');
    if (!name) return;
    await api('/admin/media/folders', { method: 'POST', body: JSON.stringify({ name, parent_id: state.folder_id && state.folder_id!== 'uncategorized' ? state.folder_id : null }) });
    loadFolders();
  });
  document.getElementById('btn-rename-folder').addEventListener('click', async () => {
    if (!state.folder_id || state.folder_id === 'uncategorized') return alert('Chọn 1 thư mục!');
    const name = prompt('Tên mới?');
    if (!name) return;
    await api(`/admin/media/folders/${state.folder_id}`, { method: 'PUT', body: JSON.stringify({ name }) });
    loadFolders();
  });
  document.getElementById('btn-del-folder').addEventListener('click', async () => {
    if (!state.folder_id || state.folder_id === 'uncategorized') return alert('Chọn 1 thư mục!');
    if (!confirm('Xoá thư mục? File KHÔNG bị xoá.')) return;
    await api(`/admin/media/folders/${state.folder_id}`, { method: 'DELETE' });
    state.folder_id = null;
    loadFolders(); refreshList();
  });

  // ---- List/grid ----
  async function refreshList() {
    const params = new URLSearchParams({
      q: state.q, type: state.type, sort: state.sort, dir: state.dir, page: state.page, page_size: state.page_size
    });
    if (state.folder_id != null) params.set('folder_id', state.folder_id);
    const data = await api('/admin/media/list?' + params.toString());
    state.rows = data.rows || [];
    state.total = data.total || 0;
    renderGrid();
  }

  function human(n) {
    if (!n && n !== 0) return '';
    const units = ['B','KB','MB','GB'];
    let idx = 0, x = n;
    while (x >= 1024 && idx < units.length-1) { x/=1024; idx++; }
    return x.toFixed(idx?1:0) + ' ' + units[idx];
  }

  function renderGrid() {
    const grid = document.getElementById('media-grid');
    grid.innerHTML = '';
    const { page, page_size, total } = state;
    const from = (page-1)*page_size + 1;
    const to = Math.min(total, page*page_size);
    document.getElementById('list-meta').textContent = total ? `${from}–${to}/${total}` : '0';

    state.selected.clear();

    state.rows.forEach((r) => {
      const isImg = (r.mime_type || '').startsWith('image/');
      const thumb = isImg ? r.url.replace('/uploads/','/uploads/_thumbs/').replace(/\.[a-z0-9]+$/i,'.jpg') : '/assets/file-icon.png';
      const card = h('div', { class:'col-md-3 col-sm-4 col-6' }, [
        h('div', { class:'card h-100' }, [
          h('div', { class:'position-relative' }, [
            h('input', { type:'checkbox', class:'form-check-input position-absolute m-2', style:'z-index:1', oninput:(e)=>{ if(e.target.checked) state.selected.add(r.id); else state.selected.delete(r.id);} }),
            h('img', { src: thumb, loading:'lazy', class:'card-img-top', alt: r.filename })
          ]),
          h('div', { class:'card-body p-2' }, [
            h('div', { class:'small text-truncate', title:r.filename }, r.filename),
            h('div', { class:'text-muted small' }, [ (r.mime_type||'') + ' • ' + human(r.size_bytes) ])
          ])
        ])
      ]);
      grid.appendChild(card);
    });

    document.getElementById('page-info').textContent = total ? `Trang ${page}` : '';
  }

  // search controls
  ['q','type','sort','dir'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { state[id] = el.value; state.page = 1; refreshList(); });
  });
  document.getElementById('prev').onclick = () => { if (state.page>1) { state.page--; refreshList(); } };
  document.getElementById('next').onclick = () => {
    if (state.page * state.page_size < state.total) { state.page++; refreshList(); }
  };

  // upload
  document.getElementById('btn-upload').addEventListener('click', async () => {
    const f = document.getElementById('file').files[0];
    if (!f) return alert('Chọn 1 file');
    const fd = new FormData(); fd.append('file', f);
    const res = await fetch('/admin/media/upload', { method:'POST', headers:{'CSRF-Token': CSRF}, body: fd });
    const data = await res.json();
    if (!data.ok) return alert(data.error || 'Upload lỗi');
    refreshList();
  });

  // bulk
  async function doBulk(action) {
    if (!state.selected.size) return alert('Chưa chọn mục nào');
    const ids = Array.from(state.selected);
    const body = { action, ids };
    if (action === 'assign' || action === 'unassign') {
      let fid = state.folder_id;
      if (!fid || fid === 'uncategorized') {
        fid = prompt('Nhập Folder ID muốn gán/bỏ?');
        if (!fid) return;
      }
      body.folder_id = fid;
      if (action === 'assign') body.exclusive = confirm('Gán độc quyền vào thư mục này (xoá khỏi các thư mục khác)?');
    }
    await api('/admin/media/bulk', { method:'POST', body: JSON.stringify(body) });
    refreshList();
  }
  document.getElementById('bulk-assign').onclick = () => doBulk('assign');
  document.getElementById('bulk-unassign').onclick = () => doBulk('unassign');
  document.getElementById('bulk-trash').onclick = () => doBulk('trash');

  // init
  loadFolders().then(refreshList).catch(console.error);
})();
