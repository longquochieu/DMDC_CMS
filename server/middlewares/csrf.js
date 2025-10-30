// server/middlewares/csrf.js
import csurf from 'csurf';

// Dùng session-based CSRF (đã có express-session)
export const csrfProtection = csurf({
  cookie: false,                       // dùng session, không chơi cookie
  ignoreMethods: ['GET','HEAD','OPTIONS'],
});

// Middleware đẩy token cho view & AJAX
export function attachCsrfToken(req, res, next) {
  if (typeof req.csrfToken === 'function') {
    try { res.locals.csrfToken = req.csrfToken(); }
    catch { res.locals.csrfToken = ''; }
  } else {
    res.locals.csrfToken = '';
  }
  next();
}
