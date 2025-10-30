function htmlesc(s) {
  return (s ?? "").toString().replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m])
  );
}
// ================== DỮ LIỆU CÂU HỎI (hardcode) ==================

// ================== BIẾN TOÀN CỤC ==================
let questionsByField = {};
let selectedQuestions = [];
let mode = "practice"; // "practice" | "exam"
let currentIndex = 0;
let userAnswers = {}; // { questionIndex: answerIndex(1..4) }
let isQuizStarted = false;
let quizStartAt = 0; // timestamp ms
const LS_KEY_SESSION = "quiz_active_session_v1";
let lastIndexBeforeJump = null; // nhớ vị trí trước khi nhảy tới "chưa làm"
let questionData = [];

/* ====== [BỔ SUNG] LocalStorage lưu số câu theo lĩnh vực ====== */
const LS_KEY_FIELD_COUNTS = "quiz_field_counts_v1";
function lsLoadCounts() {
  try {
    const raw = localStorage.getItem(LS_KEY_FIELD_COUNTS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function lsSaveCounts(map) {
  try {
    localStorage.setItem(LS_KEY_FIELD_COUNTS, JSON.stringify(map || {}));
  } catch {}
}
function readCountsFromInputs() {
  const map = {};
  document
    .querySelectorAll('#fieldInputs input[type="number"]')
    .forEach((inp) => {
      const field = inp.dataset.field;
      const val = parseInt(inp.value || "0", 10);
      map[field] = isNaN(val) ? 0 : val;
    });
  return map;
}
/* ====== [HẾT BỔ SUNG] ====== */

// 2. Hàm fetch + parse XML
async function loadQuestionsFromJSON() {
  const jsonUrl = "../data/questions.json"; // hoặc raw.githubusercontent nếu chưa dùng Pages
  const res = await fetch(jsonUrl);
  if (!res.ok) throw new Error("Không tải được JSON");

  const resdata = await res.json();
  const data = resdata.questions;
  document.getElementById("eXamTitle").innerText = resdata.ExamTitle;
  // build mảng mới
  const arr = data.map((q) => {
    const field = q.Field || "";
    const text = q.Text || "";
    const citation = q.Citation || "";

    const opts = Array.isArray(q.Options) ? q.Options.map((o) => o.trim()) : [];

    const rawCor = (q.Correct || "").toString().trim().toUpperCase();
    let idxCor = 0;

    if (["A", "B", "C", "D"].includes(rawCor)) {
      idxCor = rawCor.charCodeAt(0) - 64;
    } else if (/^[1-4]$/.test(rawCor)) {
      idxCor = parseInt(rawCor, 10);
    }

    return { field, text, options: opts, correct: idxCor, citation };
  });

  // Gán lại mảng questionData
  questionData = arr;
}

async function loadQuestionsFromXML() {
  const rawUrl =
    "https://raw.githubusercontent.com/hungtvht/tracnghiem/main/xml.xml";
  const res = await fetch(rawUrl);
  if (!res.ok) throw new Error("Không tải được XML");
  const xmlText = await res.text();

  // parse
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  // NodeList → Array
  const questions = Array.from(doc.getElementsByTagName("Question"));

  // build mảng mới
  const arr = questions.map((qEl) => {
    const field = qEl.querySelector("Field")?.textContent || "";
    const text = qEl.querySelector("Text")?.textContent || "";
    const citation = qEl.querySelector("Citation")?.textContent || "";

    // options A–D
    const opts = Array.from(qEl.getElementsByTagName("Option"))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((o) => o.textContent.trim());

    // correct letter → index 1..4
    const letCor = qEl.querySelector("Correct")?.textContent.trim() || "A";
    const idxCor = letCor.charCodeAt(0) - 64;

    return { field, text, options: opts, correct: idxCor, citation };
  });

  // Gán lại mảng questionData
  questionData = arr;
}

function formatDuration(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return (
    (h > 0 ? `${h}:` : "") +
    `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  );
}
function classifyScore(score) {
  if (score >= 90) return { rank: "Xuất sắc", icon: "🏆" };
  if (score >= 80) return { rank: "Giỏi", icon: "🥇" };
  if (score >= 65) return { rank: "Khá", icon: "🥈" };
  if (score >= 50) return { rank: "Trung bình", icon: "🥉" };
  return { rank: "Cần cố gắng", icon: "🎗️" };
}

/* =========== Lưu/khôi phục phiên làm bài =========== */
// Ta lưu chỉ số câu hỏi đã chọn (stt-1) thay vì dump nguyên object
function buildSelectedIndices() {
  return selectedQuestions
    .map((q) => (q.stt ? q.stt - 1 : null))
    .filter((x) => x !== null);
}
function restoreSelectedFromIndices(idxs) {
  selectedQuestions = idxs
    .map((i) => questionData[i])
    .filter(Boolean)
    .map((q, i) => ({ ...q, stt: (idxs[i] ?? i) + 1 })); // giữ stt hợp lý
}

// ===== Lưu phiên "lười": gộp nhiều lần gọi, đợi browser rảnh rồi mới ghi =====
let __saveTimer = null;
let __savePending = false;
const SAVE_DEBOUNCE_MS = 300;
const SAVE_IDLE_TIMEOUT = 600;

// Tránh ghi khi không đổi: cache bản JSON cuối
let __lastSaved = "";

function saveActiveSessionLazy() {
  if (!isQuizStarted) return;

  if (__savePending) return;
  __savePending = true;

  clearTimeout(__saveTimer);
  __saveTimer = setTimeout(() => {
    __savePending = false;
    const doSave = () => {
      // Tạo payload **không** có savedAt để so sánh được
      const payload = {
        mode,
        currentIndex,
        userAnswers,
        selectedIdxs: buildSelectedIndices(),
        quizStartAt,
      };
      const s = JSON.stringify(payload);
      if (s === __lastSaved) return; // không đổi → khỏi ghi
      __lastSaved = s;
      try {
        localStorage.setItem(
          LS_KEY_SESSION,
          JSON.stringify({ ...payload, savedAt: Date.now() })
        );
      } catch {}
    };
    if ("requestIdleCallback" in window) {
      requestIdleCallback(doSave, { timeout: SAVE_IDLE_TIMEOUT });
    } else {
      setTimeout(doSave, 0);
    }
  }, SAVE_DEBOUNCE_MS);
}

function saveActiveSession() {
  if (!isQuizStarted || !selectedQuestions?.length) return;
  const payload = {
    mode,
    currentIndex,
    userAnswers,
    selectedIdxs: buildSelectedIndices(),
    quizStartAt,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(LS_KEY_SESSION, JSON.stringify(payload));
  } catch {}
}
function clearActiveSession() {
  try {
    localStorage.removeItem(LS_KEY_SESSION);
  } catch {}
}
function tryResumeSession() {
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem(LS_KEY_SESSION) || "null");
  } catch {}
  if (!payload) return false;

  // Hỏi người dùng có tiếp tục không
  const ok = confirm(
    `❓Phát hiện bạn đang ${
      payload.mode === "practice" ? "Ôn thi" : "Thi thật"
    } dở dang.\n` + `Bạn có muốn tiếp tục không?`
  );
  if (!ok) return false;

  // Khôi phục
  mode = payload.mode === "exam" ? "exam" : "practice";
  currentIndex = Math.max(
    0,
    Math.min(payload.currentIndex ?? 0, (payload.selectedIdxs?.length || 1) - 1)
  );
  userAnswers = payload.userAnswers || {};
  restoreSelectedFromIndices(payload.selectedIdxs || []);
  if (!selectedQuestions.length) {
    alert("Không thể khôi phục câu hỏi. Bắt đầu mới nhé!");
    clearActiveSession();
    return false;
  }

  isQuizStarted = true;
  quizStartAt = payload.quizStartAt || Date.now();

  // Ẩn cấu hình, hiện nav + render
  document.getElementById("configSection").style.display = "none";
  document.getElementById("resultView").style.display = "none";
  document.getElementById("quizContainer").style.display = "block";
  document.getElementById("navBar").style.display = "flex";
  renderQuestion();
  return true;
}

// ================== KHỞI TẠO LĨNH VỰC ==================
function populateFields() {
  const fieldInputs = document.getElementById("fieldInputs");
  fieldInputs.innerHTML = "";
  questionsByField = {};

  questionData.forEach((q, i) => {
    if (!questionsByField[q.field]) questionsByField[q.field] = [];
    questionsByField[q.field].push({ ...q, stt: i + 1 });
  });

  /* [BỔ SUNG] lấy cấu hình đã lưu (nếu có) */
  //const savedCounts = lsLoadCounts();

  Object.keys(questionsByField).forEach((field) => {
    const max = questionsByField[field].length;
    const defaultVal = 0;
    //typeof savedCounts[field] === "number" ? savedCounts[field] : max;

    const col = document.createElement("div");
    col.className = "col-12 col-md-6 col-lg-4";
    col.innerHTML = `
      <div class="p-3 rounded" style="background: #2a2a2a;border:1px solid #2a2f3a;">
        <div class="d-flex justify-content-between align-items-center mb-2 text-white">
          <strong>${field}</strong>
          <span class="badge-soft">${max} câu</span>
        </div>
        <label class="form-label muted">Số câu chọn</label>
        <input type="number" min="0" max="${max}" value="${Math.min(
      defaultVal,
      max
    )}"
               class="form-control bg-dark text-light border-secondary" data-field="${field}">
      </div>
    `;
    fieldInputs.appendChild(col);
  });

  /* [BỔ SUNG] lắng nghe thay đổi để lưu ngay vào LocalStorage */
  document
    .querySelectorAll('#fieldInputs input[type="number"]')
    .forEach((inp) => {
      inp.addEventListener("change", () => {
        const map = lsLoadCounts();
        const field = inp.dataset.field;
        const max = (questionsByField[field] || []).length;
        let val = parseInt(inp.value || "0", 10);
        if (isNaN(val)) val = 0;
        val = Math.max(0, Math.min(val, max));
        inp.value = val;
        map[field] = val;
        lsSaveCounts(map);
      });
    });
}

// ================== CHUYỂN TAB ==================
function switchTab(tab) {
  document.getElementById("homeTab").style.display =
    tab === "home" ? "block" : "none";
  document.getElementById("searchTab").style.display =
    tab === "search" ? "block" : "none";
  document.getElementById("aboutTab").style.display =
    tab === "about" ? "block" : "none";
  document
    .querySelectorAll("#mainTabs .nav-link")
    .forEach((l) => l.classList.remove("active"));
  document
    .querySelector(`#mainTabs .nav-link[onclick*="${tab}"]`)
    .classList.add("active");

  /* [BỔ SUNG] Hiện/ẩn nút GoTop tùy theo tab */
  const goTopBtn = document.getElementById("goTopBtn");
  if (goTopBtn)
    goTopBtn.style.display = tab === "search" ? "inline-flex" : "none";
}

// ================== BẮT ĐẦU THI ==================
function startPractice() {
  mode = "practice";
  prepareQuiz();
}
function startExam() {
  mode = "exam";
  prepareQuiz();
}

function prepareQuiz() {
  selectedQuestions = [];
  userAnswers = {};
  currentIndex = 0;

  const inputs = document.querySelectorAll('#fieldInputs input[type="number"]');

  const mapToSave = {};
  for (const input of inputs) {
    const field = input.dataset.field;
    const count = parseInt(input.value || "0", 10);
    const pool = questionsByField[field] || [];

    if (count > pool.length) {
      alert(`Lĩnh vực "${field}" chỉ có ${pool.length} câu hỏi.`);
      return;
    }
    if (count > 0) {
      selectedQuestions.push(...shuffle(pool).slice(0, count));
    }
    mapToSave[field] = isNaN(count) ? 0 : count;
  }
  lsSaveCounts(mapToSave);

  if (selectedQuestions.length === 0) {
    alert("Vui lòng chọn ít nhất một câu hỏi.");
    return;
  }

  isQuizStarted = true;
  quizStartAt = Date.now(); // ⭐ bắt đầu tính thời gian

  document.getElementById("configSection").style.display = "none";
  document.getElementById("resultView").style.display = "none";
  document.getElementById("quizContainer").style.display = "block";
  document.getElementById("navBar").style.display = "flex";
  renderQuestion();

  saveActiveSession(); // lưu ngay phiên mới
}

// ================== HIỂN THỊ CÂU HỎI ==================
function renderQuestion() {
  const container = document.getElementById("quizContainer");
  container.innerHTML = "";

  const q = selectedQuestions[currentIndex];
  const card = document.createElement("div");
  card.className = "card mb-3";

  const body = document.createElement("div");
  body.className = "card-body p-1";

  /* const head = document.createElement("div");
  head.className = "d-flex justify-content-between align-items-center mb-2";
  head.innerHTML = `
    <div class="badge-soft text-info">Câu ${currentIndex + 1} / ${
    selectedQuestions.length
  }</div>
    <div class="muted d-none">${q.field}</div>
  `;
  body.appendChild(head); */

  const title = document.createElement("p");
  title.className = "mb-2 text-info";
  title.textContent = q.text;
  body.appendChild(title);

  q.options.forEach((opt, idx) => {
    if (!opt || opt.trim() === "") return; // ⭐ ẩn option trống

    const btn = document.createElement("div");
    btn.className = "answer-option appear mt-2";
    //btn.style.animationDelay = `${idx * 40}ms`;
    btn.textContent = `${String.fromCharCode(65 + idx)}. ${opt}`;

    if (userAnswers[currentIndex] === idx + 1) {
      btn.classList.add("selected");
      if (mode === "practice") {
        // Nếu đúng → thêm hiệu ứng burst
        if (userAnswers[currentIndex] === q.correct) {
          //btn.classList.add("correct-burst");
          btn.classList.add("text-warning");
        } else {
          // Nếu sai → thêm hiệu ứng shake
          //btn.classList.add("wrong-shake");
          btn.classList.add("text-dark");
        }

        // Tự gỡ class animation sau khi chạy xong để lần sau còn tái sử dụng
        /*   setTimeout(() => {
          btn.classList.remove("correct-burst", "wrong-shake");
        }, 700); */
      }
    }

    btn.onclick = () => {
      userAnswers[currentIndex] = idx + 1;
      saveActiveSessionLazy(); // ⭐ lưu ngay sau khi chọn đáp án
      renderQuestion();
    };

    body.appendChild(btn);
  });

  if (mode === "practice" && userAnswers[currentIndex]) {
    /* const isCorrect = userAnswers[currentIndex] === q.correct;
    const fb = document.createElement("div");
    fb.className = `alert mt-3 ${isCorrect ? "alert-success" : "alert-danger"}`;
    fb.innerHTML = isCorrect
      ? `✔️ Chính xác!<br>Trích dẫn: ${q.citation}`
      : `✖️ Bạn ơi sai rồi tề!`;
    body.appendChild(fb); */
  }

  card.appendChild(body);
  container.appendChild(card);
  // ================== CẬP NHẬT NÚT CÂU CHƯA LÀM ==================
  const btnNot = document.getElementById("btnNotSelected");
  if (btnNot) {
    const count = getUnansweredIndices().length;
    btnNot.textContent = `${currentIndex + 1}/${
      selectedQuestions.length
    }:${count}`; // hiện số câu chưa làm
  }

  // ⭐ lần render nào cũng lưu phiên (vị trí câu…)
  saveActiveSessionLazy();
}
//
function showHelp() {
  alert(
    `📢 Đáp án đúng là ${String.fromCharCode(
      64 + parseInt(selectedQuestions[currentIndex].correct)
    )}:
${selectedQuestions[currentIndex].citation}`
  );
}
// ================== ĐIỀU HƯỚNG ==================
function goPrev() {
  if (currentIndex > 0) {
    currentIndex--;
    renderQuestion();
    saveActiveSessionLazy(); // ⭐
  } else {
    alert("📢 Đây là câu đầu tiên!");
  }
}
function goNext() {
  if (currentIndex < selectedQuestions.length - 1) {
    currentIndex++;
    renderQuestion();
    saveActiveSessionLazy(); // nếu bạn đang dùng lưu phiên
  } else {
    alert("📢 Bạn đang ở câu hỏi cuối cùng!");
  }
}
//=================== LẤY CÁC CÂU CHƯA LÀM ==================
function getUnansweredIndices() {
  const arr = [];
  for (let i = 0; i < selectedQuestions.length; i++) {
    if (!userAnswers[i]) arr.push(i);
  }
  return arr;
}

//=================== TÌM CÂU CHƯA LÀM ==================
function goNotSelected() {
  const unanswered = getUnansweredIndices();
  const btn = document.getElementById("btnNotSelected");
  if (btn) btn.textContent = unanswered.length; // cập nhật số ngay lúc bấm

  if (unanswered.length === 0) {
    alert("✅ Không còn câu chưa làm.");
    return;
  }

  const firstUn = unanswered[0];

  // Nếu đang ở chính câu "chưa làm đầu tiên" và có vị trí cũ -> quay lại
  if (currentIndex === firstUn && lastIndexBeforeJump !== null) {
    currentIndex = Math.max(
      0,
      Math.min(lastIndexBeforeJump, selectedQuestions.length - 1)
    );
    lastIndexBeforeJump = null;
    renderQuestion();
    saveActiveSession();
    return;
  }

  // Lưu vị trí hiện tại rồi nhảy tới câu chưa làm đầu tiên
  lastIndexBeforeJump = currentIndex;
  currentIndex = firstUn;
  renderQuestion();
  saveActiveSession();
}

// ================== NỘP BÀI & THOÁT ==================
function submitQuiz() {
  if (!isQuizStarted) return;
  if (!confirm("❓Bạn có chắc muốn nộp bài không?")) return;
  document
    .getElementById("navBar")
    .style.setProperty("display", "none", "important");
  let correct = 0;
  selectedQuestions.forEach((q, i) => {
    if (userAnswers[i] === q.correct) correct += 1;
  });
  const total = selectedQuestions.length;
  const score = Math.round((correct / total) * 100);
  const spent = Date.now() - (quizStartAt || Date.now());

  const { rank, icon } = classifyScore(score);

  // đổ dữ liệu lên màn hình kết quả
  document.getElementById("rsTime").textContent = formatDuration(spent);
  document.getElementById("rsCorrect").textContent = `${correct} / ${total}`;
  document.getElementById("rsScore").textContent = `${score}`;
  document.getElementById("rsRank").textContent = rank;
  document.getElementById("resultIcon").textContent = icon;

  const actionBtn = document.getElementById("rsActionBtn");
  if (mode === "practice") {
    actionBtn.textContent = "🧠 Ôn lại";
    actionBtn.onclick = () => {
      resetToHome();
      startPractice();
    };
  } else {
    actionBtn.textContent = "🔁 Thi lại";
    actionBtn.onclick = () => {
      resetToHome();
      startExam();
    };
  }

  // hiển thị Result view, ẩn phần thi
  document.getElementById("quizContainer").style.display = "none";
  document.getElementById("navBar").style.display = "none";
  document.getElementById("resultView").style.display = "block";

  // kết thúc phiên (không còn tiếp tục)
  clearActiveSession();
  isQuizStarted = false;
}

function resetToHome() {
  selectedQuestions = [];
  userAnswers = {};
  currentIndex = 0;
  isQuizStarted = false;
  quizStartAt = 0;

  document.getElementById("configSection").style.display = "block";
  document.getElementById("quizContainer").innerHTML = "";
  document.getElementById("quizContainer").style.display = "block";
  document.getElementById("resultView").style.display = "none";
  document
    .getElementById("navBar")
    .style.setProperty("display", "none", "important");

  switchTab("home");
  clearActiveSession();
}

// ================== TÌM KIẾM ==================
function searchQuestions() {
  const input = document.getElementById("searchInput").value.trim();
  const container = document.getElementById("searchResults");

  if (!input) {
    container.innerHTML = "";
    return;
  }

  // 1. Escape các ký tự đặc biệt của RegExp, ngoại trừ '%'
  const escaped = ("%" + input + "%").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 2. Thay '%' thành '.*' để làm wildcard
  //    và đóng khung pattern với ^...$ để toàn bộ chuỗi phải khớp
  const pattern = "^" + escaped.replace(/%/g, ".*") + "$";

  // 3. Tạo RegExp, ignore case
  const regex = new RegExp(pattern, "i");

  // 4. Lọc dữ liệu
  const results = questionData
    .map((q, i) => ({ ...q, stt: i + 1 }))
    .filter(
      (q) => regex.test(q.text) || q.options.some((opt) => regex.test(opt))
    );

  // 5. Hiển thị
  if (results.length === 0) {
    container.innerHTML = `<div class="alert alert-soft">Không tìm thấy câu hỏi phù hợp.</div>`;
    return;
  }

  let html = `
    <div class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table table-dark table-bordered">
            <thead>
              <tr>
                <th>Câu hỏi</th>
                <th>Đáp án</th>
              </tr>
            </thead>
            <tbody>
  `;

  results.forEach((q) => {
    /*  const answers = q.options
      .map((opt, idx) => {
        const label = String.fromCharCode(65 + idx);
        const isCorrect = idx + 1 === q.correct;
        return `<div class="${
          isCorrect ? "highlight" : "d-none"
        }">${label}. ${opt}</div>`;
      })
      .join(""); */
    const correctIdx = (q.correct ?? 0) - 1;
    const answers =
      correctIdx >= 0 && correctIdx < q.options.length
        ? `<div class="text-info">${htmlesc(q.options[correctIdx])}</div>`
        : "";

    html += `
      <tr>
        <td>${q.text}</td>
        <td>${answers}</td>        
      </tr>
    `;
  });

  html += `
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  container.innerHTML = html;
}

/* ====== [BỔ SUNG] Nút ảo GoTop: focus + select ô tìm kiếm ====== */
function goTopFocusSearch() {
  const el = document.getElementById("searchInput");
  if (!el) return;
  // nếu đang ở tab khác, chuyển sang tab search
  if (document.getElementById("searchTab").style.display === "none") {
    switchTab("search");
  }
  el.focus();
  el.select();
}
/* ====== [HẾT BỔ SUNG] ====== */

// ================== TIỆN ÍCH ==================
function shuffle(array) {
  if (!Array.isArray(array)) return [];
  return [...array].sort(() => Math.random() - 0.5);
}

// ================== BOOTSTRAP ==================
// 👇 1. Chờ DOM sẵn sàng — KHÔNG chờ ảnh, font, JS...
document.addEventListener("DOMContentLoaded", async () => {
  // 👉 Hiển thị spinner NGAY khi DOM có sẵn (người dùng thấy ngay!)
  const spinner = document.getElementById("globalSpinner");
  const appContent = document.getElementById("appContent");

  // Đảm bảo spinner hiện, content ẩn
  spinner.style.display = "flex";
  appContent.style.display = "none";

  try {
    // 👉 BẮT ĐẦU TÁC VỤ NẶNG — đây là lúc spinner hoạt động!
    await loadQuestionsFromJSON(); // <-- fetch JSON, có thể mất 1–5s
    populateFields();

    // 👉 Hoàn thành — ẩn spinner, hiện nội dung
    spinner.style.display = "none";
    appContent.style.display = "block";

    // Các chức năng còn lại
    document
      .getElementById("navBar")
      .style.setProperty("display", "none", "important");
    switchTab("home");
    tryResumeSession();

    // Đăng ký sự kiện lưu phiên
    window.addEventListener("beforeunload", saveActiveSession);
    window.addEventListener(
      "pagehide",
      () => {
        try {
          saveActiveSession();
        } catch {}
      },
      { capture: true }
    );

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        try {
          saveActiveSession();
        } catch {}
      }
    });
    // 👇 2. Bắt sự kiện toàn cục (nếu cần) — ví dụ: phím tắt
    document.addEventListener("keydown", function (event) {
      // Check if the pressed key's keyCode is 13 (Enter key)
      if (
        event.keyCode === 13 &&
        document.getElementById("searchTab").style.display !== "none"
      ) {
        selectSearchNoScroll();
        // You can call a function or perform an action here
        // e.g., myFunction();
      }
    });
  } catch (error) {
    console.error("Lỗi khi tải dữ liệu:", error);
    spinner.innerHTML = `
      <div class="alert alert-danger text-center">
        Không thể tải dữ liệu. Vui lòng thử lại sau.
      </div>
    `;
  }
});
// Focus + select vào #searchInput nhưng KHÔNG cuộn trang
function selectSearchNoScroll() {
  const input = document.getElementById("searchInput");
  if (!input) return;

  // Lưu vị trí cuộn hiện tại
  const x = window.scrollX;
  const y = window.scrollY;

  // Focus không cuộn (hỗ trợ tốt trên trình duyệt hiện đại)
  try {
    input.focus({ preventScroll: true });
  } catch {
    // fallback nếu trình duyệt không hỗ trợ
    input.focus();
  }

  // Chọn toàn bộ nội dung
  try {
    // Dùng setSelectionRange để tránh 1 số trường hợp select() gây scroll
    const len = input.value?.length ?? 0;
    input.setSelectionRange(0, len, "forward");
  } catch {
    input.select();
  }

  // Khôi phục vị trí cuộn ngay lập tức (phòng khi select vẫn làm trang nhúc nhích)
  window.scrollTo(x, y);
}

// Khi click trong tab "Thư viện câu hỏi" → chỉ focus + select, KHÔNG goTop
(function attachSearchNoGoTop() {
  const tab = document.getElementById("searchTab");
  if (!tab) return;

  const handler = (e) => {
    // Chỉ chạy khi tab đang hiển thị
    if (tab.style.display === "none") return;

    // Nếu bấm trực tiếp lên input, vẫn giữ nguyên hành vi — nhưng ngăn cuộn
    selectSearchNoScroll();
  };

  // Lắng nghe click & touch (mobile)
  tab.addEventListener("click", handler);
  tab.addEventListener("touchstart", handler, { passive: true });
})();
