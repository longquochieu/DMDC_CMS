// public/js/slug.js
(function () {
  function toSlug(str) {
    if (!str) return "";
    const from =
      "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ"
      + "ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ"
      + "ÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ";
    const to =
      "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd"
      + "AAAAAAAAAAAAAAAAAEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYYD";
    let ret = "";
    for (let i = 0; i < str.length; i++) {
      const idx = from.indexOf(str[i]);
      ret += idx > -1 ? to[idx] : str[i];
    }
    return ret
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  window.autoBindSlug = function (titleSel, slugSel) {
    const titleEl = document.querySelector(titleSel);
    const slugEl = document.querySelector(slugSel);
    if (!titleEl || !slugEl) return;

    let userTouchedSlug = !!slugEl.value;

    slugEl.addEventListener("input", () => (userTouchedSlug = true));

    const fill = () => {
      if (userTouchedSlug) return;
      slugEl.value = toSlug(titleEl.value || "");
    };

    titleEl.addEventListener("input", fill);
    titleEl.addEventListener("blur", fill);

    // khởi tạo lần đầu
    if (!slugEl.value) fill();
  };

  window.toSlug = toSlug; // nếu view nào cần dùng
})();
