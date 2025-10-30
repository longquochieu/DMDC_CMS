// public/js/app.js — minimal bootstrap for admin UI
(function () {
  'use strict';
  // expose csrf token getter
  window.getCsrfToken = function () {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : '';
  };
  // generic fetch JSON helper honoring CSRF
  window.fetchJSON = function (url, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (!opts.headers['CSRF-Token']) opts.headers['CSRF-Token'] = window.getCsrfToken();
    return fetch(url, opts).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  };
})();