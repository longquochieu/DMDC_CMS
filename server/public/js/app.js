// public/js/app.js
(function () {
  // Đọc CSRF từ meta (xem mục 4 bên dưới)
  const meta = document.querySelector('meta[name="csrf-token"]');
  window.__CSRF__ = meta ? meta.content : '';

  // Helper: submit form via fetch (nếu cần)
  window.postForm = async function (url, formData) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'CSRF-Token': window.__CSRF__ },
      body: formData
    });
    return res;
  };
})();
