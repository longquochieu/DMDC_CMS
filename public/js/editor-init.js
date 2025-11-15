// public/js/editor-init.js
// Quill: một cấu hình chuẩn dùng chung (lấy từ Categories làm mẫu)
window.initQuill = function initQuill(selector = "#editor", opts = {}) {
  const el = document.querySelector(selector);
  if (!el) return null;

  // Tránh khởi tạo trùng
  if (el.__quill) return el.__quill;

  const modules = {
    toolbar: [
      [{ header: [false, 2, 3, 4] }],
      ["bold", "italic", "underline", "strike"],
      [{ list: "ordered" }, { list: "bullet" }],
      [{ align: [] }],
      ["blockquote", "code-block"],
      ["link", "image", "video"],
      ["clean"],
    ],
  };

  const q = new Quill(el, {
    theme: "snow",
    modules: { ...modules, ...(opts.modules || {}) },
    placeholder: opts.placeholder || "",
  });

  // Đồng bộ với <textarea name="content_html">
  const textarea = document.querySelector('[name="content_html"]');
  if (textarea) {
    q.on("text-change", () => {
      textarea.value = q.root.innerHTML;
    });
    // nếu có sẵn nội dung trong textarea -> đổ vào editor (lần đầu)
    if (textarea.value && !q.root.innerHTML.trim()) {
      q.root.innerHTML = textarea.value;
    }
  }

  el.__quill = q;
  return q;
};
