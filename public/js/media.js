// public/js/media-ui.js
(function () {
  const CSRF = (window.CSRF_TOKEN || document.querySelector('meta[name="csrf-token"]')?.content || '');

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-csrf-token': CSRF },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
    return res.json();
  }

  // === FOLDERS: nút "Thêm" ở cột trái ===
  const btnAddFolder = document.querySelector('.js-folder-add');
  if (btnAddFolder) {
    btnAddFolder.addEventListener('click', async () => {
      const name = (prompt('Tên thư mục?') || '').trim();
      if (!name) return;
      try {
        await postJSON('/admin/media/folders/new', { name }); // route đã có trong project
        location.reload();
      } catch (e) {
        alert('Tạo thư mục thất bại: ' + e.message);
      }
    });
  }

  // === UPLOAD: bắt form upload và đẩy bằng fetch ===
  const form = document.querySelector('#media-upload-form');
  if (form) {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      if (CSRF && !fd.has('_csrf')) fd.append('_csrf', CSRF);

      const res = await fetch('/admin/media/upload', {
        method: 'POST',
        headers: { 'x-csrf-token': CSRF },
        body: fd
      });
      let json;
      try { json = await res.json(); } catch { json = null; }
      if (!res.ok || !json || !json.ok) {
        alert('Upload lỗi: ' + (json?.error || res.statusText));
        return;
      }
      // refresh danh sách
      if (window.reloadMediaList) window.reloadMediaList();
      else location.reload();
    });
  }

  // === MEDIA PICKER dùng chung ===
  // dùng: pickMedia({ multi:true, type:'image' }).then(items => ...)
  window.pickMedia = function pickMedia(opts = {}) {
    return new Promise((resolve) => {
      // Mở modal media sẵn có, đặt chế độ chọn
      // Giả sử modal có id #media-modal, list item có data-id và data-url
      const modal = document.querySelector('#media-modal');
      if (!modal) { alert('Media modal chưa sẵn sàng'); resolve([]); return; }

      const multi = !!opts.multi;
      const type  = opts.type || ''; // 'image'|'video'|'doc'|''
      const selected = new Map();

      function applyFilter() {
        // gọi lại list API với type filter (nếu UI hỗ trợ)
        if (window.reloadMediaList) window.reloadMediaList({ type });
      }

      function bindSelection() {
        modal.querySelectorAll('.media-item').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.getAttribute('data-id');
            const url = el.getAttribute('data-url');
            if (multi) {
              if (selected.has(id)) { selected.delete(id); el.classList.remove('is-selected'); }
              else { selected.set(id, { id, url }); el.classList.add('is-selected'); }
            } else {
              selected.clear(); selected.set(id, { id, url });
              modal.querySelectorAll('.media-item.is-selected').forEach(x => x.classList.remove('is-selected'));
              el.classList.add('is-selected');
            }
          });
        });
      }

      function open() {
        applyFilter();
        bindSelection();
        modal.classList.add('open');
      }
      function close() { modal.classList.remove('open'); }

      const okBtn = modal.querySelector('.js-media-choose');
      const cancelBtn = modal.querySelector('.js-media-cancel');
      if (okBtn) okBtn.onclick = () => { close(); resolve(Array.from(selected.values())); };
      if (cancelBtn) cancelBtn.onclick = () => { close(); resolve([]); };

      open();
    });
  };

  // === Nút “Chèn ảnh vào nội dung” cho Quill ===
  const insertBtn = document.querySelector('.js-insert-image-into-editor');
  if (insertBtn) {
    insertBtn.addEventListener('click', async () => {
      const q = document.querySelector('#editor').__quill;
      if (!q) return;
      const picks = await window.pickMedia({ multi: false, type: 'image' });
      if (!picks.length) return;
      const url = picks[0].url;
      const range = q.getSelection(true) || { index: q.getLength(), length: 0 };
      q.insertEmbed(range.index, 'image', url, 'user');
      q.setSelection(range.index + 1, 0);
    });
  }

  // === Nút “Chọn ảnh đại diện” (featured) ===
  const btnFeatured = document.querySelector('.js-choose-featured');
  const featuredInput = document.querySelector('input[name="featured_url"]');
  if (btnFeatured && featuredInput) {
    btnFeatured.addEventListener('click', async () => {
      const picks = await window.pickMedia({ multi: false, type: 'image' });
      if (!picks.length) return;
      featuredInput.value = picks[0].url;
      const preview = document.querySelector('.js-featured-preview');
      if (preview) preview.src = picks[0].url;
    });
  }
})();
