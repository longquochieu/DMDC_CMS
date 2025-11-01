// public/js/editor.js
(function () {
  // --- Helpers ---
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function getCsrf() {
    const m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }
  function csrfHeaders() {
    const t = getCsrf();
    return {
      'CSRF-Token': t,         // đang dùng header này trong server
      'x-csrf-token': t,       // thêm cho chắc
      'x-xsrf-token': t
    };
  }
  async function uploadFileToMedia(file) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/admin/media/upload', {
      method: 'POST',
      headers: csrfHeaders(),
      body: fd
    });
    if (!r.ok) {
      const txt = await r.text().catch(()=>'');
      throw new Error('Upload lỗi: ' + r.status + ' ' + txt);
    }
    return r.json(); // {url, id, original_filename, ...}
  }
  async function pickFromLibrary() {
    const r = await fetch('/admin/media/list', { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('Không tải được thư viện media');
    const data = await r.json();
    // Tạm dùng prompt để chọn (0..n) — đúng với hiện trạng hệ thống
    const msg = 'Nhập số thứ tự ảnh (0..' + (data.items.length - 1) + ')';
    const choice = window.prompt(msg, '');
    if (choice === null || choice === '') return null;
    const i = parseInt(choice, 10);
    if (isNaN(i) || i < 0 || i >= data.items.length) { alert('Lựa chọn không hợp lệ'); return null; }
    const alt = window.prompt('Alt text cho ảnh:', '') || '';
    return { url: data.items[i].url, alt };
  }
  function ensureImgAltLater(container, url, alt) {
    if (!alt) return;
    setTimeout(() => {
      qsa('img', container).forEach(img => {
        if (img.src && img.src.indexOf(url) !== -1) img.setAttribute('alt', alt);
      });
    }, 0);
  }

  // --- Quill Editor ---
  function initQuillIfExists() {
    if (!window.Quill) { /* Quill chưa tải */ return; }
    const el = qs('[data-quill-editor]');
    if (!el) return;

    // Hidden textarea để submit
    const hidden = qs('textarea[name="content_html"]', el.parentElement) || qs('textarea[name="content_html"]');

    const toolbar = [
      [{ header: [2, 3, 4, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ align: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link', 'blockquote', 'code-block'],
      [{ 'color': [] }, { 'background': [] }],
      ['clean'],
      ['image', 'video']
    ];

    const quill = new Quill(el, {
      theme: 'snow',
      modules: {
        toolbar: {
          container: toolbar,
          handlers: {
            // Ghi đè nút image: upload hoặc chọn từ thư viện → chèn URL (không dùng base64)
            image: async function () {
              try {
                const action = window.prompt('Nhập "1" để tải ảnh từ máy, "2" để chọn từ thư viện:', '1');
                if (action === null) return;

                let url = '', alt = '';
                if (action === '2') {
                  const picked = await pickFromLibrary();
                  if (!picked) return;
                  url = picked.url; alt = picked.alt || '';
                } else {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = async () => {
                    if (!input.files || !input.files[0]) return;
                    try {
                      const info = await uploadFileToMedia(input.files[0]); // {url}
                      url = info.url;
                      const sel = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
                      quill.insertEmbed(sel.index, 'image', url, Quill.sources.USER);
                      quill.setSelection(sel.index + 1);
                      ensureImgAltLater(el, url, alt);
                    } catch (e) { alert(e.message); }
                  };
                  input.click();
                  return; // dừng ở đây, onChange sẽ xử lý
                }

                // chèn URL (case chọn từ thư viện)
                const sel = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
                quill.insertEmbed(sel.index, 'image', url, Quill.sources.USER);
                quill.setSelection(sel.index + 1);
                ensureImgAltLater(el, url, alt);
              } catch (e) {
                alert('Không thể chèn ảnh: ' + e.message);
              }
            }
          }
        }
      }
    });

    // Nạp dữ liệu ban đầu từ textarea (nếu có)
    if (hidden && hidden.value) {
      const div = document.createElement('div');
      div.innerHTML = hidden.value;
      quill.root.innerHTML = div.innerHTML;
    }

    // Khi nội dung thay đổi → sync ngay vào textarea
    quill.on('text-change', function () {
      if (hidden) hidden.value = quill.root.innerHTML;
    });

    // Focus hợp lý khi vùng trống
    if (!quill.getText().trim()) {
      setTimeout(() => { quill.focus(); quill.setSelection(0, 0); }, 0);
    }

    // Đảm bảo submit lúc cuối vẫn sync
    const form = el.closest('form');
    if (form) {
      form.addEventListener('submit', function () {
        if (hidden) hidden.value = quill.root.innerHTML;
      });
    }
  }

  // --- Featured image (ảnh đại diện) ---
  function initFeaturedPicker() {
    const btnUpload = qs('[data-featured-upload]');
    const btnChoose = qs('[data-featured-choose]');
    const preview = qs('[data-featured-preview]');
    const input = qs('input[name="featured_url"]');

    if (!preview || !input) return;

    function renderFeatured(url) {
      preview.innerHTML = '';
      if (!url) {
        const p = document.createElement('div');
        p.className = 'text-muted small';
        p.textContent = 'Chưa chọn ảnh';
        preview.appendChild(p);
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'position-relative d-inline-block';
      const img = document.createElement('img');
      img.src = url;
      img.className = 'img-thumbnail';
      img.style.maxWidth = '120px';
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'btn btn-sm btn-danger position-absolute top-0 end-0';
      x.setAttribute('data-remove', 'featured');
      x.innerHTML = '&times;';
      wrap.appendChild(img); wrap.appendChild(x);
      preview.appendChild(wrap);
    }

    // Khởi tạo theo giá trị hiện có
    renderFeatured(input.value || '');

    // Upload từ PC
    if (btnUpload) {
      btnUpload.addEventListener('click', async function () {
        const ip = document.createElement('input');
        ip.type = 'file';
        ip.accept = 'image/*';
        ip.onchange = async () => {
          if (!ip.files || !ip.files[0]) return;
          try {
            const info = await uploadFileToMedia(ip.files[0]);
            input.value = info.url;
            renderFeatured(info.url);
          } catch (e) { alert(e.message); }
        };
        ip.click();
      });
    }

    // Chọn từ thư viện
    if (btnChoose) {
      btnChoose.addEventListener('click', async function () {
        try {
          const picked = await pickFromLibrary();
          if (!picked) return;
          input.value = picked.url;
          renderFeatured(picked.url);
        } catch (e) { alert(e.message); }
      });
    }

    // Xóa
    preview.addEventListener('click', function (ev) {
      const t = ev.target.closest('[data-remove="featured"]');
      if (!t) return;
      input.value = '';
      renderFeatured('');
    });
  }

  // --- Gallery ---
  function initGalleryPicker() {
    const btnUpload = qs('[data-gallery-upload]');
    const btnChoose = qs('[data-gallery-choose]');
    const list = qs('[data-gallery-list]');
    if (!list) return;

    function addGalleryItem(url) {
      // tránh trùng URL
      if (qsa('[data-item]', list).some(x => x.getAttribute('data-url') === url)) return;

      const wrap = document.createElement('div');
      wrap.className = 'position-relative d-inline-block';
      wrap.setAttribute('data-item', '');
      wrap.setAttribute('data-url', url);

      const img = document.createElement('img');
      img.src = url;
      img.className = 'img-thumbnail';
      img.style.height = '70px';

      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'btn btn-sm btn-danger position-absolute top-0 end-0';
      x.setAttribute('data-remove', 'gallery');
      x.innerHTML = '&times;';

      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'gallery_urls[]';
      hidden.value = url;

      wrap.appendChild(img);
      wrap.appendChild(x);
      wrap.appendChild(hidden);
      list.appendChild(wrap);
    }

    // Upload nhiều ảnh từ PC
    if (btnUpload) {
      btnUpload.addEventListener('click', function () {
        const ip = document.createElement('input');
        ip.type = 'file';
        ip.accept = 'image/*';
        ip.multiple = true;
        ip.onchange = async () => {
          if (!ip.files || !ip.files.length) return;
          for (const f of ip.files) {
            try {
              const info = await uploadFileToMedia(f);
              addGalleryItem(info.url);
            } catch (e) { alert(e.message); }
          }
        };
        ip.click();
      });
    }

    // Chọn nhiều ảnh từ thư viện (nhập nhiều chỉ số cách nhau bằng dấu phẩy)
    if (btnChoose) {
      btnChoose.addEventListener('click', async function () {
        try {
          const r = await fetch('/admin/media/list', { headers: { 'Accept': 'application/json' } });
          if (!r.ok) throw new Error('Không tải được thư viện media');
          const data = await r.json();
          const lines = data.items.map((m, i) => `${i}: ${m.original_filename} (${m.mime_type})`).join('\n');
          const msg = 'Nhập các số thứ tự ảnh, cách nhau bằng dấu phẩy.\n' + lines;
          const input = window.prompt(msg, '');
          if (input === null || input.trim() === '') return;
          input.split(',').map(s => parseInt(s.trim(), 10))
            .filter(n => !isNaN(n) && n >= 0 && n < data.items.length)
            .forEach(i => addGalleryItem(data.items[i].url));
        } catch (e) { alert(e.message); }
      });
    }

    // Xóa 1 ảnh
    list.addEventListener('click', function (ev) {
      const t = ev.target.closest('[data-remove="gallery"]');
      if (!t) return;
      const wrap = t.closest('[data-item]');
      if (wrap) wrap.remove();
    });
  }

  // --- Boot ---
  document.addEventListener('DOMContentLoaded', function () {
    initQuillIfExists();
    initFeaturedPicker();
    initGalleryPicker();
  });
})();
