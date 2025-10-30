// public/js/app.js
(function () {
  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  if (!token) return;

  // Tự động thêm header CSRF cho fetch() (AJAX)
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    init.headers ??= {};
    if (!('CSRF-Token' in init.headers) && !('x-csrf-token' in init.headers)) {
      init.headers['CSRF-Token'] = token;
    }
    return _fetch(input, init);
  };

  // Phòng hờ: nếu form thiếu input _csrf thì tự chèn
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f?.tagName === 'FORM' && !f.querySelector('input[name="_csrf"]')) {
      const i = document.createElement('input');
      i.type = 'hidden'; i.name = '_csrf'; i.value = token;
      f.appendChild(i);
    }
  }, true);
})();
