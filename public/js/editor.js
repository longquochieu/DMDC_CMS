// public/js/editor.js
(function () {
  function getCsrf() {
    const m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : "";
  }

  /* ----------------- Quill ----------------- */
  function initQuill() {
    const holder = document.querySelector("[data-quill-editor]");
    if (!holder) return;
    if (!window.Quill) {
      console.warn("Quill not found. Make sure Quill JS is included in layout.");
      return;
    }

    const hidden = document.getElementById("content_html");
    // One toolbar only
    const toolbar = [
      [{ header: [2, 3, 4, false] }],
      ["bold", "italic", "underline", "strike"],
      [{ align: [] }],
      [{ list: "ordered" }, { list: "bullet" }],
      ["link", "blockquote", "code"],
      ["clean"],
      ["image", "video"],
    ];

    const quill = new Quill(holder, {
      theme: "snow",
      modules: { toolbar },
      placeholder: "Nhập nội dung bài viết...",
    });

    // Prefill from hidden
    if (hidden && hidden.value) {
      const tmp = document.createElement("div");
      tmp.innerHTML = hidden.value;
      quill.root.innerHTML = tmp.innerHTML;
    } else {
      // giúp con trỏ hiển thị đúng khi trống
      quill.setContents([{ insert: "\n" }]);
    }

    const form = holder.closest("form");
    if (form) {
      form.addEventListener("submit", function () {
        if (hidden) hidden.value = quill.root.innerHTML;
      });
    }
  }

  /* -------- Status & schedule block -------- */
  function initStatusSchedule() {
    const sel = document.getElementById("status");
    const block = document.getElementById("schedule-block");
    if (!sel || !block) return;

    function render() {
      const v = sel.value;
      block.style.display = v === "scheduled" ? "" : "none";
    }
    sel.addEventListener("change", render);
    render();
  }

  /* ---------------- Categories ------------- */
  function initCategories() {
    const wrap = document.querySelector(".card-body");
    if (!wrap) return;

    const list = wrap.querySelectorAll(".cat-check");
    const radios = wrap.querySelectorAll(".cat-radio");

    function checkedBoxes() {
      return Array.from(list).filter((x) => x.checked);
    }

    function enableRadioFor(checkbox, enable) {
      const row = checkbox.closest("label");
      if (!row) return;
      const radio = row.querySelector(".cat-radio");
      if (!radio) return;
      radio.disabled = !enable;
      if (!enable && radio.checked) radio.checked = false;
    }

    list.forEach((chk) => {
      chk.addEventListener("change", function () {
        enableRadioFor(chk, chk.checked);

        const checked = checkedBoxes();
        if (checked.length === 1) {
          // chỉ một danh mục → đặt làm primary
          const rrow = checked[0].closest("label");
          const r = rrow && rrow.querySelector(".cat-radio");
          if (r) r.checked = true;
        } else if (chk.checked && checked.length >= 2) {
          // tick gần nhất → làm primary
          const rrow = chk.closest("label");
          const r = rrow && rrow.querySelector(".cat-radio");
          if (r) r.checked = true;
        }
      });

      // init state
      enableRadioFor(chk, chk.checked);
    });
  }

  /* ---------------- Featured upload -------- */
  function bindFeaturedUpload() {
    const btnUp = document.getElementById("btnFeaturedUpload");
    const btnPick = document.getElementById("btnFeaturedPick");
    const preview = document.getElementById("featured-preview");
    const input = document.getElementById("featured_url");
    const csrf = getCsrf();

    if (btnUp) {
      btnUp.addEventListener("click", () => {
        const f = document.createElement("input");
        f.type = "file";
        f.accept = "image/*";
        f.onchange = () => {
          const file = f.files && f.files[0];
          if (!file) return;
          const fd = new FormData();
          fd.append("file", file);
          fetch("/admin/media/upload", {
            method: "POST",
            body: fd,
            headers: { "CSRF-Token": csrf },
          })
            .then((r) => r.json())
            .then((j) => {
              const url = j.url || j.location || "";
              if (!url) return;
              input.value = url;
              preview.innerHTML = `<img src="${url}" style="max-width:100%;max-height:160px;object-fit:cover">`;
            })
            .catch((e) => alert("Upload lỗi: " + e.message));
        };
        f.click();
      });
    }

    if (btnPick) {
      btnPick.addEventListener("click", () => {
        // Placeholder: mở thư viện media
        fetch("/admin/media/list", { headers: { Accept: "application/json" } })
          .then((r) => r.json())
          .then((j) => {
            const list = j.items || [];
            const choice = window.prompt(
              "Nhập số thứ tự ảnh (0..n) để chọn:\n" +
                list.map((m, i) => `${i}: ${m.original_filename}`).join("\n")
            );
            const i = Number(choice);
            if (!isFinite(i) || i < 0 || i >= list.length) return;
            const url = list[i].url;
            input.value = url;
            preview.innerHTML = `<img src="${url}" style="max-width:100%;max-height:160px;object-fit:cover">`;
          })
          .catch((e) => alert("Không mở được thư viện: " + e.message));
      });
    }
  }

  /* ---------------- Gallery upload ---------- */
  function bindGalleryUpload() {
    const btnUp = document.getElementById("btnGalleryUpload");
    const btnPick = document.getElementById("btnGalleryPick");
    const wrap = document.getElementById("gallery-preview");
    const csrf = getCsrf();
    if (!wrap) return;

    function addThumb(url) {
      const box = document.createElement("div");
      box.className = "position-relative";
      box.innerHTML = `
        <img src="${url}" style="height:70px" class="border">
        <input type="hidden" name="gallery_urls[]" value="${url}">
        <button type="button" class="btn btn-sm btn-danger position-absolute top-0 end-0 gallery-remove" aria-label="Remove" style="line-height:1;padding:.1rem .25rem;">×</button>
      `;
      wrap.appendChild(box);
      const rm = box.querySelector(".gallery-remove");
      rm.addEventListener("click", () => box.remove());
    }

    if (btnUp) {
      btnUp.addEventListener("click", () => {
        const f = document.createElement("input");
        f.type = "file";
        f.accept = "image/*";
        f.multiple = true;
        f.onchange = () => {
          const files = Array.from(f.files || []);
          if (!files.length) return;
          files.forEach((file) => {
            const fd = new FormData();
            fd.append("file", file);
            fetch("/admin/media/upload", {
              method: "POST",
              body: fd,
              headers: { "CSRF-Token": csrf },
            })
              .then((r) => r.json())
              .then((j) => {
                const url = j.url || j.location || "";
                if (url) addThumb(url);
              })
              .catch((e) => alert("Upload lỗi: " + e.message));
          });
        };
        f.click();
      });
    }

    if (btnPick) {
      btnPick.addEventListener("click", () => {
        fetch("/admin/media/list", { headers: { Accept: "application/json" } })
          .then((r) => r.json())
          .then((j) => {
            const list = j.items || [];
            const choice = window.prompt(
              "Nhập chỉ số (0..n) ảnh muốn thêm, cách nhau dấu phẩy:\n" +
                list.map((m, i) => `${i}: ${m.original_filename}`).join("\n")
            );
            if (!choice) return;
            choice
              .split(",")
              .map((s) => Number(s.trim()))
              .filter((i) => isFinite(i) && i >= 0 && i < list.length)
              .forEach((i) => addThumb(list[i].url));
          })
          .catch((e) => alert("Không mở được thư viện: " + e.message));
      });
    }

    // Bind remove cho item render sẵn
    wrap.querySelectorAll(".gallery-remove").forEach((btn) => {
      btn.addEventListener("click", () => btn.closest(".position-relative").remove());
    });
  }

  function initTooltips() {
    if (!window.bootstrap) return;
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
      new bootstrap.Tooltip(el);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initQuill();
    initStatusSchedule();
    initCategories();
    bindFeaturedUpload();
    bindGalleryUpload();
    initTooltips();
  });
})();
