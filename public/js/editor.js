// public/js/editor.js
(function(){
  function getCsrf(){
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  }

  // ---- Quill ----
  function initQuillOnce(){
    var el = document.querySelector('[data-quill-editor="post"]');
    if(!el || window.__quillInited) return;
    window.__quillInited = true;

    var hidden = document.getElementById('content_html');
    var toolbar = [
      [{ header: [2,3,4,false] }],
      ['bold','italic','underline','strike'],
      [{ align: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link','blockquote','code'],
      ['clean'],
      ['image','video']
    ];
    var quill = new Quill(el, { theme:'snow', modules: { toolbar: toolbar } });

    // load value
    if (hidden && hidden.value) {
      var div = document.createElement('div');
      div.innerHTML = hidden.value;
      quill.root.innerHTML = div.innerHTML;
    }

    // on submit -> sync
    var form = el.closest('form');
    if (form) {
      form.addEventListener('submit', function(){
        if (hidden) hidden.value = quill.root.innerHTML;
      });
    }
  }

  // ---- Media helpers ----
  function pickFromLibrary(multiple, cb){
    fetch('/admin/media/list', { headers: { 'Accept':'application/json' } })
      .then(r => r.json())
      .then(json => {
        // Tối giản: prompt theo index
        var msg = 'Nhập số thứ tự ảnh (0..n) hoặc trống để huỷ:\n' +
          json.items.map((m,i)=> i+': '+m.original_filename+' ('+m.mime_type+')').join('\n');
        if (!multiple) {
          var s = window.prompt(msg);
          if (s===null || s==='') return;
          var i = parseInt(s,10);
          if (isNaN(i) || i<0 || i>=json.items.length) return alert('Lựa chọn không hợp lệ');
          cb([json.items[i]]);
        } else {
          var s = window.prompt(msg + '\nBạn có thể nhập nhiều số, cách nhau bởi dấu phẩy.');
          if (s===null || s==='') return;
          var picks = s.split(',').map(x=>parseInt(x.trim(),10)).filter(x=>!isNaN(x));
          var arr = picks.map(i=>json.items[i]).filter(Boolean);
          if (!arr.length) return alert('Lựa chọn không hợp lệ');
          cb(arr);
        }
      })
      .catch(e => alert('Không tải được thư viện: ' + e.message));
  }

  function uploadFromPC(multiple, cb){
    var input = document.createElement('input');
    input.type='file';
    input.accept='image/*';
    if (multiple) input.multiple = true;
    input.onchange = function(){
      if (!input.files || !input.files.length) return;
      var files = Array.from(input.files);
      var done = [];
      (function loop(i){
        if (i>=files.length) return cb(done);
        var fd = new FormData();
        fd.append('file', files[i]);
        fetch('/admin/media/upload', {
          method:'POST',
          body: fd,
          headers: { 'CSRF-Token': getCsrf() }
        }).then(r=>r.json())
          .then(info => { done.push(info); loop(i+1); })
          .catch(e => { alert('Upload lỗi: ' + e.message); loop(i+1); });
      })(0);
    };
    input.click();
  }

  // ---- Featured buttons ----
  function initFeatured(){
    var hidden = document.getElementById('featured_media_id');
    var preview = document.getElementById('featured_preview');
    var btnPick = document.getElementById('btn-pick-featured');
    var btnUpload = document.getElementById('btn-upload-featured');

    if (btnPick) btnPick.addEventListener('click', function(){
      pickFromLibrary(false, function(arr){
        var it = arr[0];
        hidden.value = it.id;
        if (preview){ preview.src = it.url; preview.classList.remove('d-none'); }
      });
    });

    if (btnUpload) btnUpload.addEventListener('click', function(){
      uploadFromPC(false, function(arr){
        var it = arr[0];
        hidden.value = it.id;
        if (preview){ preview.src = it.url; preview.classList.remove('d-none'); }
      });
    });
  }

  // ---- Gallery buttons ----
  function initGallery(){
    var hidden = document.getElementById('gallery_media_ids');
    var preview = document.getElementById('gallery-preview');
    var btnPick = document.getElementById('btn-pick-gallery');
    var btnUpload = document.getElementById('btn-upload-gallery');

    function pushItems(items){
      var ids = (hidden.value ? hidden.value.split(',').filter(Boolean).map(s=>parseInt(s,10)) : []);
      items.forEach(it => {
        if (!ids.includes(it.id)) ids.push(it.id);
        // preview
        var img = document.createElement('img');
        img.src = it.url;
        img.dataset.id = it.id;
        img.className = 'border';
        img.style.height = '70px';
        img.style.objectFit = 'cover';
        preview.appendChild(img);
      });
      hidden.value = ids.join(',');
    }

    if (btnPick) btnPick.addEventListener('click', function(){
      pickFromLibrary(true, pushItems);
    });

    if (btnUpload) btnUpload.addEventListener('click', function(){
      uploadFromPC(true, pushItems);
    });
  }

  // ---- Bootstrap tooltips ----
  function initTooltips(){
    if (!window.bootstrap) return;
    var t = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    t.forEach(el => new bootstrap.Tooltip(el));
  }

  document.addEventListener('DOMContentLoaded', function(){
    initQuillOnce();
    initFeatured();
    initGallery();
    initTooltips();
  });
})();
