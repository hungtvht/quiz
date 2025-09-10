// ================== DỮ LIỆU CÂU HỎI (hardcode) ==================

// ================== BIẾN TOÀN CỤC ==================
let questionsByField = {};
let selectedQuestions = [];
let mode = "practice"; // "practice" | "exam"
let currentIndex = 0;
let userAnswers = {}; // { questionIndex: answerIndex(1..4) }
let isQuizStarted = false;

let questionData = [];

// 2. Hàm fetch + parse XML
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
// ================== KHỞI TẠO LĨNH VỰC ==================
function populateFields() {
  const fieldInputs = document.getElementById("fieldInputs");
  fieldInputs.innerHTML = "";
  questionsByField = {};

  questionData.forEach((q, i) => {
    if (!questionsByField[q.field]) questionsByField[q.field] = [];
    questionsByField[q.field].push({ ...q, stt: i + 1 });
  });

  Object.keys(questionsByField).forEach((field) => {
    const max = questionsByField[field].length;
    const col = document.createElement("div");
    col.className = "col-12 col-md-6 col-lg-4";
    col.innerHTML = `
      <div class="p-3 rounded" style="background: #2a2a2a;border:1px solid #2a2f3a;">
        <div class="d-flex justify-content-between align-items-center mb-2 text-white">
          <strong>${field}</strong>
          <span class="badge-soft">${max} câu</span>
        </div>
        <label class="form-label muted">Số câu chọn</label>
        <input type="number" min="0" max="${max}" value="${Math.min(5, max)}"
               class="form-control bg-dark text-light border-secondary" data-field="${field}">
      </div>
    `;
    fieldInputs.appendChild(col);
  });
}

// ================== CHUYỂN TAB ==================
function switchTab(tab) {
  document.getElementById("homeTab").style.display =
    tab === "home" ? "block" : "none";
  document.getElementById("searchTab").style.display =
    tab === "search" ? "block" : "none";
  document
    .querySelectorAll("#mainTabs .nav-link")
    .forEach((l) => l.classList.remove("active"));
  document
    .querySelector(`#mainTabs .nav-link[onclick*="${tab}"]`)
    .classList.add("active");
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
  }

  if (selectedQuestions.length === 0) {
    alert("Vui lòng chọn ít nhất một câu hỏi.");
    return;
  }

  isQuizStarted = true;
  document.getElementById("configSection").style.display = "none";
  document.getElementById("navBar").style.display = "flex";
  renderQuestion();
}

// ================== HIỂN THỊ CÂU HỎI ==================
function renderQuestion() {
  const container = document.getElementById("quizContainer");
  container.innerHTML = "";

  const q = selectedQuestions[currentIndex];
  const card = document.createElement("div");
  card.className = "card mb-3";

  const body = document.createElement("div");
  body.className = "card-body";

  const head = document.createElement("div");
  head.className = "d-flex justify-content-between align-items-center mb-2";
  head.innerHTML = `
    <div class="badge-soft">Câu ${currentIndex + 1} / ${
    selectedQuestions.length
  }</div>
    <div class="muted">${q.field}</div>
  `;
  body.appendChild(head);

  const title = document.createElement("h5");
  title.className = "mb-2 text-white";
  title.textContent = q.text;
  body.appendChild(title);

  q.options.forEach((opt, idx) => {
    const btn = document.createElement("div");
    btn.className = "answer-option appear mt-2";
    btn.style.animationDelay = `${idx * 40}ms`;
    btn.textContent = `${String.fromCharCode(65 + idx)}. ${opt}`;

    if (userAnswers[currentIndex] === idx + 1) btn.classList.add("selected");

    btn.onclick = () => {
      userAnswers[currentIndex] = idx + 1;
      // Re-render to apply selected state & feedback (practice)
      renderQuestion();
    };

    body.appendChild(btn);
  });

  // Phản hồi động trong thi thử
  if (mode === "practice" && userAnswers[currentIndex]) {
    const isCorrect = userAnswers[currentIndex] === q.correct;
    const fb = document.createElement("div");
    fb.className = `alert mt-3 ${isCorrect ? "alert-success" : "alert-danger"}`;
    fb.innerHTML = isCorrect
      ? `✔️ Chính xác! Trích dẫn: ${q.citation}`
      : `✖️ Sai rồi! Trích dẫn: ${q.citation}`;
    body.appendChild(fb);
  }

  card.appendChild(body);
  container.appendChild(card);
}

// ================== ĐIỀU HƯỚNG ==================
function goPrev() {
  //  if (!userAnswers[currentIndex]) {
  //  alert("⚠️ Mời bạn chọn phương án trước khi chuyển câu.");
  //return;
  //}
  if (currentIndex > 0) {
    currentIndex--;
    renderQuestion();
  }
}

function goNext() {
  //if (!userAnswers[currentIndex]) {
  // alert("⚠️ Mời bạn chọn phương án trước khi chuyển câu.");
  //return;
  //}
  if (currentIndex < selectedQuestions.length - 1) {
    currentIndex++;
    renderQuestion();
  }
}

// ================== NỘP BÀI & THOÁT ==================
function submitQuiz() {
  if (!isQuizStarted) return;
  let score = 0;
  const per = 100 / selectedQuestions.length;
  selectedQuestions.forEach((q, i) => {
    if (userAnswers[i] === q.correct) score += per;
  });
  alert(`🎯 Điểm của bạn: ${Math.round(score)} / 100`);
}

function confirmExit() {
  if (isQuizStarted) {
    if (confirm("Bạn có muốn nộp bài và quay về trang chủ không?")) {
      submitQuiz();
      resetToHome();
    }
  } else {
    resetToHome();
  }
}

function resetToHome() {
  // Reset state
  selectedQuestions = [];
  userAnswers = {};
  currentIndex = 0;
  isQuizStarted = false;

  // Show config, hide navbar, clear quiz
  document.getElementById("configSection").style.display = "block";
  document
    .getElementById("navBar")
    .style.setProperty("display", "none", "important");
  document.getElementById("quizContainer").innerHTML = "";
  // Switch tab to home if needed
  switchTab("home");
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
                <th>STT</th>
                <th>Lĩnh vực</th>
                <th>Câu hỏi</th>
                <th>Đáp án</th>
                <th>Trích dẫn</th>
              </tr>
            </thead>
            <tbody>
  `;

  results.forEach((q) => {
    const answers = q.options
      .map((opt, idx) => {
        const label = String.fromCharCode(65 + idx);
        const isCorrect = idx + 1 === q.correct;
        return `<div class="${
          isCorrect ? "highlight" : ""
        }">${label}. ${opt}</div>`;
      })
      .join("");

    html += `
      <tr>
        <td>${q.stt}</td>
        <td>${q.field}</td>
        <td>${q.text}</td>
        <td>${answers}</td>
        <td>${q.citation || ""}</td>
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

// ================== TIỆN ÍCH ==================
function shuffle(array) {
  if (!Array.isArray(array)) return [];
  return [...array].sort(() => Math.random() - 0.5);
}

// ================== BOOTSTRAP ==================
window.onload = async () => {
  await loadQuestionsFromXML();
  populateFields();
  // Ẩn thanh điều hướng lúc đầu
  document
    .getElementById("navBar")
    .style.setProperty("display", "none", "important");
};
