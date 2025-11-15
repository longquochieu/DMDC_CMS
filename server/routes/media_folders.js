// server/routes/media_folders.js
import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import {
  listTreeWithCounts,
  createFolder,
  renameFolder,
  moveFolder,
  softDeleteFolder,
  assignItems,
  unassignItems,
} from "../services/media_folders.js";
import { queryMedia } from "../services/media_library.js";

const router = express.Router();

/** GET /admin/media/folders -> cây thư mục */
router.get("/folders", requireAuth, async (req, res) => {
  try {
    const tree = await listTreeWithCounts();
    res.json({ ok: true, tree });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

/** POST /admin/media/folders -> tạo thư mục */
router.post("/folders", requireRoles("admin", "editor"), async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (!name || !String(name).trim()) {
      return res
        .status(400)
        .json({ ok: false, error: "Tên thư mục không được để trống" });
    }
    const id = await createFolder({
      name: String(name).trim(),
      parent_id: parent_id ? Number(parent_id) : null,
      userId: req.user.id,
    });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
});

/** PUT /admin/media/folders/:id -> đổi tên */
router.put("/folders/:id", requireRoles("admin", "editor"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name } = req.body;
    await renameFolder(id, String(name || "").trim(), req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
});

/** POST /admin/media/folders/:id/move -> di chuyển */
router.post(
  "/folders/:id/move",
  requireRoles("admin", "editor"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { new_parent_id = null, new_index = 0 } = req.body;
      await moveFolder(
        id,
        new_parent_id ? Number(new_parent_id) : null,
        Number(new_index || 0),
        req.user.id
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  }
);

/** DELETE /admin/media/folders/:id -> xoá mềm */
router.delete(
  "/folders/:id",
  requireRoles("admin", "editor"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      await softDeleteFolder(id, req.user.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  }
);

/** POST /admin/media/folders/:id/items:assign */
router.post(
  "/folders/:id/items:assign",
  requireRoles("admin", "editor"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const media_ids = Array.isArray(req.body.media_ids)
        ? req.body.media_ids
        : [req.body.media_ids].filter(Boolean);
      await assignItems(id, media_ids.map(Number), req.user.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  }
);

/** POST /admin/media/folders/:id/items:unassign */
router.post(
  "/folders/:id/items:unassign",
  requireRoles("admin", "editor"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const media_ids = Array.isArray(req.body.media_ids)
        ? req.body.media_ids
        : [req.body.media_ids].filter(Boolean);
      await unassignItems(id, media_ids.map(Number), req.user.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || String(e) });
    }
  }
);

/** GET /admin/media/list -> JSON media list cho UI */
router.get("/list", requireAuth, async (req, res) => {
  try {
    const {
      folder_id = null,
      q = "",
      mime = "",
      sort = "created_at_desc",
      page = 1,
      size = 30,
    } = req.query;

    const data = await queryMedia({
      folder_id: folder_id || null,
      q,
      mime,
      sort,
      page: Number(page || 1),
      size: Number(size || 30),
    });

    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

export default router;
