// main.js — базовая инициализация, настройки, загрузка экранов
// v2 — поддержка ticket (RU диктовка + drug_id + персональная рандомизация)

(function () {
  const ADMIN_PASSWORD = "admin123";

  let API_BASE = "";
  if (location.protocol === "file:" || !location.hostname) {
    API_BASE = "http://localhost:8000";
  }

  // ------------------ Показания ------------------

  let INDICATION_SETS = {
    general: [],
    antidepressants: [
      "Депрессии",
      "эндогенные депрессии",
      "депрессии с соматовегетативными проявлениями",
      "хронический болевой синдром",
      "ночной энурез",
      "язвенная болезнь желудка",
      "язвенная болезнь двенадцатиперстной кишки",
      "вегетативный криз",
      "ОКР",
      "ОКР у детей",
      "тревожно-фобические расстройства",
      "паническое расстройство",
      "нарколепсия с катаплексией",
      "депрессивные расстройства лёгкой и средней тяжести",
      "депрессии с психомоторной заторможенностью",
      "депрессии с астеническими проявлениями",
      "тревожные депрессии",
      "депрессии с психотическими расстройствами",
      "алкогольный абстинентный синдром",
      "депрессии при болезни Альцгеймера",
      "ГТР",
      "нервная булимия",
      "агорафобия",
      "социофобия",
      "ПТСР",
      "психогенные нарушения потенции",
      "алкогольная абстиненция",
      "нарушение сна",
      "депрессии с дисфорией, раздражительностью",
      "депрессии с апатией",
      "психосоматические расстройства",
    ],
    neuroleptics: [
      "психотические расстройства",
      "шизофрения",
      "психомоторное возбуждение",
      "неврозы с тревогой/страхом",
      "тошнота",
      "рвота",
      "параноидные состояния",
      "галлюцинаторно-параноидные состояния",
      "алкогольный психоз",
      "маниакальные состояния",
      "психические расстройства при эпилепсии",
      "невротические расстройства с повышенным мышечным тонусом",
      "упорные боли",
      "нарушения сна",
      "болезнь Меньера",
      "рвота беременных",
      "рвота при химиотерапии",
      "зудящие дерматозы/кожный зуд",
      "премедикация",
      "Психотические состояния с двигательным беспокойством",
      "тревога",
      "страх",
      "невропатические расстройства",
      "бессонница",
      "невралгия тройничного нерва",
      "боль при опоясывающем лишае",
      "болевой синдром у онкобольных",
      "Шизофрения",
      "нарушения поведения",
      "депрессия у взрослых",
      "подавленное настроение",
      "болезнь Гентингтона",
      "Психопатии возбудимого характера",
      "психопатии истерического характера",
      "психопатоподобные состояния при шизофрении",
      "параноидные состояния при органических и сосудистых заболеваниях",
      "гиперактивность",
      "возбуждение",
      "аллергические реакции",
      "алкогольная абстиненция",
      "тревога, возбуждение при дисциркуляторной энцефалопатии",
      "тревога, возбуждение при черепно-мозговых травмах",
      "тревога, возбуждение при алкогольном делирии",
      "психосоматические расстройства",
      "судорожный кашель",
      "спастические состояния ЖКТ",
      "бред",
      "галлюцинации",
      "хорея Гентингтона",
      "ажитированные депрессии",
      "психосоматические нарушения",
      "болезнь Туретта",
      "заикание",
      "икота",
      "профилактика рвоты при химиотерапии",
      "Депрессии лёгкой и средней степени",
      "астения",
      "отсутствие инициативы",
      "хронические невротические расстройства",
      "апатия",
      "анэргия",
      "маниакальная фаза",
      "умственная отсталость с возбуждением",
      "ажитация",
      "сенильное слабоумие с параноидными идеями",
      "дезориентация",
      "острые психозы",
      "обострение хронических психозов",
      "негативная симптоматика",
      "биполярное аффективное расстройство",
      "маниакальные эпизоды при БАР I типа",
      "депрессивные эпизоды при БАР I типа",
    ],
    normotimics: [],
    benzodiazepines: [],
  };

  function generateGeneral() {
    const all = new Set();
    Object.keys(INDICATION_SETS).forEach((key) => {
      if (key !== "general") {
        INDICATION_SETS[key].forEach((item) => all.add(item));
      }
    });
    INDICATION_SETS.general = Array.from(all);
  }

  generateGeneral();

  const DEFAULT_SETTINGS = {
    testDurationMinutes: 30,
    accessCode: "TEST123",
    sessionName: "Без названия",
    indicationKey: "general",

    // для админки (RU строки)
    drugs: [],

    // для ординатора (заполняется после /sessions/start)
    ticket: [],
  };

  const state = {
    currentSettings: null,
    currentStudent: null,
  };

  // ------------ Работа с API настроек ------------

  async function loadSettings() {
    try {
      const resp = await fetch(`${API_BASE}/admin/settings`);
      if (!resp.ok) {
        throw new Error(`Ошибка загрузки настроек: ${resp.status}`);
      }
      const data = await resp.json();
      const result = { ...DEFAULT_SETTINGS };

      if (data) {
        if (Array.isArray(data.drugs)) {
          result.drugs = data.drugs;
        }
        if (Number.isInteger(data.duration) && data.duration > 0) {
          result.testDurationMinutes = data.duration;
        }
        if (data.code) {
          result.accessCode = data.code;
        }
        if (data.sessionName) {
          result.sessionName = data.sessionName;
        }
        if (data.indicationKey) {
          result.indicationKey = data.indicationKey;
        }
        if (data.indicationSets) {
          INDICATION_SETS = { ...INDICATION_SETS, ...data.indicationSets };
          generateGeneral();
          result.indicationSets = data.indicationSets;
        }
      }

      state.currentSettings = result;
      return result;
    } catch (e) {
      console.error(e);
      state.currentSettings = { ...DEFAULT_SETTINGS };
      return state.currentSettings;
    }
  }

  async function saveSettings() {
    try {
      const s = state.currentSettings || DEFAULT_SETTINGS;
      const payload = {
        drugs: s.drugs, // RU строки
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
        const txt = await resp.text();
        throw new Error(`Не удалось сохранить настройки: ${resp.status} ${txt}`);
      }
      await resp.json();
      return true;
    } catch (e) {
      console.error(e);
      alert(e.message || "Ошибка сохранения настроек");
      return false;
    }
  }

  // ------------ Загрузка экранов ------------

  async function loadScreen(path) {
    const container = document.getElementById("app");
    try {
      const resp = await fetch(path);
      if (!resp.ok) {
        container.innerHTML = `<p class="hint">Ошибка загрузки интерфейса (${resp.status})</p>`;
        return null;
      }
      const html = await resp.text();
      container.innerHTML = html;
      return container;
    } catch (e) {
      console.error(e);
      container.innerHTML = `<p class="hint">Ошибка подключения к серверу</p>`;
      return null;
    }
  }

  async function loadLoginScreen() {
    const c = await loadScreen("screens/login.html");
    if (!c) return;
    if (typeof window.initLoginScreen === "function") {
      window.initLoginScreen();
    }
  }

  async function loadAdminScreen() {
    if (!state.currentSettings) {
      await loadSettings();
    }
    const c = await loadScreen("screens/admin.html");
    if (!c) return;
    if (typeof window.initAdminScreen === "function") {
      window.initAdminScreen();
    }
  }

  // 🔴 ВАЖНО: здесь теперь старт экзамена
  async function loadExamScreen() {
    if (!state.currentStudent || !state.currentSettings) {
      loadLoginScreen();
      return;
    }

    // 1) стартуем сессию → получаем ticket
    try {
      const payload = {
        studentName: state.currentStudent.name,
        group: state.currentStudent.group,
        code: state.currentSettings.accessCode,
      };

      const resp = await fetch(`${API_BASE}/sessions/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Ошибка старта диктанта");
      }

      const data = await resp.json();

      // сохраняем то, что пришло с бэка
      state.currentSettings.sessionName = data.sessionName;
      state.currentSettings.ticket = data.ticket || [];
      state.currentSettings.testDurationMinutes = data.duration || state.currentSettings.testDurationMinutes;
      state.currentSettings.indicationKey = data.indicationKey || state.currentSettings.indicationKey;
      if (data.indicationSets) {
        INDICATION_SETS = { ...INDICATION_SETS, ...data.indicationSets };
        generateGeneral();
      }
    } catch (e) {
      console.error(e);
      alert(e.message || "Не удалось начать диктант");
      loadLoginScreen();
      return;
    }

    // 2) грузим экран экзамена
    const c = await loadScreen("screens/exam.html");
    if (!c) return;
    if (typeof window.initStudentScreen === "function") {
      window.initStudentScreen();
    }
  }

  // ------------ Экспорт в глобал ------------

  window.DictantApp = {
    ADMIN_PASSWORD,
    API_BASE,
    INDICATION_SETS,
    generateGeneral,
    DEFAULT_SETTINGS,
    state,
    loadSettings,
    saveSettings,
    loadLoginScreen,
    loadAdminScreen,
    loadExamScreen,
  };

  // ------------ Старт приложения ------------

  document.addEventListener("DOMContentLoaded", async () => {
    await loadSettings();
    let adminFlag = null;
    try {
      adminFlag = localStorage.getItem("dictantAdminLoggedIn");
    } catch (e) {
      console.warn("localStorage unavailable", e);
    }
    if (adminFlag === "1") {
      loadAdminScreen();
    } else {
      loadLoginScreen();
    }
  });
})();

