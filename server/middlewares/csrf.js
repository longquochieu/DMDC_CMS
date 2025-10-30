// server/middlewares/csrf.js
import csurf from 'csurf';

// Bỏ qua GET/HEAD/OPTIONS để trang load không bị chặn
export const csrfProtection = (req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
};
