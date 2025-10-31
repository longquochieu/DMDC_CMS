(function(){
  function whenQuillReady(cb){
    if (window.Quill) return cb();
    var max = 50, count = 0;
    var t = setInterval(function(){
      if (window.Quill){ clearInterval(t); cb(); }
      if (++count > max){ clearInterval(t); console.warn('Quill not loaded'); }
    }, 100);
  }

  function initQuill(){
    var wrap = document.querySelector('[data-quill-editor]');
    if (!wrap) return;
    var hidden = document.querySelector('textarea[name="content_html"]');
    // Toolbar chuẩn: đã có ảnh/video sẵn, bỏ nút chèn ngoài
    var toolbar = [
      [{ header: [2,3,4,false] }],
      ['bold','italic','underline','strike'],
      [{ align: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link','blockquote','code'],
      ['clean'],
      ['image','video']
    ];
    var quill = new Quill(wrap, { theme:'snow', modules: { toolbar } });

    // Set nội dung ban đầu từ hidden
    if (hidden && hidden.value){
      var div = document.createElement('div');
      div.innerHTML = hidden.value;
      quill.root.innerHTML = div.innerHTML;
    }

    // Đảm bảo click vùng trống vẫn focus được
    wrap.addEventListener('click', function(){
      var range = quill.getSelection();
      if (!range) quill.setSelection(quill.getLength(), 0);
    });

    // Sync về hidden trước khi submit
    var form = wrap.closest('form');
    if (form){
      form.addEventListener('submit', function(){
        if (hidden) hidden.value = quill.root.innerHTML;
      });
    }

    // Expose nhỏ nếu cần dùng ở nơi khác
    window.__quill = quill;
  }

  document.addEventListener('DOMContentLoaded', function(){
    whenQuillReady(initQuill);
  });
})();
