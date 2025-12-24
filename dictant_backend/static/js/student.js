// student.js — логика экрана ординатора (диктант)
// v3: formDosages UI + no auto-select dictated kind + answers saved with drug_id keys

function initStudentScreen() {
  const app = window.DictantApp;
  const { API_BASE, state, INDICATION_SETS } = app;

  let examStarted = false;
  let examStartTime = null;
  let timerIntervalId = null;

  let inactivitySeconds = 0;
  let inactivityWarnings = 0;
  let visibilityWarnings = 0;
  const MAX_WARNINGS = 3;
  let inactivityIntervalId = null;
  const antiCheatListeners = [];

  if (!state.currentSettings || !state.currentStudent) {
    app.loadLoginScreen();
    return;
  }

  // ===== дозировки: 2 списка + "обманки" =====
  // Эти строки должны совпадать по смыслу с тем, как они лежат в мастер-таблице (form_tabs/form_ampoules и т.д.)
  // В scoring.py нормализация уже есть, поэтому "25 mg – 2 ml" и "25 mg-2 ml" обычно матчится.
  const SOLID_DOSAGE_OPTIONS = [
    "0.5",
    "1",
    "1.5",
    "2",
    "3",
    "4",
    "5",
    "6",
    "8",
    "9",
    "10",
    "12",
    "12.5",
    "15",
    "16",
    "20",
    "25",
    "30",
    "37.5",
    "40",
    "45",
    "50",
    "60",
    "75",
    "80",
    "100",
    "150",
    "200",
    "250",
    "300",
    "400",
    "500",
    "750",
    "1000"
  ];

  const LIQUID_DOSAGE_OPTIONS = [
    "1 mg – 1 ml",
    "2 mg – 1 ml",
    "4 mg – 1 ml",
    "5 mg – 1 ml",
    "10 mg – 1 ml",
    "25 mg – 1 ml",
    "25 mg – 2 ml",
    "25 mg – 5 ml",
    "50 mg – 1 ml",
    "50 mg – 2 ml",
    "100 mg – 1 ml",
    "100 mg – 2 ml",
    "200 mg – 1 ml",

    "1 mg – 1 ml (30 ml)",
    "1 mg – 1 ml (150 ml)",
    "2 mg – 1 ml (30 ml)",
    "100 mg – 1 ml (60 ml)",

    "1 кап. – 1 mg",
    "1 mg – 10 кап.",

    "4% – 125 ml"
  ];

  const FAKE_DOSAGE_OPTIONS = [
    // псевдо-проценты, похожие на растворы
    "0.2%",
    "0.25%",
    "0.75%",
    "1.25%",
    "2.5%",

    // псевдо «mg/ml», которые выглядят почти правильно
    "2.5 mg – 1 ml",
    "7.5 mg – 1 ml",
    "12.5 mg – 1 ml",
    "15 mg – 1 ml",
    "37.5 mg – 1 ml",

    // псевдо «таблеточные», но в жидком виде
    "75 mg – 1 ml",
    "150 mg – 1 ml",

    // псевдо-капельные форматы
    "1 mg – 5 кап.",
    "5 mg – 1 кап.",

    // формат, путающийся с объёмами флаконов
    "10 mg – 5 ml",
    "25 mg – 10 ml"
  ];

  const SOLID_FORMS = new Set(["tablets", "capsules", "powder", "dragee"]);
  const LIQUID_FORMS = new Set(["ampoules", "drops"]);
  const FAKE_FORMS = new Set(["ointment", "gel", "spray", "patch"]);

  const FORM_LABELS = {
    tablets: "таблетки",
    capsules: "капсулы",
    powder: "порошок (суспензия)",
    dragee: "драже",
    ampoules: "ампулы",
    drops: "флакон (капли)",
    ointment: "мазь",
    gel: "гель",
    spray: "спрей / аэрозоль",
    patch: "трансдермальный пластырь",
  };

  function getTicket() {
    return Array.isArray(state.currentSettings.ticket) ? state.currentSettings.ticket : [];
  }

  function startExamForStudent() {
    examStarted = true;
    inactivitySeconds = 0;
    inactivityWarnings = 0;
    visibilityWarnings = 0;

    examStartTime = Date.now();

    const infoEl = document.getElementById("studentInfo");
    infoEl.textContent = `${state.currentStudent.name} (${state.currentStudent.group})`;

    renderDrugBlocks();
    renderDrugTabs();
    startTimer();
    setupAntiCheat();
    setupExamSubmission();
    updateWarningsSummary();
  }

  function renderDrugBlocks() {
    const container = document.getElementById("drugBlocks");
    container.innerHTML = "";
    const template = document.getElementById("drugTemplate");

    const ticket = getTicket();

    ticket.forEach((item, index) => {
      const clone = template.content.cloneNode(true);
      const block = clone.querySelector(".drug-block");

      block.dataset.drugIndex = String(index);
      block.dataset.drugId = String(item.drug_id || "");

      block.classList.add("hidden");
      if (index === 0) block.classList.remove("hidden");

      const titleEl = block.querySelector("h2");
      if (titleEl) titleEl.textContent = `Препарат ${index + 1}`;

      block.querySelector(".dictated-name-text").textContent = item.dictated_ru || "";

      // IMPORTANT: НЕ автозаполняем dictated type — ординатор выбирает сам
      const radioContainer = block.querySelector('[data-role="dictated-type"]');
      if (radioContainer) {
        const radios = radioContainer.querySelectorAll("input[type=radio]");
        radios.forEach((r) => {
          r.name = `drug${index}_dictatedType`;
          r.checked = false;
        });
      }

      fillIndicationsList(block);

      // дозы (суточные) — как было
      const doseBlocks = block.querySelectorAll('[data-role="dose-block"]');
      doseBlocks.forEach((doseBlock) => {
        const toggleBtn = doseBlock.querySelector('[data-role="dose-extra-toggle"]');
        const panel = doseBlock.querySelector('[data-role="dose-extra-panel"]');
        if (toggleBtn && panel) {
          toggleBtn.addEventListener("click", () => panel.classList.toggle("hidden"));
        }
        const extraItems = doseBlock.querySelectorAll(".dose-extra-item");
        extraItems.forEach((item) => {
          const checkbox = item.querySelector('input[type="checkbox"][data-role="dose-extra-checkbox"]');
          const numberInput = item.querySelector('input[type="number"]');
          if (checkbox && numberInput) {
            numberInput.classList.add("hidden");
            checkbox.addEventListener("change", () => {
              if (checkbox.checked) numberInput.classList.remove("hidden");
              else {
                numberInput.value = "";
                numberInput.classList.add("hidden");
              }
            });
          }
        });
      });

      // ===== NEW: дозировки форм выпуска =====
      const formsRoot = block.querySelector('[data-role="forms"]');
      if (formsRoot) {
        const formCbs = formsRoot.querySelectorAll('input[type="checkbox"]');
        formCbs.forEach((cb) => cb.addEventListener("change", () => updateFormDosagePanels(block)));
      }
      // первичная отрисовка (если что-то уже отмечено)
      updateFormDosagePanels(block);

      container.appendChild(clone);
    });
  }

  function fillIndicationsList(block) {
    const key =
      state.currentSettings.indicationKey in INDICATION_SETS
        ? state.currentSettings.indicationKey
        : "general";
    const indications = INDICATION_SETS[key] || [];
    const container = block.querySelector('[data-role="indications"]');
    if (!container) return;
    container.innerHTML = "";
    indications.forEach((ind) => {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = ind;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + ind));
      container.appendChild(label);
    });
  }

  function renderDrugTabs() {
    const ticket = getTicket();
    const tabsContainer = document.getElementById("drugTabs");
    tabsContainer.innerHTML = "";
    ticket.forEach((_, index) => {
      const btn = document.createElement("button");
      btn.classList.add("drug-tab");
      if (index === 0) btn.classList.add("active");
      btn.textContent = index + 1;
      btn.addEventListener("click", () => {
        document.querySelectorAll(".drug-tab").forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".drug-block").forEach((block) => block.classList.add("hidden"));
        const current = document.querySelector(`.drug-block[data-drug-index="${index}"]`);
        if (current) current.classList.remove("hidden");
      });
      tabsContainer.appendChild(btn);
    });
  }

  function startTimer() {
    const display = document.getElementById("timerDisplay");

    const minutes =
      Number(state.currentSettings.testDurationMinutes) ||
      Number(state.currentSettings.duration) ||
      0;

    const totalSeconds = minutes * 60;

    function update() {
      if (!display) return;

      const elapsed = Math.floor((Date.now() - examStartTime) / 1000);
      const remaining = Math.max(0, totalSeconds - elapsed);

      const mm = Math.floor(remaining / 60).toString().padStart(2, "0");
      const ss = (remaining % 60).toString().padStart(2, "0");
      display.textContent = `${mm}:${ss}`;

      if (totalSeconds > 0 && remaining <= 0) submitExam(true);
    }

    update();
    timerIntervalId = setInterval(update, 1000);
  }

  function setupAntiCheat() {
    if (inactivityIntervalId) clearInterval(inactivityIntervalId);
    inactivitySeconds = 0;

    const resetInactivity = () => {
      inactivitySeconds = 0;
    };

    ["mousemove", "keydown", "scroll", "click", "touchstart"].forEach((evt) => {
      document.addEventListener(evt, resetInactivity);
      antiCheatListeners.push({ target: document, event: evt, handler: resetInactivity });
    });

    inactivityIntervalId = setInterval(() => {
      inactivitySeconds++;
      if (inactivitySeconds >= 15) {
        handleViolation("inactivity");
        inactivitySeconds = 0;
      }
    }, 1000);

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") handleViolation("visibility");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    antiCheatListeners.push({ target: document, event: "visibilitychange", handler: handleVisibility });

    const onBlur = () => handleViolation("visibility");
    window.addEventListener("blur", onBlur);
    antiCheatListeners.push({ target: window, event: "blur", handler: onBlur });
  }

  function handleViolation(type) {
    if (type === "inactivity") inactivityWarnings++;
    else visibilityWarnings++;
    updateWarningsSummary();
    showWarningModal();
    if (inactivityWarnings + visibilityWarnings >= MAX_WARNINGS) submitExam(true);
  }

  function updateWarningsSummary() {
    const sumEl = document.getElementById("warningsSummary");
    if (!sumEl) return;
    const total = inactivityWarnings + visibilityWarnings;
    sumEl.textContent = `Предупреждения: ${total} (бездействие ${inactivityWarnings}, вкладки ${visibilityWarnings})`;
  }

  function showWarningModal() {
    const modal = document.getElementById("warningModal");
    if (!modal) return;
    const counters = document.getElementById("warningCountersText");
    if (counters) counters.textContent = `У вас уже ${inactivityWarnings + visibilityWarnings} предупреждений`;
    modal.classList.remove("hidden");
    const confirmBtn = document.getElementById("warningConfirmBtn");
    const hide = () => {
      modal.classList.add("hidden");
      confirmBtn.removeEventListener("click", hide);
    };
    confirmBtn.addEventListener("click", hide);
  }

  function setupExamSubmission() {
    const manualBtn = document.getElementById("manualSubmitBtn");
    if (!manualBtn) return;
    manualBtn.addEventListener("click", () => showSubmitConfirmModal());
  }

  function showSubmitConfirmModal() {
    const modal = document.getElementById("submitConfirmModal");
    if (!modal) return;
    modal.classList.remove("hidden");
    const yesBtn = document.getElementById("submitConfirmYes");
    const noBtn = document.getElementById("submitConfirmNo");
    const hide = () => {
      modal.classList.add("hidden");
      yesBtn.removeEventListener("click", onConfirm);
      noBtn.removeEventListener("click", hide);
    };
    const onConfirm = () => {
      hide();
      submitExam(false);
    };
    yesBtn.addEventListener("click", onConfirm);
    noBtn.addEventListener("click", hide);
  }

  function showSubmitCompleteModal(auto) {
    const modal = document.getElementById("submitCompleteModal");
    const titleEl = document.getElementById("submitCompleteTitle");
    const textEl = document.getElementById("submitCompleteText");
    if (!modal || !titleEl || !textEl) return;
    if (auto) {
      titleEl.textContent = "Диктант завершён автоматически";
      textEl.textContent = "Время вышло или превышено количество предупреждений. Ваши ответы отправлены.";
    } else {
      titleEl.textContent = "Диктант завершён";
      textEl.textContent = "Ваши ответы отправлены. Спасибо!";
    }
    modal.classList.remove("hidden");
    const closeBtn = document.getElementById("submitCompleteCloseBtn");
    const hide = () => {
      modal.classList.add("hidden");
      closeBtn.removeEventListener("click", hide);
      app.loadLoginScreen();
    };
    closeBtn.addEventListener("click", hide);
  }

  async function submitExam(auto) {
    if (!examStarted) return;
    examStarted = false;

    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
    if (inactivityIntervalId) {
      clearInterval(inactivityIntervalId);
      inactivityIntervalId = null;
    }

    antiCheatListeners.forEach(({ target, event, handler }) => target.removeEventListener(event, handler));
    antiCheatListeners.length = 0;

    const answers = collectAnswers();

    const warningsList = [];
    for (let i = 0; i < inactivityWarnings; i++) warningsList.push({ type: "inactivity" });
    for (let j = 0; j < visibilityWarnings; j++) warningsList.push({ type: "visibility" });

    const payload = {
      sessionName: state.currentSettings.sessionName,
      examSessionId: window.examSessionId,
      studentName: state.currentStudent.name,
      group: state.currentStudent.group,
      startTime: new Date(examStartTime).toISOString(),
      endTime: new Date().toISOString(),
      warnings: warningsList,
      answers: answers,
      autoSubmitted: auto,
    };


    try {
      const resp = await fetch(`${API_BASE}/sessions/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) console.error("Ошибка отправки данных", resp.status);
    } catch (err) {
      console.error("Ошибка отправки данных", err);
    }

    if (typeof window.DictantAppRenderHistory === "function") {
      window.DictantAppRenderHistory();
    }

    updateWarningsSummary();
    showSubmitCompleteModal(auto);
    state.currentStudent = null;
  }

  // ===== NEW: UI панелей дозировок =====
  function updateFormDosagePanels(block) {
    const group = block.querySelector('[data-role="form-dosages-group"]');
    const panelsRoot = block.querySelector('[data-role="form-dosage-panels"]');
    const formsRoot = block.querySelector('[data-role="forms"]');
    if (!group || !panelsRoot || !formsRoot) return;

    const selectedForms = Array.from(formsRoot.querySelectorAll('input[type="checkbox"]:checked'))
      .map((cb) => cb.value);

    // если ничего не выбрано — прячем
    if (!selectedForms.length) {
      group.classList.add("hidden");
      panelsRoot.innerHTML = "";
      return;
    }

    group.classList.remove("hidden");

    // запоминаем текущие выборы, чтобы при переразметке не терять
    const prev = {};
    panelsRoot.querySelectorAll('[data-form-key]').forEach((panel) => {
      const key = panel.getAttribute("data-form-key");
      if (!key) return;
      prev[key] = Array.from(panel.querySelectorAll('input[type="checkbox"]:checked')).map((x) => x.value);
    });

    panelsRoot.innerHTML = "";

    selectedForms.forEach((formKey) => {
      const label = FORM_LABELS[formKey] || formKey;

      let options = [];
      if (SOLID_FORMS.has(formKey)) options = SOLID_DOSAGE_OPTIONS;
      else if (LIQUID_FORMS.has(formKey)) options = LIQUID_DOSAGE_OPTIONS;
      else if (FAKE_FORMS.has(formKey)) options = FAKE_DOSAGE_OPTIONS;
      else options = FAKE_DOSAGE_OPTIONS;

      const panel = document.createElement("div");
      panel.className = "card";
      panel.setAttribute("data-form-key", formKey);

      const title = document.createElement("h4");
      title.textContent = `Дозировки: ${label}`;
      panel.appendChild(title);

      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = "Выберите все подходящие варианты.";
      panel.appendChild(hint);

      const grid = document.createElement("div");
      grid.className = "checkbox-grid";

      const prevChecked = new Set(prev[formKey] || []);
      options.forEach((opt) => {
        const lab = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = opt;
        if (prevChecked.has(opt)) cb.checked = true;
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(" " + opt));
        grid.appendChild(lab);
      });

      panel.appendChild(grid);
      panelsRoot.appendChild(panel);
    });
  }

  function collectAnswers() {
    const answers = {};
    document.querySelectorAll(".drug-block").forEach((block) => {
      const drugId = block.dataset.drugId;
      if (!drugId) return;

      const result = {};

      const typeRadio = block.querySelector('[data-role="dictated-type"] input:checked');
      if (typeRadio) result.dictatedType = typeRadio.value;

      result.mnn = (block.querySelector('[data-role="mnn"]')?.value || "").trim();
      result.tradeNames = (block.querySelector('[data-role="trade-names"]')?.value || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      result.forms = Array.from(block.querySelectorAll('[data-role="forms"] input:checked')).map((cb) => cb.value);
      result.indications = Array.from(block.querySelectorAll('[data-role="indications"] input:checked')).map((cb) => cb.value);

      // NEW: formDosages
      const fd = {};
      const panelsRoot = block.querySelector('[data-role="form-dosage-panels"]');
      if (panelsRoot) {
        panelsRoot.querySelectorAll('[data-form-key]').forEach((panel) => {
          const formKey = panel.getAttribute("data-form-key");
          if (!formKey) return;
          const vals = Array.from(panel.querySelectorAll('input[type="checkbox"]:checked'))
            .map((x) => x.value)
            .filter((s) => String(s).trim().length > 0);
          fd[formKey] = vals;
        });
      }
      result.formDosages = fd;

      const doses = {};
      block.querySelectorAll('[data-role="dose-block"]').forEach((doseBlock) => {
        const type = doseBlock.dataset.doseType;
        const mainValEl = doseBlock.querySelector('[data-role="dose-main-value"]');
        const mainVal = mainValEl && mainValEl.value ? parseInt(mainValEl.value, 10) : null;
        doses[type] = { main: mainVal, extras: {} };
        doseBlock.querySelectorAll(".dose-extra-item").forEach((item) => {
          const cb = item.querySelector('input[type="checkbox"][data-role="dose-extra-checkbox"]');
          const num = item.querySelector('input[type="number"]');
          if (cb && cb.checked) {
            const extraVal = num && num.value ? parseInt(num.value, 10) : null;
            doses[type].extras[cb.value] = extraVal;
          }
        });
      });
      result.doses = doses;

      const halfLifeEl = block.querySelector('[data-role="half-life"]');
      if (halfLifeEl) {
        const inputs = halfLifeEl.querySelectorAll('input[type="number"]');
        result.halfLife = {
          from: inputs[0]?.value ? parseInt(inputs[0].value, 10) : null,
          to: inputs[1]?.value ? parseInt(inputs[1].value, 10) : null,
        };
      }

      result.elimination = Array.from(block.querySelectorAll('[data-role="elimination"] input:checked')).map((cb) => cb.value);

      answers[drugId] = result;
    });
    return answers;
  }

  startExamForStudent();
}


