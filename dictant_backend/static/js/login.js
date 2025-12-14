// login.js — логика экрана входа

function initLoginScreen() {
  const app = window.DictantApp;
  const {
    API_BASE,
    ADMIN_PASSWORD,
    state,
    DEFAULT_SETTINGS,
    INDICATION_SETS,
    generateGeneral,
  } = app;

  // Переключатель роли
  const buttons = document.querySelectorAll(".role-button");
  const studentForm = document.getElementById("studentLoginForm");
  const adminForm = document.getElementById("adminLoginForm");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const role = btn.dataset.role;
      if (role === "student") {
        studentForm.classList.remove("hidden");
        adminForm.classList.add("hidden");
      } else {
        studentForm.classList.add("hidden");
        adminForm.classList.remove("hidden");
      }
    });
  });

  // Элементы студента
  const nameInput = document.getElementById("studentName");
  const groupInput = document.getElementById("studentGroup");
  const codeInput = document.getElementById("studentAccessCode");
  const startBtn = document.getElementById("startButton");
  const studentError = document.getElementById("studentError");

  // Элементы админа
  const adminError = document.getElementById("adminLoginError");

  // --- ВАЛИДАЦИЯ ПОЛЕЙ СТУДЕНТА ---

  function validateName() {
    const value = nameInput.value.trim();
    const parts = value.split(/\s+/);

    if (value.length < 5 || parts.length < 2) {
      nameInput.classList.add("invalid");
      return "Введите полное ФИО";
    }

    nameInput.classList.remove("invalid");
    return "";
  }

  function validateGroup() {
    const value = groupInput.value.trim();
    if (value.length === 0) {
      groupInput.classList.add("invalid");
      return "Укажите направление подготовки (психиатр / невролог)";
    }

    groupInput.classList.remove("invalid");
    return "";
  }

  function validateCode() {
    const value = codeInput.value.trim();
    if (value.length < 3) {
      codeInput.classList.add("invalid");
      return "Код должен содержать минимум 3 символа";
    }

    codeInput.classList.remove("invalid");
    return "";
  }

  function fullValidate() {
    const errs = [];

    const n = validateName();
    if (n) errs.push(n);

    const g = validateGroup();
    if (g) errs.push(g);

    const c = validateCode();
    if (c) errs.push(c);

    if (errs.length > 0) {
      studentError.textContent = errs[0];
      startBtn.disabled = true;
    } else {
      studentError.textContent = "";
      startBtn.disabled = false;
    }
  }

  nameInput.addEventListener("input", fullValidate);
  groupInput.addEventListener("input", fullValidate);
  codeInput.addEventListener("input", fullValidate);

  // Стартовое состояние
  fullValidate();

  // --- ЛОГИН ОРДИНАТОРА ---

  studentForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    // сначала проверяем валидацию
    fullValidate();
    if (startBtn.disabled) {
      return;
    }

    studentError.textContent = "";

    const name = nameInput.value.trim();
    const group = groupInput.value.trim();
    const code = codeInput.value.trim();

    try {
      const resp = await fetch(`${API_BASE}/sessions/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, studentName: name, group }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        const msg = errData.error || "Ошибка подключения";
        studentError.textContent = msg;
        return;
      }

      const data = await resp.json();

      // Обновляем настройки под конкретную сессию
      const currentSettings = state.currentSettings || { ...DEFAULT_SETTINGS };

      currentSettings.drugs = Array.isArray(data.drugs)
        ? data.drugs.slice(0, 10)
        : DEFAULT_SETTINGS.drugs.slice();

      while (currentSettings.drugs.length < 10) {
        currentSettings.drugs.push(
          "Препарат " + (currentSettings.drugs.length + 1)
        );
      }

      currentSettings.testDurationMinutes =
        Number.isInteger(data.duration) && data.duration > 0
          ? data.duration
          : DEFAULT_SETTINGS.testDurationMinutes;

      currentSettings.accessCode = code;
      currentSettings.sessionName =
        data.sessionName || DEFAULT_SETTINGS.sessionName;
      currentSettings.indicationKey =
        data.indicationKey || DEFAULT_SETTINGS.indicationKey;

      if (data.indicationSets) {
        app.INDICATION_SETS = { ...INDICATION_SETS, ...data.indicationSets };
        generateGeneral();
        currentSettings.indicationSets = data.indicationSets;
      }

      state.currentSettings = currentSettings;
      state.currentStudent = { name, group };

      // Переход на экран диктанта
      app.loadExamScreen();
    } catch (err) {
      console.error(err);
      studentError.textContent = "Ошибка подключения к серверу";
    }
  });

  // --- ЛОГИН АДМИНИСТРАТОРА ---

  adminForm.addEventListener("submit", (e) => {
    e.preventDefault();
    adminError.textContent = "";
    const password = document.getElementById("adminPassword").value;
    if (password !== ADMIN_PASSWORD) {
      adminError.textContent = "Неверный пароль администратора.";
      return;
    }
    try {
      localStorage.setItem("dictantAdminLoggedIn", "1");
    } catch (e2) {
      console.warn("localStorage unavailable", e2);
    }
    app.loadAdminScreen();
  });
}
