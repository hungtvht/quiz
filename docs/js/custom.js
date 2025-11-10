function isValidRoman(str) {
  if (!/^[IVXLCDM]+$/.test(str.toUpperCase())) return false; // Chỉ chữ hoa cơ bản
  str = str.toUpperCase();
  const romanMap = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let num = 0;
  for (let i = 0; i < str.length; i++) {
    const curr = romanMap[str[i]];
    const next = i + 1 < str.length ? romanMap[str[i + 1]] : 0;
    if (curr < next) {
      num -= curr; // Trừ đi (như IV = 5 - 1)
    } else {
      num += curr;
    }
  }
  return num > 0 && num <= 3999; // Hợp lệ nếu >0 và không vượt giới hạn
}

// Sử dụng: !isValidRoman(cleanA)  // true nếu KHÔNG phải La Mã
// Lưu trữ trạng thái UI vào localStorage
function saveUIState(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
// Tải trạng thái UI từ localStorage
function loadUIState(key, defaultValue) {
  const v = localStorage.getItem(key);
  return v ? JSON.parse(v) : defaultValue;
}
const VISIT_API_URL =
  "https://quiz-backend-nhyy.onrender.com/api/v1/visits/increment";

/**
 * Ghi nhận một lượt truy cập bằng cách gọi API backend.
 * Sử dụng kỹ thuật "fire-and-forget" (gửi yêu cầu mà không chờ hoặc quan tâm đến phản hồi)
 * để không làm chậm quá trình tải quiz.
 */
function recordVisit() {
  fetch(VISIT_API_URL, {
    method: "POST",
    mode: "cors",
    cache: "no-cache",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((response) => {
      if (!response.ok) {
        console.warn("⚠️ API đếm lượt truy cập lỗi:", response.status);
      }
    })
    .catch((error) => {
      // Lỗi mạng hoặc lỗi CORS
      console.error("Lỗi khi gửi API visits:", error.message);
    });
}
async function getVisits(id) {
  fetch("https://quiz-backend-nhyy.onrender.com/api/v1/visits", {
    method: "GET",
  })
    .then((res) => res.json())
    .then((data) => {
      console.log("👁️ Lượt truy cập:", data.count);
      const counter = document.getElementById(id);
      if (counter) counter.innerText = formatNumberVN(data.count);
    })
    .catch((err) => console.error("⚠️ Lỗi khi gửi API visits:", err));
}
document.addEventListener("DOMContentLoaded", async () => {
  recordVisit();
});
function formatNumberVN(num) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(num);
}
