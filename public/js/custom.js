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
