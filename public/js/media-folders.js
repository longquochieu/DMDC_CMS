(function(){
  const csrf = (window.MEDIA_FOLDERS_BOOT && window.MEDIA_FOLDERS_BOOT.csrf) || '';
  const $tree = document.getElementById('folderTree');
  const $grid = document.getElementById('mediaGrid');
  const $pager = document.getElementById('mediaPager');

  let state = {
    folder_id: null, // null: tất cả; 'uncategorized': chưa phân loại; number: folder
    q: '', type: 'all', sort: 'created_at', dir: 'desc',
    page: 1, page_size: 24,
    flat: []
  };

  function h(html){ const d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild; }

  function folderNode(n){
    const el = h(`<div class="d-flex align-items-center folder-item" data-id="${n.id}">
      <i class="far fa-folder me-1"></i>
      <span class="flex-grow-1 text-truncate">${n.name}</span>
      <div class="ms-1 dropdown">
        <button class="btn btn-sm btn-light" data-bs-toggle="dropdown"><i class="fas fa-ellipsis-v"></i></button>
        <div class="dropdown-menu dropdown-menu-end">
          <a class="dropdown-item act-rename" href="#">Đổi tên</a>
          <a class="dropdown-item act-delete text-danger" href="#">Xoá</a>
        </div>
      </div>
    </div>`);
    el.addEventListener('click', (ev)=>{
      if (ev.target.closest('.dropdown')) return;
      document.querySelectorAll('#folderTree .active').forEach(x=>x.classList.remove('active'));
      el.classList.add('active');
      state.folder_id = n.id;
      state.page = 1;
      fetchList();
    });
    el.querySelector('.act-rename').addEventListener('click', async (ev)=>{
      ev.preventDefault();
      const name = prompt('Tên thư mục', n.name);
      if (!name) return;
      await fetch(`/admin/media/folders/${n.id}`, {
        method:'PUT', headers: {'Content-Type':'application/json','x-csrf-token':csrf},
        body: JSON.stringify({ name })
      });
      loadTree();
    });
    el.querySelector('.act-delete').addEventListener('click', async (ev)=>{
      ev.preventDefault();
      if (!confirm('Xoá thư mục này? (Không xoá file)')) return;
      await fetch(`/admin/media/folders/${n.id}`, {
        method:'DELETE', headers: {'x-csrf-token':csrf}
      });
      if (String(state.folder_id) === String(n.id)) { state.folder_id = null; }
      loadTree();
      fetchList();
    });
    return el;
  }

  function renderTreeNode(node){
    const wrap = h(`<div class="ms-2"></div>`);
    wrap.appendChild(folderNode(node));
    if (node.children && node.children.length) {
      const childrenWrap = h(`<div class="ms-3"></div>`);
      node.children.forEach(c => childrenWrap.appendChild(renderTreeNode(c)));
      wrap.appendChild(childrenWrap);
    }
    return wrap;
  }

  async function loadTree(){
    const res = await fetch('/admin/media/folders', { headers: { 'x-csrf-token': csrf }});
    const json = await res.json();
    if (!json.ok) return;

    state.flat = json.flat||[];
    $tree.innerHTML = '';

    // “Tất cả” & “Chưa phân loại”
    const all = h(`<div class="d-flex align-items-center folder-item ${state.folder_id===null?'active':''}">
      <i class="fas fa-folder-open me-1"></i><span class="flex-grow-1">Tất cả</span>
    </div>`);
    all.addEventListener('click', ()=>{ document.querySelectorAll('#folderTree .active').forEach(x=>x.classList.remove('active')); all.classList.add('active'); state.folder_id = null; state.page=1; fetchList(); });
    const unc = h(`<div class="d-flex align-items-center folder-item ${state.folder_id==='uncategorized'?'active':''}">
      <i class="far fa-folder me-1"></i><span class="flex-grow-1">Chưa phân loại</span>
    </div>`);
    unc.addEventListener('click', ()=>{ document.querySelectorAll('#folderTree .active').forEach(x=>x.classList.remove('active')); unc.classList.add('active'); state.folder_id = 'uncategorized'; state.page=1; fetchList(); });

    $tree.appendChild(all);
    $tree.appendChild(unc);

    (json.tree||[]).forEach(n => $tree.appendChild(renderTreeNode(n)));
  }

  async function fetchList(){
    const params = new URLSearchParams({
      folder_id: state.folder_id ?? '',
      q: state.q,
      type: state.type,
      sort: state.sort,
      dir: state.dir,
      page: state.page,
      page_size: state.page_size
    });
    const res = await fetch('/admin/media/list?' + params.toString(), { headers: { 'x-csrf-token': csrf } });
    const json = await res.json();
    if (!json.ok) return;
    renderGrid(json.rows||[]);
    renderPager(json.total||0, json.page||1, json.page_size||24);
  }

  function renderGrid(rows){
    $grid.innerHTML = '';
    if (!rows.length) {
      $grid.innerHTML = `<div class="col-12 text-center text-muted">Không có file</div>`;
      return;
    }
    rows.forEach(r => {
      const isImg = r.mime && r.mime.startsWith('image/');
      const card = h(`<div class="col-6 col-md-4 col-lg-3">
        <div class="card h-100">
          <div class="ratio ratio-4x3 bg-light d-flex align-items-center justify-content-center">
            ${isImg ? `<img src="${r.url}" alt="" class="img-fluid" style="object-fit:cover;">` : `<i class="far fa-file fa-2x text-muted"></i>`}
          </div>
          <div class="card-body p-2 small">
            <div class="text-truncate" title="${r.filename}">${r.filename}</div>
            <div class="text-muted">${r.mime||''}</div>
          </div>
        </div>
      </div>`);
      $grid.appendChild(card);
    });
  }

  function renderPager(total, page, page_size){
    if (!total) { $pager.innerHTML = ''; return; }
    const pages = Math.max(1, Math.ceil(total / page_size));
    const prevDisabled = (page<=1) ? 'disabled' : '';
    const nextDisabled = (page>=pages) ? 'disabled' : '';

    $pager.innerHTML = `
      <div>Tổng: <strong>${total}</strong> file</div>
      <div class="btn-group">
        <button class="btn btn-sm btn-outline-secondary" ${prevDisabled} id="pgPrev">&laquo;</button>
        <span class="btn btn-sm btn-light disabled">${page}/${pages}</span>
        <button class="btn btn-sm btn-outline-secondary" ${nextDisabled} id="pgNext">&raquo;</button>
      </div>
    `;
    const prev = document.getElementById('pgPrev');
    const next = document.getElementById('pgNext');
    if (prev) prev.onclick = ()=>{ if (state.page>1) { state.page--; fetchList(); } };
    if (next) next.onclick = ()=>{ const pmax=Math.ceil(total / page_size); if (state.page<pmax){ state.page++; fetchList(); } };
  }

  // Events
  document.getElementById('btnNewFolder')?.addEventListener('click', async ()=>{
    const name = prompt('Tên thư mục', 'Thư mục mới');
    if (!name) return;
    await fetch('/admin/media/folders', {
      method:'POST',
      headers: {'Content-Type':'application/json','x-csrf-token':csrf},
      body: JSON.stringify({ name })
    });
    await loadTree();
  });

  document.getElementById('btnRefresh')?.addEventListener('click', ()=>fetchList());
  document.getElementById('q')?.addEventListener('input', (e)=>{ state.q = e.target.value||''; state.page=1; fetchList(); });
  document.getElementById('type')?.addEventListener('change', (e)=>{ state.type = e.target.value||'all'; state.page=1; fetchList(); });
  document.getElementById('sort')?.addEventListener('change', (e)=>{ state.sort = e.target.value||'created_at'; state.page=1; fetchList(); });
  document.getElementById('dir')?.addEventListener('change', (e)=>{ state.dir = e.target.value||'desc'; state.page=1; fetchList(); });

  // init
  loadTree().then(fetchList);
})();
