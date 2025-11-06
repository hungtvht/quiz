/**
 * 🧩 normalizeVietnameseText.js
 * Chuẩn hóa văn bản tiếng Việt — dùng cho dữ liệu hành chính, văn bản, hoặc nội dung web.
 * Có thể dùng độc lập trong trình duyệt hoặc Node.js.
 *
 * © Thầy Elon Wusk – LuyenAI.vn
 */

function normalizeVietnameseText(text, options = {}) {
  if (!text || typeof text !== "string") return "";

  const defaultOptions = {
    capitalizeFirst: true, // Viết hoa chữ cái đầu tiên
    normalizeUnicode: true, // Chuẩn hóa mã Unicode (NFC)
    fixSpacing: true, // Chuẩn hóa khoảng trắng, dấu câu
    fixQuotes: true, // Chuẩn hóa ngoặc kép, ngoặc đơn
    fixDash: true, // Thêm khoảng trắng quanh dấu "-"
    removeExtraSpaces: true, // Loại bỏ khoảng trắng thừa đầu/cuối
    preserveCase: false, // Giữ nguyên chữ hoa/thường (false = tự động viết hoa đầu câu)
  };

  const opts = { ...defaultOptions, ...options };
  let result = text;

  // 🔹 1. Chuẩn hóa Unicode tiếng Việt
  if (opts.normalizeUnicode) {
    result = result.normalize("NFC");
  }

  // 🔹 2. Chuẩn hóa khoảng trắng, xuống dòng, tab
  if (opts.fixSpacing) {
    result = result
      .replace(/\s+/g, " ") // Gộp nhiều khoảng trắng thành 1
      .replace(/[\u00A0]/g, " "); // Non-breaking space → space
  }

  // 🔹 3. Chuẩn hóa dấu câu và ngoặc
  if (opts.fixQuotes) {
    result = result
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s*,\s*/g, ", ") // Chuẩn hóa dấu phẩy
      .replace(/\s*:\s*/g, ": ") // Chuẩn hóa dấu hai chấm
      .replace(/\s*;\s*/g, "; "); // Chuẩn hóa dấu chấm phẩy
  }

  // 🔹 4. Chuẩn hóa dấu gạch ngang
  if (opts.fixDash) {
    result = result.replace(/\s*-\s*/g, " - ");
  }

  // 🔹 5. Xóa khoảng trắng đầu/cuối
  if (opts.removeExtraSpaces) {
    result = result.trim();
  }

  // 🔹 6. Viết hoa chữ cái đầu
  if (opts.capitalizeFirst && !opts.preserveCase) {
    result = result.replace(/^([a-zà-ỹ])/i, (m) => m.toUpperCase());
  }

  return result;
}

/**
 * 🧠 normalizeVietnameseObject(obj)
 * Chuẩn hóa toàn bộ các giá trị chuỗi trong một object JSON.
 */
function normalizeVietnameseObject(obj, options = {}) {
  if (Array.isArray(obj)) {
    return obj.map((item) => normalizeVietnameseObject(item, options));
  }
  if (typeof obj === "object" && obj !== null) {
    const newObj = {};
    for (const key in obj) {
      if (typeof obj[key] === "string") {
        newObj[key] = normalizeVietnameseText(obj[key], options);
      } else {
        newObj[key] = normalizeVietnameseObject(obj[key], options);
      }
    }
    return newObj;
  }
  return obj;
}

// ✅ Nếu chạy trong trình duyệt
if (typeof window !== "undefined") {
  window.normalizeVietnameseText = normalizeVietnameseText;
  window.normalizeVietnameseObject = normalizeVietnameseObject;
}

// ✅ Nếu chạy trong Node.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeVietnameseText, normalizeVietnameseObject };
}
