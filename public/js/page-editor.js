// public/js/page-editor.js
(function(){
  function getCsrf(){
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }

  // ===== Slugify =====
  function setUpSlug(){
    var title = document.getElementById('title');
    var slug  = document.getElementById('slug');
    var btn   = document.getElementById('btn-genslug');
    if (!title || !slug) return;

    function toSlug(str){
      if (window.slugify) return window.slugify(str);
      // fallback đơn giản
      return (str||'')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9]+/g,'-')
        .replace(/^-+|-+$/g,'')
        .substring(0,120);
    }

    title.addEventListener('input', function(){
      if (!slug.value || slug.value.trim()==='') {
        slug.value = toSlug(title.value);
      }
    });
    if (btn) btn.addEventListener('click', function(){
      slug.value = toSlug(title.value);
    });
  }

  // ===== Quill (chặn khởi tạo 2 lần) =====
  function setUpQuill(){
    var el = document.querySelector('[data-quill-editor]');
    if (!el) return;

    // ⛔ Guard: nếu đã init rồi thì thôi
    // - Quill khi init sẽ gắn class 'ql-container' lên element,
    //   và chèn một toolbar (div.ql-toolbar) ngay trước nó.
    if (
      el.classList.contains('ql-container') ||
      el.getAttribute('data-quill-initialized') === '1' ||
      (el.previousElementSibling && el.previousElementSibling.classList.contains('ql-toolbar'))
    ){
      return;
    }

    var hidden = document.getElementById('content_html');
    var toolbar = [
      [{ 'header': [2,3,4,false] }],
      ['bold','italic','underline','strike'],
      [{ 'align': [] }],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      ['link','blockquote','code'],
      ['clean'],
      ['image','video']
    ];

    var quill = new Quill(el, { theme:'snow', modules: { toolbar: toolbar } });
    // Đánh dấu đã init, để lần sau không init nữa
    el.setAttribute('data-quill-initialized', '1');

    if (hidden && hidden.value) {
      var div=document.createElement('div');
      div.innerHTML = hidden.value;
      quill.root.innerHTML = div.innerHTML;
    }

    var form = document.getElementById('page-form');
    if (form) {
      form.addEventListener('submit', function(){
        if (hidden) hidden.value = quill.root.innerHTML;
      });
    }

    // nút chèn ảnh vào nội dung
    var btn = document.querySelector('[data-insert-media]');
    if (btn) {
      btn.addEventListener('click', function(){
        openMediaPicker(function(item){
          var range = quill.getSelection(true);
          quill.insertEmbed(range.index, 'image', item.url, Quill.sources.USER);
        });
      });
    }
  }

  // ===== Media Picker (list & upload) =====
  function openMediaPicker(cb){
    fetch('/admin/media/list', { headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(json => {
        var list = json.items || [];
        var promptMsg = 'Nhập số thứ tự ảnh (0..n) hoặc để trống để Tải lên mới.\n' +
          list.map((m,i)=> (i+': '+m.original_filename+' ('+m.mime_type+')')).join('\n');
        var choice = window.prompt(promptMsg);
        if (choice === null) return;
        if (choice === '') {
          uploadMedia(function(item){ cb(item); });
        } else {
          var i = parseInt(choice,10);
          if (isNaN(i) || i<0 || i>=list.length) return alert('Lựa chọn không hợp lệ');
          cb(list[i]);
        }
      })
      .catch(e => alert('Không tải được danh sách media: '+e.message));
  }

  function uploadMedia(cb){
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = function(){
      var f = fileInput.files[0];
      if (!f) return;
      var fd = new FormData();
      fd.append('file', f);
      fetch('/admin/media/upload', {
        method: 'POST',
        headers: { 'CSRF-Token': getCsrf() },
        body: fd
      })
      .then(r => r.json())
      .then(info => {
        // server trả { id, url, ... }
        cb(info);
      })
      .catch(e => alert('Upload lỗi: '+e.message));
    };
    fileInput.click();
  }

  // ===== Ảnh đại diện cho Page =====
  function setUpFeatured(){
    var btnPick = document.getElementById('btn-pick-featured');
    var btnUp   = document.getElementById('btn-upload-featured');
    var hid     = document.getElementById('featured_media_id');
    var pre     = document.getElementById('featured-preview');

    function setPreview(item){
      if (!pre) return;
      pre.innerHTML = '';
      if (item && item.url) {
        var img = document.createElement('img');
        img.src = item.url;
        img.className = 'img-fluid border';
        pre.appendChild(img);
      }
    }

    if (btnPick) btnPick.addEventListener('click', function(){
      openMediaPicker(function(item){
        if (hid) hid.value = item.id || '';
        setPreview(item);
      });
    });

    if (btnUp) btnUp.addEventListener('click', function(){
      uploadMedia(function(item){
        if (hid) hid.value = item.id || '';
        setPreview(item);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    setUpSlug();
    setUpQuill();
    setUpFeatured();
  });
})();
