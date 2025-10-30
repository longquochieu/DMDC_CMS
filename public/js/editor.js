// public/js/editor.js
(function(){
  function getCsrf(){
    var m=document.querySelector('meta[name="csrf-token"]');
    return m?m.content:'';
  }

  // ⛔ Guard: đã init thì KHÔNG init lại
  function alreadyInitialized(el){
    return !!el &&
      (el.classList.contains('ql-container') ||
       el.getAttribute('data-quill-initialized') === '1' ||
       (el.previousElementSibling &&
        el.previousElementSibling.classList.contains('ql-toolbar')));
  }

  function initQuillIfExists(){
    var el = document.querySelector('[data-quill-editor]');
    if(!el || alreadyInitialized(el)) return;

    var hidden = document.querySelector('textarea[name="content_html"]');
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
    el.setAttribute('data-quill-initialized','1');

    // nạp sẵn nội dung nếu có
    if (hidden && hidden.value){
      var div=document.createElement('div');
      div.innerHTML=hidden.value;
      quill.root.innerHTML=div.innerHTML;
    }

    // đồng bộ về hidden trước khi submit
    var form = el.closest('form');
    if (form){
      form.addEventListener('submit', function(){
        if(hidden){ hidden.value = quill.root.innerHTML; }
      });
    }

    // nút chèn ảnh vào nội dung (nếu có)
    var btn = document.querySelector('[data-insert-media]');
    if(btn){
      btn.addEventListener('click', function(){
        openMediaPicker(function(url, alt){
          var range = quill.getSelection(true);
          quill.insertEmbed(range.index, 'image', url, Quill.sources.USER);
          if (alt) setTimeout(function(){
            var imgs=el.querySelectorAll('img[src="'+CSS.escape(url)+'"]');
            imgs.forEach(function(img){ img.setAttribute('alt', alt); });
          }, 0);
        });
      });
    }
  }

  function openMediaPicker(cb){
    fetch('/admin/media/list', { headers: { 'Accept': 'application/json' } })
      .then(r=>r.json())
      .then(json=>{
        var choice = window.prompt(
          'Nhập số thứ tự ảnh (0..n) hoặc trống để Tải lên mới.\n' +
          (json.items||[]).map((m,i)=> i+': '+m.original_filename+' ('+m.mime_type+')').join('\n')
        );
        if (choice===null) return;

        if (choice==='') {
          var fileInput=document.createElement('input'); fileInput.type='file'; fileInput.accept='image/*';
          fileInput.onchange=function(){
            var f=fileInput.files[0]; if(!f) return;
            var fd=new FormData(); fd.append('file', f);
            fetch('/admin/media/upload', { method:'POST', body: fd, headers:{ 'CSRF-Token': getCsrf() } })
              .then(r=>r.json())
              .then(info=>{
                var alt=window.prompt('Alt text cho ảnh:','');
                cb(info.url, alt||'');
              })
              .catch(e=>alert('Upload lỗi: '+e.message));
          };
          fileInput.click();
        } else {
          var list = json.items||[];
          var i=parseInt(choice,10);
          if(isNaN(i)||i<0||i>=list.length) return alert('Lựa chọn không hợp lệ');
          var alt = window.prompt('Alt text cho ảnh:','');
          cb(list[i].url, alt||'');
        }
      })
      .catch(e=>alert('Không tải được danh sách media: '+e.message));
  }

  document.addEventListener('DOMContentLoaded', function(){
    initQuillIfExists();
  });
})();
