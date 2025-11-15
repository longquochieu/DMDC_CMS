// server/utils/time.js
function toUtcDate(utcInput) {
  if (!utcInput) return null;
  if (utcInput instanceof Date) {
    // Đã là Date (giả sử UTC) -> clone
    return new Date(utcInput.getTime());
  }
  const s = String(utcInput);
  // hỗ trợ 'YYYY-MM-DD HH:mm:ss' hoặc ISO
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(iso.endsWith('Z') ? iso : (iso + 'Z'));
  return isNaN(d) ? null : d;
}

export function formatUtcToTZ(utcValue, timeZone = "Asia/Ho_Chi_Minh", out = "yyyy-MM-dd HH:mm") {
  if (!utcValue) return "—";
  let d;
  if (utcValue instanceof Date) {
    d = utcValue;
  } else if (typeof utcValue === "string") {
    // "YYYY-MM-DD HH:mm:ss" -> Date UTC
    const s = utcValue.includes("T") ? utcValue : utcValue.replace(" ", "T");
    d = new Date(s.endsWith("Z") ? s : s + "Z");
  } else if (typeof utcValue === "number") {
    d = new Date(utcValue);
  } else {
    return "—";
  }
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: false
    }).formatToParts(d);
    const get = t => parts.find(p => p.type === t)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  } catch {
    // fallback ISO
    return new Date(d.getTime()).toISOString().slice(0,16).replace("T"," ");
  }
}

/** Chuyển local time (input dạng 'YYYY-MM-DDTHH:mm' theo tz) -> chuỗi UTC 'YYYY-MM-DD HH:mm:ss' */
export function localToUtcSql(localValue /* 'YYYY-MM-DDTHH:mm' */, timeZone = "Asia/Ho_Chi_Minh") {
  if (!localValue) return null;
  // Không có thư viện tz chuyên dụng -> tạm coi input là local-time của server
  // và convert sang UTC ISO.
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  return iso.slice(0, 19).replace("T", " ");
}