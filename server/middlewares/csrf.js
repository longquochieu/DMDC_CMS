// server/middlewares/csrf.js
import csurf from 'csurf';

// Bỏ qua GET/HEAD/OPTIONS để trang load không bị chặn
export const csrfProtection = csurf({
  cookie: false,
  ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
});
