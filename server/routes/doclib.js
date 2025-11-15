// server/routes/doclib.js
import express from "express";
import { listMediaByFolder } from "../services/media_folders.js";

const router = express.Router();

/**
 * Render thư viện tài liệu để nhúng:
 * /doclib/render?folder=ID|null|uncategorized&view=grid|list&per=12&sort=title&order=asc&q=
 * layout=false để trả về HTML thuần cho embed
 */
router.get("/doclib/render", async (req, res) => {
  try {
    const folder_id = req.query.folder ?? null;
    const view = req.query.view === "list" ? "list" : "grid";
    const per = Number(req.query.per || 12);
    const page = Number(req.query.page || 1);
    const sort = req.query.sort || "filename";
    const dir = req.query.order || "asc";
    const q = req.query.q || "";
    const mime = req.query.mime || "";

    const data = await listMediaByFolder({
      folder_id,
      q,
      mime,
      sort,
      dir,
      page,
      page_size: per,
    });

    res.render(`doclib/${view}`, { layout: false, ...data });
  } catch (e) {
    console.error("doclib/render error:", e);
    res
      .status(400)
      .send(`<div class="text-danger">Lỗi: ${e.message || String(e)}</div>`);
  }
});

export default router;
