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
    console.log("Lưu cấu hình lĩnh vực:", map);
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

let quizList = [];
let currentQuizSource = "../data/questions.json";

async function loadQuizList() {
  const res = await fetch("../data/quizlist.json");
  if (!res.ok) throw new Error("Không tải được danh sách bộ đề");
  quizList = await res.json();
  quizList = quizList.slice(0, 10);
  const select = document.getElementById("quizListSelect");
  quizList.forEach((qz, inx) => {
    const opt = document.createElement("option");
    opt.value = qz.source;
    opt.textContent = (inx + 1).toString().padStart(2, "0") + ". " + qz.title;
    select.appendChild(opt);
  });
  const savedSource = localStorage.getItem("quizSelectedSource");
  if (savedSource) {
    select.value = savedSource;
    currentQuizSource = savedSource;
  } else if (quizList.length > 0) {
    // Nếu chưa chọn lần nào, mặc định load bộ đầu tiên
    currentQuizSource = quizList[0].source;
    select.value = currentQuizSource;
  }
}

async function loadSelectedQuiz() {
  const sel = document.getElementById("quizListSelect");
  if (!sel.value) return;
  currentQuizSource = sel.value;

  await loadQuestionsFromJSON(currentQuizSource);
  populateFields();
}

// 2. Hàm fetch + parse XML
async function loadQuestionsFromJSON(customUrl) {
  const jsonUrl = customUrl || "../data/questions.json"; // hoặc raw.githubusercontent nếu chưa dùng Pages
  const res = await fetch(jsonUrl);
  if (!res.ok) throw new Error("Không tải được JSON");

  const resdata = await res.json();
  const data = resdata.questions;
  //document.getElementById("eXamTitle").innerText = resdata.ExamTitle;
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

  // 👉 Khôi phục thời gian đã trôi
  const elapsedSec = Math.floor((Date.now() - quizStartAt) / 1000);
  startQuizTimer(elapsedSec);

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
  const savedCounts = lsLoadCounts();

  Object.keys(questionsByField).forEach((field, idx) => {
    const max = questionsByField[field].length;
    const defaultVal =
      typeof savedCounts[field] === "number" ? savedCounts[field] : 0;

    const col = document.createElement("div");
    col.className = "col-12 col-md-6 col-lg-4";
    col.innerHTML = `
      <div class="p-3 rounded" style="background: #2a2a2a;border:1px solid #2a2f3a;">
        <div class="d-flex justify-content-between align-items-center mb-2 text-white">
          <strong>${idx + 1}. ${field}</strong>
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
    fieldInputs.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("focus", (e) => {
        e.target.select();
      });
    });
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

let cachedAllQuestions = null;
let libraryLoaded = false;

async function openLibraryTab() {
  switchTab("search");

  if (!libraryLoaded) {
    document.getElementById("searchResults").innerHTML =
      "<div class='text-center text-info'>Đang tải dữ liệu thư viện...</div>";

    cachedAllQuestions = await loadAllQuestions();
    libraryLoaded = true;

    document.getElementById(
      "searchResults"
    ).innerHTML = `<div class='text-center text-success'>✅ Đã tải ${cachedAllQuestions.length} câu hỏi hợp nhất. Nhập từ khóa để tìm kiếm!</div>`;
  }
}
// ================== BẮT ĐẦU THI ==================
function startPractice() {
  mode = "practice";
  prepareQuiz();
}
function showReview() {
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
  localStorage.setItem("quizSelectedSource", currentQuizSource);
  if (selectedQuestions.length === 0) {
    alert("Vui lòng chọn ít nhất một câu hỏi.");
    return;
  }
  // ẩn phần cấu hình
  document.getElementById("configSection").style.display = "none";
  document.getElementById("resultView").style.display = "none";
  document.getElementById("quizContainer").style.display = "block";
  document.getElementById("navBar").style.display = "none";
  document.getElementById("reviewNavBar").style.display = "block";

  // 2️⃣ Hiển thị khu vực ôn tập
  const quizContainer = document.getElementById("quizContainer");
  quizContainer.innerHTML = "";

  let html = `
    <div class="card mt-3">
      <div class="card-body">
        <h5 class="text-info mb-3">🧠 Ôn tập câu hỏi (${selectedQuestions.length} câu)</h5>
  `;

  selectedQuestions.forEach((q, i) => {
    const correctIdx = (q.correct ?? 0) - 1;
    const correctAnswer =
      correctIdx >= 0 && correctIdx < q.options.length
        ? q.options[correctIdx]
        : "—";

    html += `
      <div class="mb-4 p-3 rounded-3" style="background:#0f1520;border:1px solid var(--border)">
        <div class="fw-semibold mb-2 text-light">${i + 1}. ${htmlesc(
      q.text
    )}</div>
        <div class="ps-0">
          ${q.options
            .map((opt, idx) => {
              if (!opt || opt.trim() === "") return; // ⭐ ẩn option trống
              const letter = String.fromCharCode(65 + idx);
              const isCorrect = idx === correctIdx;
              return `
                <div class="answer-option ${isCorrect ? "selected" : ""}">
                  ${letter}. ${htmlesc(opt)}
                </div>`;
            })
            .join("")}
        </div>
       
        ${
          q.citation
            ? `<div class="small text-secondary mt-1">📚 ${htmlesc(
                q.citation
              )}</div>`
            : ""
        }
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  quizContainer.innerHTML = html;

  window.scrollTo({ top: 0, behavior: "smooth" });
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
  const examTimeInput = document.getElementById("examTime");
  // Tối ưu: Dùng parseInt(..., 10) và Math.max để đảm bảo số nguyên dương
  let examTimeInputVal = parseInt(examTimeInput.value || "0", 10);
  examTimeInputVal = Math.max(0, examTimeInputVal);

  examTimeInput.value = examTimeInputVal;
  localStorage.setItem("examTime", examTimeInputVal);
  localStorage.setItem("quizSelectedSource", currentQuizSource);
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
  startQuizTimer();
  saveActiveSession(); // lưu ngay phiên mới
}

// ================== BẮT ĐẦU ĐẾM THỜI GIAN ==================
// ================== BẮT ĐẦU HOẶC TIẾP TỤC ĐẾM THỜI GIAN ==================
let quizTimer = null;
let quizTotalTime = 0;
let quizElapsed = 0;

function startQuizTimer(elapsedAlready = 0) {
  quizTotalTime = parseInt(document.getElementById("examTime").value) * 60; //mode === "exam" ? 30 : 20; // exam: 30 phút, practice: 10 phút
  quizElapsed = elapsedAlready;

  if (quizTotalTime === 0) {
    console.log("⏸️ Không có giới hạn thời gian — bỏ qua đồng hồ đếm.");
    const progressBar = document.getElementById("timeProgress");
    if (progressBar) {
      progressBar.style.width = "0%";
    }
    return; // ⛔ Dừng ngay, không chạy timer
  }

  const progressBar = document.getElementById("timeProgress");
  if (!progressBar) return;

  // Reset giao diện
  const percent = (quizElapsed / quizTotalTime) * 100;
  progressBar.style.width = percent + "%";
  progressBar.className = "position-absolute top-0 start-0 bg-success";
  progressBar.style.opacity = "0.3";
  progressBar.dataset.flash = "off";
  progressBar.style.boxShadow = "";

  // Nếu đã hết giờ (resume quá muộn)
  if (quizElapsed >= quizTotalTime) {
    if (mode === "exam") {
      //alert("⏰ Hết giờ! Hệ thống sẽ tự động nộp bài.");
      submitQuiz(true);
    } else {
      alert("⏰ Hết thời gian ôn thi!");
    }
    return;
  }

  // Xóa timer cũ nếu có
  if (quizTimer) clearInterval(quizTimer);

  quizTimer = setInterval(() => {
    quizElapsed++;
    const percent = (quizElapsed / quizTotalTime) * 100;
    progressBar.style.width = percent + "%";

    // Đổi màu theo tiến trình
    if (percent > 70 && percent < 90) {
      progressBar.classList.replace("bg-success", "bg-warning");
    } else if (percent >= 90) {
      progressBar.classList.replace("bg-warning", "bg-danger");
    }

    const remain = quizTotalTime - quizElapsed;

    // 🕔 Thông báo trước 5 phút (chỉ thi thật)
    if (mode === "exam" && remain === 300) {
      alert("⚠️ Còn 5 phút nữa là hết giờ, hãy rà soát lại bài của bạn!");
    }

    // 🔴 10 GIÂY CUỐI: nhấp nháy cảnh báo mà không làm dịch layout
    // Flash nhấp nháy 10 giây cuối
    if (mode === "exam" && remain <= 10 && remain > 0) {
      progressBar.style.animation = "dangerFlash 0.5s infinite alternate";
    } else {
      progressBar.style.animation = "";
    }

    // ⏰ Hết giờ
    if (quizElapsed >= quizTotalTime) {
      clearInterval(quizTimer);
      quizTimer = null;
      if (mode === "exam") {
        //alert("⏰ Hết giờ! Hệ thống sẽ tự động nộp bài.");
        submitQuiz(true);
      } else {
        alert(
          "⏰ Hết thời gian ôn thi! Hãy bấm 'Nộp bài' nếu muốn xem kết quả."
        );
      }
    }
  }, 1000);
}

// ================== QUAY LẠI CHỌN LĨNH VỰC KHI ÔN TẬP ==================
function backToConfig() {
  // Ẩn phần ôn tập
  document.getElementById("quizContainer").innerHTML = "";
  document.getElementById("resultView").style.display = "none";
  document.getElementById("reviewNavBar").style.display = "none";

  // Hiện lại giao diện chọn lĩnh vực và các nút chính
  document.getElementById("configSection").style.display = "block";
  document.getElementById("navBar").style.display = "none";
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
        /* setTimeout(() => {
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

  if (unanswered.length === 0) {
    alert("✅ Không còn câu chưa làm.");
    return;
  }
  if (btn) btn.textContent = unanswered.length; // cập nhật số ngay lúc bấm
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
function submitQuiz(auto = false) {
  if (!isQuizStarted) return;

  // Nếu KHÔNG phải tự động => hỏi xác nhận
  if (!auto && !confirm("❓Bạn có chắc muốn nộp bài không?")) return;

  // Ngắt timer nếu đang chạy
  if (quizTimer) {
    clearInterval(quizTimer);
    quizTimer = null;
  }

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
// === Tìm kiếm với tối ưu hiệu suất & tự động hỗ trợ ký tự '%' ===
let searchTimer;
function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchQuestions, 400);
}

function matchWithWildcard(text, pattern) {
  // Nếu không có %, dùng includes() cho nhanh
  if (!pattern.includes("%")) return text.includes(pattern);

  // Có %, chia nhỏ và kiểm tra theo thứ tự
  const parts = pattern.split("%").filter((p) => p);
  let pos = 0;
  for (const part of parts) {
    const idx = text.indexOf(part, pos);
    if (idx === -1) return false;
    pos = idx + part.length;
  }
  return true;
}

// ======================================================
// 🧩 TẢI TOÀN BỘ CÂU HỎI TỪ CÁC BỘ ĐỀ (CHO CHỨC NĂNG TÌM KIẾM)
// ======================================================
// ======================================================
// 🧩 TẢI TOÀN BỘ CÂU HỎI TỪ THƯ VIỆN GỘP TRÙNG (questions.json)
// ======================================================

// ======================================================
// 🧩 TẢI TOÀN BỘ CÂU HỎI TỪ THƯ VIỆN (questions.json)
// ======================================================
async function loadAllQuestions() {
  try {
    const includeAllSources =
      document.getElementById("includeAllSources")?.checked ?? false;
    if (!includeAllSources) {
      return questionData;
    }
    const res = await fetch("../data/questions.json");
    if (!res.ok) throw new Error("Không tải được file questions.json");

    const json = await res.json();

    // 🔹 Tự động nhận dạng kiểu dữ liệu
    const allQuestions = Array.isArray(json) ? json : json.questions || [];

    if (!Array.isArray(allQuestions) || allQuestions.length === 0) {
      throw new Error("File questions.json không chứa dữ liệu hợp lệ.");
    }

    console.log(
      `📚 Đã tải ${allQuestions.length} câu hỏi từ thư viện tổng hợp.`
    );

    // 🔹 Chuẩn hoá định dạng
    return allQuestions.map((q) => ({
      field: q.Field || q.field || "",
      text: q.Text || q.text || "",
      options: q.Options || q.options || [],
      correct: q.Correct || q.correct || "",
      citation: q.Citation || q.citation || "",
      sources: q.Sources || q.sources || q.Library || "Thư viện tổng hợp",
    }));
  } catch (err) {
    console.error("⚠️ Lỗi khi tải thư viện câu hỏi:", err);
    alert("Không thể tải thư viện câu hỏi tổng hợp (questions.json)!");
    return [];
  }
}

function searchQuestions() {
  const inputRaw = normalizeVietnameseText(
    document.getElementById("searchInput").value.trim()
  );
  const input = inputRaw.toLowerCase();
  const container = document.getElementById("searchResults");

  if (!input) {
    container.innerHTML = "";
    return;
  }

  const MAX_RESULTS = 100;
  const startTime = performance.now();

  // 1️⃣ Lọc dữ liệu: tự động dùng matchWithWildcard nếu có ký tự %
  const includeAnswers =
    document.getElementById("includeAnswers")?.checked ?? false;
  const includeAllSources =
    document.getElementById("includeAllSources")?.checked ?? false;
  const results = (includeAllSources ? cachedAllQuestions : questionData)
    .map((q, i) => ({ ...q, stt: i + 1 }))

    .filter((q) => {
      const text = q.text.toLowerCase();
      if (input.includes("%")) {
        if (includeAnswers) {
          return (
            matchWithWildcard(text, input) ||
            q.options.some((opt) => matchWithWildcard(opt.toLowerCase(), input))
          );
        } else {
          return matchWithWildcard(text, input);
        }
      } else {
        if (includeAnswers) {
          return (
            text.includes(input) ||
            q.options.some((opt) => opt.toLowerCase().includes(input))
          );
        } else {
          return text.includes(input);
        }
      }
    });

  if (results.length === 0) {
    container.innerHTML = `<div class="alert alert-soft">Không tìm thấy câu hỏi phù hợp.</div>`;
    return;
  }

  // 2️⃣ Loại bỏ trùng lặp (theo q.text)
  const mergedMap = new Map();
  for (const q of results) {
    const key = q.text.trim().toLowerCase();
    if (!mergedMap.has(key)) {
      mergedMap.set(key, {
        ...q,
        fields: new Set([q.field || q.Field || "—"]),
      });
    } else {
      mergedMap.get(key).fields.add(q.field || q.Field || "—");
    }
  }
  const uniqueResults = Array.from(mergedMap.values());
  const shownResults = uniqueResults.slice(0, MAX_RESULTS);

  // 3️⃣ Render kết quả
  let html = `
    <div class="card">
      <div class="card-body">
        <div class="table-responsive">
          <table class="table table-dark table-bordered">
            <thead>
              <tr>
                <th style="width:70%">Câu hỏi</th>
                <th>Đáp án</th>
              </tr>
            </thead>
            <tbody>
  `;

  shownResults.forEach((q) => {
    const correctIdx = (q.correct ?? 0) - 1;
    const answers =
      correctIdx >= 0 && correctIdx < q.options.length
        ? `<div class="text-info">${htmlesc(q.options[correctIdx])}</div>`
        : "";
    const fieldsText = Array.from(q.fields).join("; ");
    const sourcesText =
      q.sources && Array.from(q.sources).length
        ? Array.from(q.sources).join("; ")
        : "Bộ đề hiện tại";
    html += `
      <tr>
        <td>
          <div>${htmlesc(q.text)}</div>
          <div class="text-muted small"><i>📘 ${fieldsText} (${sourcesText})</i></div>
        </td>
        <td>${answers}</td>
      </tr>
    `;
  });

  html += `
            </tbody>
          </table>
        </div>
        <div class="text-muted small mt-2">
          Hiển thị ${shownResults.length}/${uniqueResults.length} kết quả —
          <i>${(performance.now() - startTime).toFixed(1)}ms</i>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;

  // 🔹 Cuộn về đầu nếu người dùng vừa xem kết quả dài trước đó
  window.scrollTo({ top: 0, behavior: "smooth" });
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

function goToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
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
  const examTime = localStorage.getItem("examTime");
  if (examTime) {
    document.getElementById("examTime").value = examTime;
  }

  // Đảm bảo spinner hiện, content ẩn
  spinner.style.display = "flex";
  appContent.style.display = "none";

  try {
    // 👉 BẮT ĐẦU TÁC VỤ NẶNG — đây là lúc spinner hoạt động!
    await loadQuizList();

    await loadQuestionsFromJSON(currentQuizSource); // <-- fetch JSON, có thể mất 1–5s
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
    // Nếu phần tử được click/chạm là checkbox hoặc label của checkbox, HÃY BỎ QUA
    if (
      e.target.classList.contains("form-check-input") ||
      e.target.classList.contains("form-check-label")
    ) {
      return;
    }
    // Chỉ chạy khi tab đang hiển thị
    if (tab.style.display === "none") return;

    // Nếu bấm trực tiếp lên input, vẫn giữ nguyên hành vi — nhưng ngăn cuộn
    selectSearchNoScroll();
  };

  // Lắng nghe click & touch (mobile)
  tab.addEventListener("click", handler);
  tab.addEventListener("touchstart", handler, { passive: true });
})();
/* ====== [BỔ SUNG] Phím tắt mũi tên trái/phải để chuyển câu ====== */
document.addEventListener("keydown", function (event) {
  if (!isQuizStarted) return;
  const tag = event.target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") return;

  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    goPrev();
  }

  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    goNext();
  }

  // ✅ Thêm: dùng phím Space để Next
  if (event.code === "Space") {
    event.preventDefault(); // tránh cuộn trang
    goNext();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
    showHelp();
    // ... Thực hiện hành động tuỳ ý ở đây ...
  }
});
document
  .getElementById("includeAllSources")
  ?.addEventListener("change", async () => {
    // Lưu trạng thái
    if (event.target.checked && cachedAllQuestions === null) {
      cachedAllQuestions = await loadAllQuestions();
      document.getElementById(
        "searchResults"
      ).innerHTML = `<div class='text-center text-success'>✅ Đã tải ${cachedAllQuestions.length} câu hỏi hợp nhất. Nhập từ khóa để tìm kiếm!</div>`;
    }
  });
