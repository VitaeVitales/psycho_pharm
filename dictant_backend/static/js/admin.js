// admin.js — логика экрана администратора
// FIX: upload endpoint => /admin/upload_master
// FIX: show backend errors/details for /admin/settings (400)
// FIX: do not auto-pad drugs with "Препарат N" (breaks RU resolution)

function initAdminScreen() {
  const app = window.DictantApp;
  const {
    API_BASE,
    state,
    DEFAULT_SETTINGS,
    INDICATION_SETS,
    generateGeneral,
    loadSettings,
    loadLoginScreen,
  } = app;

  const currentSettings = state.currentSettings || DEFAULT_SETTINGS;

  const drugsArea = document.getElementById("adminDrugs");
  const durationInput = document.getElementById("adminDuration");
  const codeInput = document.getElementById("adminAccessCode");
  const sessionInput = document.getElementById("adminSessionName");
  const indicationSelect = document.getElementById("adminIndicationKey");

  const saveBtn = document.getElementById("adminSaveBtn");
  const saveStatusEl = document.getElementById("adminSaveStatus");
  const saveErrorEl = document.getElementById("adminSaveError");

  const uploadBtn = document.getElementById("adminUploadIndicationsBtn");
  const indicationsFileInput = document.getElementById("adminIndicationsFile");
  const uploadStatus = document.getElementById("adminUploadStatus");

  const showIndicationSetsBtn = document.getElementById("adminShowIndicationSetsBtn");
  const indicationSetsBox = document.getElementById("adminIndicationSetsBox");

  const answerKeyInput = document.getElementById("adminAnswerKeyFile");
  const answerKeyBtn = document.getElementById("adminUploadAnswerKeyBtn");
  const answerKeyStatus = document.getElementById("adminAnswerKeyStatus");

  const exportBtn = document.getElementById("adminExportResultsBtn");
  const exportXlsxBtn = document.getElementById("adminExportResultsXlsxBtn");

  const backFromAdmin = document.getElementById("backToLoginFromAdmin");

  // --- Exam sessions + roster (NEW) ---
  const examSessionNameInput = document.getElementById("examSessionNameInput");
  const examSessionJoinCodeInput = document.getElementById("examSessionJoinCodeInput");
  const createExamSessionBtn = document.getElementById("createExamSessionBtn");
  const examSessionsStatus = document.getElementById("examSessionsStatus");
  const examSessionsList = document.getElementById("examSessionsList");

  const rosterNamesArea = document.getElementById("rosterNamesArea");
  const uploadRosterBtn = document.getElementById("uploadRosterBtn");
  const rosterUploadStatus = document.getElementById("rosterUploadStatus");

  let selectedExamSessionId = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setSaveError(message, details = []) {
    if (!saveErrorEl) return;
    if (!message) {
      saveErrorEl.classList.add("hidden");
      saveErrorEl.innerHTML = "";
      return;
    }
    let html = `<div><strong>${escapeHtml(message)}</strong></div>`;
    if (Array.isArray(details) && details.length > 0) {
      html += "<ul>";
      details.forEach((d) => {
        html += `<li>${escapeHtml(d)}</li>`;
      });
      html += "</ul>";
    }
    saveErrorEl.innerHTML = html;
    saveErrorEl.classList.remove("hidden");
  }

  function fillAdminSettings() {
    const s = state.currentSettings || currentSettings;

    // drugs — именно те строки, которые ввёл админ
    drugsArea.value = (s.drugs || DEFAULT_SETTINGS.drugs).join("\n");

    durationInput.value = s.testDurationMinutes;
    codeInput.value = s.accessCode;
    sessionInput.value = s.sessionName || "";
    indicationSelect.value = s.indicationKey || DEFAULT_SETTINGS.indicationKey;

    setSaveError("");
    renderHistory();
    renderExamSessions();
  }

  function renderIndicationSetsBox() {
    const sets = (state.currentSettings?.indicationSets) || (currentSettings?.indicationSets) || {};
    const keys = Object.keys(sets);

    if (!indicationSetsBox) return;

    if (!keys.length) {
      indicationSetsBox.textContent = "Наборы показаний не загружены.";
      indicationSetsBox.classList.remove("hidden");
      return;
    }

    let out = "Загруженные наборы показаний:\n\n";
    for (const k of keys) {
      const title = sets[k]?.title || k;
      const count = Array.isArray(sets[k]?.items) ? sets[k].items.length : 0;
      out += `• ${k} — ${title} (${count})\n`;
    }

    indicationSetsBox.textContent = out;
    indicationSetsBox.classList.remove("hidden");
  }

  if (showIndicationSetsBtn) {
    showIndicationSetsBtn.addEventListener("click", () => {
      // toggle
      if (indicationSetsBox && !indicationSetsBox.classList.contains("hidden")) {
        indicationSetsBox.classList.add("hidden");
        return;
      }
      renderIndicationSetsBox();
    });
  }


  backFromAdmin.addEventListener("click", () => {
    try {
      localStorage.removeItem("dictantAdminLoggedIn");
    } catch (e) {
      console.warn("localStorage unavailable", e);
    }
    loadLoginScreen();
  });

  // ---------------------------
  // Save settings
  // ---------------------------
  saveBtn.addEventListener("click", async () => {
    const drugsText = drugsArea.value;
    const duration = parseInt(durationInput.value, 10);
    const accessCode = codeInput.value.trim();
    const sessionName = sessionInput.value.trim();
    const indicationKey = indicationSelect.value;

    setSaveError("");
    if (saveStatusEl) saveStatusEl.textContent = "";

    let drugs = drugsText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (drugs.length === 0) {
      setSaveError("Введите список препаратов (1–10 строк).");
      return;
    }
    if (drugs.length > 10) drugs = drugs.slice(0, 10);

    const hasLatin = drugs.some((x) => /[A-Za-z]/.test(x));
    if (hasLatin) {
      setSaveError("Список препаратов должен быть только на русском (без латиницы).");
      return;
    }

    state.currentSettings = {
      ...(state.currentSettings || DEFAULT_SETTINGS),
      drugs,
      testDurationMinutes:
        !isNaN(duration) && duration > 0 ? duration : DEFAULT_SETTINGS.testDurationMinutes,
      accessCode: accessCode || DEFAULT_SETTINGS.accessCode,
      sessionName: sessionName.length > 0 ? sessionName : DEFAULT_SETTINGS.sessionName,
      indicationKey: indicationKey in INDICATION_SETS ? indicationKey : DEFAULT_SETTINGS.indicationKey,
    };

    try {
      const s = state.currentSettings;
      const payload = {
        drugs: s.drugs,
        duration: s.testDurationMinutes,
        code: s.accessCode,
        sessionName: s.sessionName,
        indicationKey: s.indicationKey,
        indicationSets: s.indicationSets || undefined,
      };

      const resp = await fetch(`${API_BASE}/admin/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        setSaveError(errData.error || "Ошибка сохранения настроек", errData.details || []);
        if (saveStatusEl) saveStatusEl.textContent = "Ошибка";
        setTimeout(() => {
          if (saveStatusEl) saveStatusEl.textContent = "";
        }, 2500);
        return;
      }

      if (saveStatusEl) saveStatusEl.textContent = "Сохранено";

      const settings = await loadSettings();
      state.currentSettings = settings;
      renderIndicationSets(settings.indicationSets || {});
      generateGeneral();
      renderHistory();
      fillAdminSettings();

      setTimeout(() => {
        if (saveStatusEl) saveStatusEl.textContent = "";
      }, 2000);
    } catch (e) {
      console.error(e);
      setSaveError("Ошибка подключения при сохранении настроек");
      if (saveStatusEl) saveStatusEl.textContent = "Ошибка";
      setTimeout(() => {
        if (saveStatusEl) saveStatusEl.textContent = "";
      }, 2500);
    }
  });

  // ---------------------------
  // Upload indications
  // ---------------------------
  if (uploadBtn) {
    uploadBtn.addEventListener("click", async () => {
      uploadStatus.textContent = "";
      const file = indicationsFileInput?.files?.[0];
      if (!file) {
        uploadStatus.textContent = "Выберите файл";
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      try {
        const resp = await fetch(`${API_BASE}/admin/upload_indication_sets`, {
          method: "POST",
          body: formData,
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          uploadStatus.textContent = errData.error || "Ошибка загрузки";
          return;
        }
        uploadStatus.textContent = "Файл загружен";
        state.currentSettings = await loadSettings();
        fillAdminSettings();
      } catch (err) {
        console.error(err);
        uploadStatus.textContent = "Ошибка подключения";
      }
      setTimeout(() => {
        uploadStatus.textContent = "";
      }, 2000);
    });
  }

  // ---------------------------
  // Upload master table
  // ---------------------------
  if (answerKeyBtn) {
    answerKeyBtn.addEventListener("click", async () => {
      setSaveError("");

      if (!answerKeyInput?.files?.[0]) {
        if (answerKeyStatus) answerKeyStatus.textContent = "Выберите файл";
        return;
      }

      const file = answerKeyInput.files[0];
      const formData = new FormData();
      formData.append("file", file);

      try {
        const resp = await fetch(`${API_BASE}/admin/upload_master`, {
          method: "POST",
          body: formData,
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          if (answerKeyStatus) answerKeyStatus.textContent = data.error || "Ошибка загрузки мастер-таблицы";
          setSaveError(data.error || "Ошибка загрузки мастер-таблицы");
          return;
        }

        if (answerKeyStatus) {
          const loaded = data.loaded ?? "?";
          const skipped = data.skipped ?? "?";
          answerKeyStatus.textContent = `Мастер-таблица загружена (loaded: ${loaded}, skipped: ${skipped})`;
        }

        state.currentSettings = await loadSettings();
        fillAdminSettings();
      } catch (e) {
        console.error(e);
        if (answerKeyStatus) answerKeyStatus.textContent = "Ошибка подключения";
        setSaveError("Ошибка подключения при загрузке мастер-таблицы");
      }

      setTimeout(() => {
        if (answerKeyStatus) answerKeyStatus.textContent = "";
      }, 4000);
    });
  }

  // ---------------------------
  // Export
  // ---------------------------
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      window.location.href = `${API_BASE}/admin/export`;
    });
  }
  if (exportXlsxBtn) {
    exportXlsxBtn.addEventListener("click", () => {
      window.location.href = `${API_BASE}/admin/export_excel`;
    });
  }

  // ---------------------------
  // History
  // ---------------------------
  async function renderHistory() {
    const container = document.getElementById("historyContent");
    if (!container) return;

    try {
      const resp = await fetch(`${API_BASE}/admin/sessions`);
      if (!resp.ok) throw new Error("Ошибка загрузки истории");
      const history = await resp.json();

      if (!history || history.length === 0) {
        container.innerHTML = '<p class="hint">История пустая.</p>';
        return;
      }

      let html =
        '<table class="history-table"><thead><tr><th>Название</th><th>ФИО</th><th>Группа</th><th>Начало</th><th>Окончание</th><th>Предупр.</th><th>Баллы</th><th>Отправка</th></tr></thead><tbody>';

      history.forEach((entry) => {
        const start = entry.startTime ? new Date(entry.startTime).toLocaleString("ru-RU") : "-";
        const end = entry.endTime ? new Date(entry.endTime).toLocaleString("ru-RU") : "-";
        const type = entry.autoSubmitted ? "Авто" : "Ручная";

        let inactivityCount = 0;
        let visibilityCount = 0;
        let totalWarnings = 0;

        if (Array.isArray(entry.warnings)) {
          entry.warnings.forEach((w) => {
            if (w.type === "inactivity") {
              inactivityCount++;
              totalWarnings++;
            } else if (w.type === "visibility") {
              visibilityCount++;
              totalWarnings++;
            }
          });
        }

        const warningsStr = `${totalWarnings} (безд. ${inactivityCount}, вкладки ${visibilityCount})`;
        const scoreCell =
          entry.score !== null && entry.score !== undefined ? Number(entry.score).toFixed(2) : "-";

        html += `<tr>
          <td>${escapeHtml(entry.sessionName || "")}</td>
          <td>${escapeHtml(entry.studentName || "")}</td>
          <td>${escapeHtml(entry.group || "")}</td>
          <td>${start}</td>
          <td>${end}</td>
          <td>${warningsStr}</td>
          <td>${scoreCell}</td>
          <td>${type}</td>
        </tr>`;
      });

      html += "</tbody></table>";
      container.innerHTML = html;
    } catch (err) {
      console.error(err);
      const c = document.getElementById("historyContent");
      if (c) c.innerHTML = '<p class="hint">Ошибка загрузки истории</p>';
    }
  }

  function setExamSessionsStatus(msg) {
    if (examSessionsStatus) examSessionsStatus.textContent = msg || "";
    if (msg) {
      setTimeout(() => {
        if (examSessionsStatus) examSessionsStatus.textContent = "";
      }, 2500);
    }
  }

  function setRosterStatus(msg) {
    if (rosterUploadStatus) rosterUploadStatus.textContent = msg || "";
    if (msg) {
      setTimeout(() => {
        if (rosterUploadStatus) rosterUploadStatus.textContent = "";
      }, 2500);
    }
  }

  async function renderExamSessions() {
    if (!examSessionsList) return;

    try {
      const resp = await fetch(`${API_BASE}/admin/exam_sessions`);
      if (!resp.ok) throw new Error("Ошибка загрузки списка сессий");
      const sessions = await resp.json();

      if (!sessions || sessions.length === 0) {
        examSessionsList.innerHTML = '<p class="hint">Сессий пока нет.</p>';
        selectedExamSessionId = null;
        return;
      }

      let html =
        '<table class="history-table"><thead><tr><th>Название</th><th>Код</th><th>Открыта</th><th>Создана</th><th></th></tr></thead><tbody>';

      sessions.forEach((s) => {
        const created = s.created_at ? new Date(s.created_at).toLocaleString("ru-RU") : "-";
        html += `<tr>
          <td>${escapeHtml(s.session_name || "")}</td>
          <td><code>${escapeHtml(s.join_code || "")}</code></td>
          <td>${s.is_open ? "Да" : "Нет"}</td>
          <td>${created}</td>
          <td><button type="button" class="secondary-btn" data-session-id="${s.id}">Выбрать</button></td>
        </tr>`;
      });

      html += "</tbody></table>";
      examSessionsList.innerHTML = html;

      examSessionsList.querySelectorAll("button[data-session-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedExamSessionId = parseInt(btn.getAttribute("data-session-id"), 10);
          setExamSessionsStatus(`Выбрана сессия id=${selectedExamSessionId}`);
        });
      });
    } catch (e) {
      console.error(e);
      examSessionsList.innerHTML = '<p class="hint">Ошибка загрузки списка сессий</p>';
    }
  }

if (createExamSessionBtn) {
    createExamSessionBtn.addEventListener("click", async () => {
    const name = (examSessionNameInput?.value || "").trim();
    const joinCode = (examSessionJoinCodeInput?.value || "").trim();

    if (!name) {
      setExamSessionsStatus("Введите название сессии");
      return;
    }

    // payload: join_code опционален (если пусто — бэк сам сгенерит)
    const payload = { session_name: name };
    if (joinCode) payload.join_code = joinCode;

    try {
      const resp = await fetch(`${API_BASE}/admin/exam_sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setExamSessionsStatus(data.error || "Ошибка создания сессии");
        return;
      }

      setExamSessionsStatus("Сессия создана");
      if (examSessionNameInput) examSessionNameInput.value = "";
      if (examSessionJoinCodeInput) examSessionJoinCodeInput.value = "";
      await renderExamSessions();
    } catch (e) {
      console.error(e);
      setExamSessionsStatus("Ошибка подключения");
    }
  });
}


  if (uploadRosterBtn) {
    uploadRosterBtn.addEventListener("click", async () => {
      if (!selectedExamSessionId) {
        setExamSessionsStatus("Сначала выберите сессию (кнопка «Выбрать»)");
        return;
      }

      const raw = (rosterNamesArea?.value || "").trim();
      if (!raw) {
        setRosterStatus("Вставьте список ФИО");
        return;
      }

      const names = raw
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      try {
        const resp = await fetch(`${API_BASE}/admin/exam_sessions/${selectedExamSessionId}/roster`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names }),
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          setRosterStatus(data.error || "Ошибка загрузки roster");
          return;
        }

        setRosterStatus(`Roster загружен: ${data.added ?? "?"} строк`);
      } catch (e) {
        console.error(e);
        setRosterStatus("Ошибка подключения");
      }
    });
  }

  // First fill
  fillAdminSettings();

  // Make history callable
  window.DictantAppRenderHistory = renderHistory;
}
