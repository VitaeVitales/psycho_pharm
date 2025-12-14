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
    saveSettings,
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

  const answerKeyInput = document.getElementById("adminAnswerKeyFile");
  const answerKeyBtn = document.getElementById("adminUploadAnswerKeyBtn");
  const answerKeyStatus = document.getElementById("adminAnswerKeyStatus");

  const exportBtn = document.getElementById("adminExportResultsBtn");
  const exportXlsxBtn = document.getElementById("adminExportResultsXlsxBtn");

  const backFromAdmin = document.getElementById("backToLoginFromAdmin");

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

    // drugs: строго строки, которые ввёл админ
    let drugs = drugsText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // никаких автозаглушек — иначе бэк справедливо откажет (не найдёт "Препарат 7")
    if (drugs.length === 0) {
      setSaveError("Введите список препаратов (1–10 строк).");
      return;
    }
    if (drugs.length > 10) drugs = drugs.slice(0, 10);

    // базовая валидация "только русский" (бэк тоже валидирует)
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

    // saveSettings() сейчас показывает alert, но нам нужно вытянуть детали -> делаем прямой POST
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

      // перезагрузка настроек, чтобы UI синхронизировался с БД
      const settings = await loadSettings();
      state.currentSettings = settings;
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
  // Upload indications (unchanged)
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
        const resp = await fetch(`${API_BASE}/admin/upload_indications`, {
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
  // Upload master table (FIXED)
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
        // ВАЖНО: новый endpoint
        const resp = await fetch(`${API_BASE}/admin/upload_master`, {
          method: "POST",
          body: formData,
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          if (answerKeyStatus) answerKeyStatus.textContent = data.error || "Ошибка загрузки мастер-таблицы";
          // часто полезно показать в блоке сохранения тоже
          setSaveError(data.error || "Ошибка загрузки мастер-таблицы");
          return;
        }

        if (answerKeyStatus) {
          const loaded = data.loaded ?? "?";
          const skipped = data.skipped ?? "?";
          answerKeyStatus.textContent = `Мастер-таблица загружена (loaded: ${loaded}, skipped: ${skipped})`;
        }

        // подтянуть settings (там хранится answer_key)
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

  // First fill
  fillAdminSettings();

  // Make history callable
  window.DictantAppRenderHistory = renderHistory;
}

