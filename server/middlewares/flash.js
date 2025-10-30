// server/middlewares/flash.js
export function flash() {
  return (req, res, next) => {
    if (!req.session) return next();
    if (!req.session.__flash) req.session.__flash = {};
    req.flash = (type, msg) => {
      if (!req.session.__flash[type]) req.session.__flash[type] = [];
      req.session.__flash[type].push(msg);
    };
    res.locals.flash = req.session.__flash;
    // clear ngay sau khi gắn ra locals (flash 1 lần)
    req.session.__flash = {};
    next();
  };
}
