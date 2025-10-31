// server/utils/time.js
import { parse } from "date-fns";
import * as dftz from "date-fns-tz";

/**
 * formatUtcToTZ:
 *  - utcString: 'YYYY-MM-DD HH:mm:ss' (UTC trong DB)
 *  - tz: 'Asia/Ho_Chi_Minh'
 *  - fmt: 'dd/MM/yyyy HH:mm'
 */
export function formatUtcToTZ(utcString, tz, fmt = "dd/MM/yyyy HH:mm") {
  if (!utcString) return "";
  // Tạo Date từ chuỗi UTC 'YYYY-MM-DD HH:mm:ss'
  const iso = utcString.replace(" ", "T") + "Z";
  const dt = new Date(iso);
  try {
    return dftz.formatInTimeZone(dt, tz, fmt);
  } catch {
    return dftz.formatInTimeZone(dt, "UTC", fmt);
  }
}

/**
 * localToUtcSql:
 *  - localStr: 'YYYY-MM-DDTHH:mm' (từ <input type="datetime-local">)
 *  - tz: timezone trong Setting
 * Convert về chuỗi SQLite 'YYYY-MM-DD HH:mm:ss' (UTC)
 *
 * Thuật toán không phụ thuộc zonedTimeToUtc (tránh lỗi import version):
 * 1) Dựng mốc UTC giả từ local components.
 * 2) Tính offset của tz tại thời điểm đó.
 * 3) Điều chỉnh 1-2 vòng để hội tụ offset chính xác (xử lý DST).
 */
export function localToUtcSql(localStr, tz) {
  if (!localStr) return null;
  // Parse 'yyyy-MM-dd\'T\'HH:mm' thành components
  const d = parse(localStr, "yyyy-MM-dd'T'HH:mm", new Date());

  // B1: UTC "naive" (coi local components là UTC luôn)
  let guess = Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    0,
    0
  );

  // Hàm lấy offset phút của tz tại thời điểm t (UTC millis)
  const getOffsetMin = (t) => {
    // 'XXX' => +07:00, -04:30 ...
    const off = dftz.formatInTimeZone(new Date(t), tz, "XXX");
    const sign = off.startsWith("-") ? -1 : 1;
    const [hh, mm] = off.slice(1).split(":").map((x) => parseInt(x, 10) || 0);
    return sign * (hh * 60 + mm);
  };

  // Lặp 2 vòng để hội tụ offset (đủ cho DST)
  let off0 = getOffsetMin(guess);
  let t1 = guess - off0 * 60_000;
  let off1 = getOffsetMin(t1);
  if (off1 !== off0) {
    t1 = guess - off1 * 60_000;
  }

  // Trả về theo chuẩn SQLite
  const dt = new Date(t1);
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = dt.getUTCFullYear();
  const MM = pad(dt.getUTCMonth() + 1);
  const dd = pad(dt.getUTCDate());
  const HH = pad(dt.getUTCHours());
  const mm = pad(dt.getUTCMinutes());
  const ss = pad(dt.getUTCSeconds());
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
}
