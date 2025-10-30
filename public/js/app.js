// public/js/app.js
(function(){
  // Lấy token cho tất cả AJAX
  window.__csrf = function() {
    const m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  };

  // Tiện ích fetch có CSRF sẵn
  window.csrfFetch = function(url, opts={}) {
    const headers = new Headers(opts.headers || {});
    if (!headers.has('x-csrf-token')) headers.set('x-csrf-token', window.__csrf());
    return fetch(url, { ...opts, headers });
  };
})();
