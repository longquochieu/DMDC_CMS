// server/middlewares/csrf.js
import csurf from 'csurf';

// Dùng session-based CSRF (đã có express-session)
export const csrfProtection = csurf({
  cookie: false,
  ignoreMethods: ['GET','HEAD','OPTIONS'],
});


// Đưa token vào view + để AJAX lấy qua <meta>
export function attachCsrfToken(req, res, next) {
  if (typeof req.csrfToken === 'function') {
    try { res.locals.csrfToken = req.csrfToken(); }
    catch { res.locals.csrfToken = ''; }
  } else {
    res.locals.csrfToken = '';
  }
  next();
}
