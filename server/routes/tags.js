// server/routes/tags.js
import express from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
import { getDb } from "../utils/db.js";
import { getSetting } from "../services/settings.js";
import { toSlug } from "../utils/strings.js";

const router = express.Router();

/** MySQL-safe: kiểm tra cột tồn tại trong bảng */
async function hasColumn(db, tableName, columnName) {
  const row = await db.get(
    `
    SELECT 1 AS ok
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [tableName, columnName]
  );
  return !!row?.ok;
}

/** Danh sách Tag */
router.get("/", requireAuth, async (req, res) => {
  const db = await getDb();
  const lang = await getSetting("default_language", "vi");

  // Nếu bảng tags KHÔNG có deleted_at thì bỏ điều kiện lọc
  const hasDeletedAt = await hasColumn(db, "tags", "deleted_at");
  const whereClause = hasDeletedAt ? "WHERE t.deleted_at IS NULL" : "";

  const rows = await db.all(
    `
    SELECT t.id,
           tt.name,
           tt.slug
    FROM tags t
    LEFT JOIN tags_translations tt
      ON tt.tag_id = t.id AND tt.language = ?
    ${whereClause}
    ORDER BY COALESCE(tt.name, '')
    `,
    [lang]
  );

  res.render("tags/list", { pageTitle: "Tags", rows });
});

/** Tạo Tag mới */
router.post(
  "/new",
  requireRoles("admin", "editor", "author", "contributor"),
  async (req, res) => {
    const db = await getDb();
    const lang = await getSetting("default_language", "vi");
    const { name = "", slug = "" } = req.body;

    try {
      const theSlug = slug && slug.trim() ? toSlug(slug) : toSlug(name);

      // MySQL: chèn hàng mặc định (thay cho cú pháp SQLite DEFAULT VALUES)
      const ins = await db.run(`INSERT INTO tags () VALUES ()`, []);
      const id =
        ins?.insertId || (await db.get(`SELECT LAST_INSERT_ID() AS id`))?.id;

      await db.run(
        `INSERT INTO tags_translations(tag_id, language, name, slug)
         VALUES(?, ?, ?, ?)`,
        [id, lang, name, theSlug]
      );

      res.redirect("/admin/tags");
    } catch (e) {
      // Nếu lỗi do ràng buộc UNIQUE slug/name… có thể hiển thị thông báo
      res.status(400).send("Không tạo được tag: " + (e.message || String(e)));
    }
  }
);

/** Xoá (soft-delete nếu có cột deleted_at, không thì hard-delete an toàn) */
router.post(
  "/:id/delete",
  requireRoles("admin", "editor"),
  async (req, res) => {
    const db = await getDb();
    const id = parseInt(req.params.id, 10);

    try {
      const hasDeletedAt = await hasColumn(db, "tags", "deleted_at");

      if (hasDeletedAt) {
        await db.run(
          `UPDATE tags SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [id]
        );
      } else {
        // Không có deleted_at -> xoá cứng (giữ toàn vẹn dữ liệu)
        await db.run(`DELETE FROM tags_translations WHERE tag_id = ?`, [id]);
        await db.run(`DELETE FROM posts_tags WHERE tag_id = ?`, [id]).catch(
          () => {}
        ); // bảng liên kết có thể chưa tồn tại – nuốt lỗi
        await db.run(`DELETE FROM tags WHERE id = ?`, [id]);
      }

      res.redirect("/admin/tags");
    } catch (e) {
      res
        .status(400)
        .send("Không xoá được tag: " + (e.message || String(e)));
    }
  }
);

export default router;
