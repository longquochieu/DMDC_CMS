// public/js/csrf.js
(function () {
  var meta = document.querySelector('meta[name="csrf-token"]');
  if (!meta) return;
  var token = meta.getAttribute('content');

  // Patch fetch để auto kèm X-CSRF-Token
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    init = init || {};
    init.headers = init.headers || {};
    if (!init.headers['X-CSRF-Token']) {
      init.headers['X-CSRF-Token'] = token;
    }
    return _fetch(input, init);
  };

  // Auto chèn _csrf vào mọi form POST nếu thiếu
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.method) return;
    if (String(form.method).toLowerCase() !== 'post') return;
    if (!form.querySelector('input[name="_csrf"]')) {
      var i = document.createElement('input');
      i.type = 'hidden';
      i.name = '_csrf';
      i.value = token;
      form.appendChild(i);
    }
  }, true);
})();
