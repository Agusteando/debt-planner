import Chart from 'chart.js/auto';

/**
 * FREEDOM SIM - LOGIC V8.5 (Vue/Vite)
 *
 * Cambio central:
 * - Cada tarjeta tiene:
 *   - monthlyMin: pago mínimo mensual REAL (estado de cuenta).
 *   - dueDay: día de vencimiento (1–31).
 *
 * Modelo de mínimos:
 * - Para cada tarjeta generamos una secuencia de "obligaciones" mensuales:
 *   { dueDate, amountRemaining, monthlyMin, banxicoBaseMin }
 * - La primera obligación se coloca en el "próximo vencimiento" >= fecha inicio.
 * - Cuando se sobrepasa un dueDate y todavía hay saldo en la tarjeta, se crea
 *   la obligación del siguiente ciclo (mismo día en el mes siguiente).
 * - En cada periodo (quincena):
 *   - Calculamos intereses quincenales + IVA sobre el saldo.
 *   - Pagamos mínimos primero:
 *       * Siempre contra las obligaciones con dueDate más cercano (ordenado).
 *       * Podemos adelantar obligaciones futuras, pero el desglose distingue
 *         entre lo que YA debería estar cubierto vs lo que es anticipo.
 *   - El excedente se aplica según la estrategia (snowball, avalanche, etc.).
 *
 * Seguridad:
 * - El "mínimo mensual" usado por el simulador es:
 *       max( monthlyMin_real, aproximación_Banxico_mensual )
 *   con una aproximación mensual de Banxico:
 *       baseMin = max(1.5% saldo + intereses_mes + IVA, 1.25% límite)
 *       y acotado a saldo + intereses.
 *
 * - Esto garantiza que:
 *   * Nunca se subestima el pago mínimo (caso Didi: 1671).
 *   * El sim no sugiere planes que paguen menos de lo que exige el banco.
 *
 * Per-card schedule:
 * - cardHistories[debt.id] almacena por quincena:
 *   { date, dateLabel, startingBalance, interest, iva, minPaid, extraPaid, endingBalance }
 * - Se usa para mostrar progreso y calendario de pagos al abrir la tarjeta.
 */

// --- DATOS POR DEFECTO ---
const defaultData = {
  grossIncome: 9250,
  deductions: [
    { name: 'Pensión Hija', amount: 2000 },
    { name: 'Préstamo Org', amount: 2000 },
    { name: 'Crédito Nómina', amount: 800 }
  ],
  fixedExpenses: [{ name: 'Transporte', amount: 672 }],
  discretionary: 300,
  strategy: 'snowball',
  debts: [
    {
      id: 1,
      name: 'Didi',
      balance: 11334.59,
      rate: 86.5,
      creditLimit: null,
      monthlyMin: 1671, // real mínimo mensual que mencionaste
      dueDay: 24
    },
    {
      id: 2,
      name: 'Visa 40',
      balance: 14326.18,
      rate: 72.0,
      creditLimit: null,
      monthlyMin: 1500,
      dueDay: 18
    },
    {
      id: 3,
      name: 'Plata',
      balance: 2500,
      rate: 99.0,
      creditLimit: null,
      monthlyMin: 400,
      dueDay: 12
    }
  ],
  goals: [
    { id: 1, name: 'Auto', targetAmount: 60000, startingSaved: 0, priority: 1 }
  ],
  events: [
    {
      id: 1,
      name: 'Aguinaldo + Qna Full',
      date: '2025-12-15',
      amount: 9250,
      type: 'income'
    },
    { id: 2, name: 'Creme', date: '2025-12-15', amount: 1526, type: 'expense' },
    { id: 3, name: 'XS', date: '2025-12-15', amount: 1700, type: 'expense' }
  ]
};

// --- STATE ---
const STORAGE_KEY_PROFILES = 'freedomSimProfilesV8_5_vue';
const STORAGE_KEY_CURRENT = 'freedomSimCurrentIdV8_5_vue';

let profiles = [];
let currentProfileId = null;
let state = null;
let editingIndex = null;
let editingType = null;
let simulationResults = [];
let cardHistories = {};
let surplusChart = null;

// Utils
const $ = (id) => document.getElementById(id);
const formatMoney = (val) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(
    val ?? 0
  );
const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

// --- DATE HELPERS (safe for YYYY-MM-DD strings) ---
function parseYMD(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { year: y, month: m, day: d };
}

function compareYMD(aStr, bStr) {
  const a = parseYMD(aStr);
  const b = parseYMD(bStr);
  if (!a || !b) return 0;
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function dateFromYMD(str) {
  const p = parseYMD(str);
  if (!p) return new Date();
  return new Date(p.year, p.month - 1, p.day);
}

function formatDateShort(dateObj) {
  if (typeof dateObj === 'string') {
    dateObj = dateFromYMD(dateObj);
  }
  return dateObj.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: '2-digit'
  });
}

// YearMonth key, e.g. 202512 (se deja por compatibilidad, aunque ya no se usa mucho)
function getYearMonthKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = dateObj.getMonth() + 1;
  return y * 100 + m;
}

// Crear fecha (año, mesIndex 0-based, día deseado, acotando al último día del mes)
function makeDueDate(year, monthIndex0, dueDay) {
  const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
  const d = Math.min(dueDay, lastDay);
  return new Date(year, monthIndex0, d);
}

// Día de vencimiento por defecto si el usuario no captura uno
function getDueDayOrDefault(debt) {
  const raw = parseInt(debt.dueDay, 10);
  if (!isNaN(raw) && raw > 0) return Math.min(raw, 31);
  // Por defecto usar algo razonable (25)
  return 25;
}

// Primer dueDate >= fecha de inicio
function getFirstDueDate(simStartDate, debt) {
  const dueDay = getDueDayOrDefault(debt);
  const y0 = simStartDate.getFullYear();
  const m0 = simStartDate.getMonth();

  let candidate = makeDueDate(y0, m0, dueDay);
  if (candidate >= simStartDate) return candidate;

  let y = y0;
  let m = m0 + 1;
  if (m > 11) {
    m = 0;
    y++;
  }
  return makeDueDate(y, m, dueDay);
}

// Aproximación de componentes Banxico para un MES (referencial)
function computeBanxicoMonthlyComponents(prevBalance, annualRate, creditLimit) {
  if (!prevBalance || prevBalance <= 0 || !annualRate || annualRate <= 0) {
    return {
      prevBalance: prevBalance || 0,
      monthlyInterest: 0,
      monthlyIVA: 0,
      base1p5: 0,
      optionA: 0,
      optionB: 0,
      baseMin: 0
    };
  }

  const monthlyInterest = (prevBalance * (annualRate / 100)) / 12;
  const monthlyIVA = monthlyInterest * 0.16;
  const base1p5 = 0.015 * prevBalance;
  const optionA = base1p5 + monthlyInterest + monthlyIVA;

  let optionB = 0;
  if (creditLimit && creditLimit > 0) {
    optionB = 0.0125 * creditLimit;
  }

  let baseMin = Math.max(optionA, optionB);
  const maxPossible = prevBalance + monthlyInterest + monthlyIVA;
  if (baseMin > maxPossible) baseMin = maxPossible;

  return {
    prevBalance,
    monthlyInterest,
    monthlyIVA,
    base1p5,
    optionA,
    optionB,
    baseMin
  };
}

// Normalization
function normalizeState(data) {
  const s = deepClone(data || {});

  if (!Array.isArray(s.deductions)) s.deductions = [];
  if (!Array.isArray(s.fixedExpenses)) s.fixedExpenses = [];
  if (!Array.isArray(s.debts)) s.debts = [];
  if (!Array.isArray(s.events)) s.events = [];
  if (!Array.isArray(s.goals)) s.goals = [];

  s.grossIncome = parseFloat(s.grossIncome) || 0;
  s.discretionary = parseFloat(s.discretionary) || 0;
  s.strategy = s.strategy || 'snowball';

  s.deductions = s.deductions.map((d) => ({
    name: d.name || '',
    amount: parseFloat(d.amount) || 0
  }));

  s.fixedExpenses = s.fixedExpenses.map((e) => ({
    name: e.name || '',
    amount: parseFloat(e.amount) || 0
  }));

  s.debts = s.debts.map((d, idx) => ({
    id: d.id !== undefined && d.id !== null ? d.id : idx + 1,
    name: d.name || `Deuda ${idx + 1}`,
    balance: parseFloat(d.balance) || 0,
    rate: parseFloat(d.rate) || 0,
    creditLimit:
      d.creditLimit !== undefined && d.creditLimit !== null
        ? parseFloat(d.creditLimit) || null
        : null,
    monthlyMin:
      d.monthlyMin !== undefined && d.monthlyMin !== null
        ? parseFloat(d.monthlyMin) || 0
        : 0,
    dueDay:
      d.dueDay !== undefined && d.dueDay !== null && d.dueDay !== ''
        ? parseInt(d.dueDay, 10) || null
        : null
  }));

  const todayStr = new Date().toISOString().split('T')[0];

  s.events = s.events.map((ev, idx) => ({
    id: ev.id !== undefined && ev.id !== null ? ev.id : idx + 1,
    name: ev.name || `Evento ${idx + 1}`,
    date: ev.date || todayStr,
    amount: parseFloat(ev.amount) || 0,
    type: ev.type === 'expense' ? 'expense' : 'income'
  }));

  s.goals = s.goals.map((g, idx) => ({
    id: g.id !== undefined && g.id !== null ? g.id : idx + 1,
    name: g.name || `Meta ${idx + 1}`,
    targetAmount: parseFloat(g.targetAmount) || 0,
    startingSaved: parseFloat(g.startingSaved ?? g.saved ?? 0) || 0,
    priority: parseInt(g.priority ?? idx + 1, 10) || idx + 1
  }));

  if (!s.startDate) s.startDate = todayStr;

  return s;
}

// Load / Save
function loadApp() {
  const rawProfiles = localStorage.getItem(STORAGE_KEY_PROFILES);
  const rawCurrentId = localStorage.getItem(STORAGE_KEY_CURRENT);

  if (rawProfiles) {
    try {
      profiles = JSON.parse(rawProfiles);
      currentProfileId = rawCurrentId || profiles[0].id;
    } catch (e) {
      console.error('Error parsing storage', e);
      profiles = [];
    }
  }

  if (!profiles || profiles.length === 0) {
    const newId = 'p_' + Date.now();
    profiles = [
      { id: newId, name: 'Plan Personal', data: normalizeState(defaultData) }
    ];
    currentProfileId = newId;
  }

  if (!profiles.find((p) => p.id === currentProfileId)) {
    currentProfileId = profiles[0].id;
  }

  const p = profiles.find((p) => p.id === currentProfileId);
  state = normalizeState(p.data);

  saveAll();
  initUI();
  setupProfileImportListener();
}

function saveAll() {
  const idx = profiles.findIndex((p) => p.id === currentProfileId);
  if (idx >= 0) profiles[idx].data = deepClone(state);
  localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
  localStorage.setItem(STORAGE_KEY_CURRENT, currentProfileId);
}

// UI INIT
function initUI() {
  const sel = $('profileSelect');
  sel.innerHTML = '';
  profiles.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  sel.value = currentProfileId;
  sel.onchange = (e) => switchProfile(e.target.value);

  $('startDate').value = state.startDate;
  $('grossIncome').value = state.grossIncome;
  $('discretionary').value = state.discretionary;
  $('strategySelect').value = state.strategy;

  $('startDate').onchange = (e) => {
    state.startDate = e.target.value;
    saveAndRun();
  };
  $('grossIncome').oninput = (e) => {
    state.grossIncome = parseFloat(e.target.value) || 0;
    saveAndRun();
  };
  $('discretionary').oninput = (e) => {
    state.discretionary = parseFloat(e.target.value) || 0;
    saveAndRun();
  };
  $('strategySelect').onchange = (e) => {
    state.strategy = e.target.value;
    saveAndRun();
  };

  renderLists();
  runSimulation();
}

function switchProfile(id) {
  currentProfileId = id;
  const p = profiles.find((x) => x.id === id);
  state = normalizeState(p.data);
  saveAll();
  initUI();
}

function saveAndRun() {
  saveAll();
  renderSummary();
  runSimulation();
}

// RENDER HELPERS
function renderLists() {
  renderSimpleList('deduction', state.deductions);
  renderSimpleList('expense', state.fixedExpenses);
  renderDebts();
  renderGoals();
  renderEvents();
  renderSummary();
}

function renderSimpleList(type, list) {
  const el = $(type + 'List');
  if (!el) return;
  el.innerHTML = '';
  list.forEach((item, i) => {
    el.innerHTML += `
      <div class="list-item" onclick="openModal('${type}', ${i})">
        <span>${item.name}</span>
        <span class="negative">-${formatMoney(item.amount)}</span>
      </div>`;
  });
}

function renderDebts() {
  const el = $('debtList');
  if (!el) return;
  el.innerHTML = '';
  state.debts.forEach((d, i) => {
    const color =
      d.rate > 80
        ? 'var(--danger)'
        : d.rate > 50
        ? '#fbbf24'
        : 'var(--primary)';
    const limitStr = d.creditLimit
      ? ` · Límite ${formatMoney(d.creditLimit)}`
      : '';
    const minStr = d.monthlyMin
      ? ` · Mín ${formatMoney(d.monthlyMin)}`
      : '';
    const dueStr = d.dueDay ? ` · Vence día ${d.dueDay}` : '';
    el.innerHTML += `
      <div class="list-item" style="border-left-color:${color}" onclick="openModal('debt', ${i})">
        <div style="display:flex; flex-direction:column">
          <strong>${d.name}</strong>
          <small style="color:${color}; font-size:0.7em">
            Tasa ${d.rate}%${limitStr}${minStr}${dueStr}
          </small>
        </div>
        <span class="mono">${formatMoney(d.balance)}</span>
      </div>`;
  });
}

function renderGoals() {
  const el = $('goalList');
  if (!el) return;
  el.innerHTML = '';

  const sorted = [...state.goals].sort(
    (a, b) => (a.priority || 999) - (b.priority || 999)
  );

  sorted.forEach((g) => {
    const originalIndex = state.goals.findIndex((x) => x.id === g.id);
    if (originalIndex === -1) return;
    const saved = g.startingSaved || 0;
    const progress =
      g.targetAmount > 0
        ? Math.min(100, Math.round((saved / g.targetAmount) * 100))
        : 0;

    el.innerHTML += `
      <div class="list-item" onclick="openModal('goal', ${originalIndex})">
        <div style="display:flex; flex-direction:column; gap:2px;">
          <strong>${g.name}</strong>
          <small style="color:var(--text-muted); font-size:0.7rem;">
            Objetivo ${formatMoney(g.targetAmount)} · Ahorro inicial ${formatMoney(
      saved
    )}${g.priority ? ' · Prio ' + g.priority : ''}
          </small>
        </div>
        <span class="mono ${progress >= 100 ? 'positive' : ''}">${progress}%</span>
      </div>`;
  });
}

function renderEvents() {
  const el = $('eventList');
  if (!el) return;
  el.innerHTML = '';

  const sorted = [...state.events].sort((a, b) => compareYMD(a.date, b.date));

  sorted.forEach((ev) => {
    const isInc = ev.type === 'income';
    const originalIndex = state.events.findIndex((e) => e.id === ev.id);
    if (originalIndex === -1) return;
    el.innerHTML += `
      <div class="list-item" style="border-left-color: ${
        isInc ? 'var(--success)' : 'var(--danger)'
      }" onclick="openModal('event', ${originalIndex})">
        <div style="display:flex; flex-direction:column">
          <strong>${ev.name}</strong>
          <small style="color:var(--text-muted)">${formatDateShort(
            ev.date
          )}</small>
        </div>
        <span class="${isInc ? 'positive' : 'negative'}">${
      isInc ? '+' : '-'
    }${formatMoney(ev.amount)}</span>
      </div>`;
  });
}

function renderSummary() {
  const totalDed = state.deductions.reduce((s, x) => s + (x.amount || 0), 0);
  const net = state.grossIncome - totalDed;
  const totalFix = state.fixedExpenses.reduce((s, x) => s + (x.amount || 0), 0);
  const avail = net - totalFix - state.discretionary;

  if ($('netIncomeDisplay')) $('netIncomeDisplay').innerText = formatMoney(net);
  if ($('availableForDebt'))
    $('availableForDebt').innerText = formatMoney(avail);

  const debtSum = state.debts.reduce((s, d) => s + (d.balance || 0), 0);
  if ($('totalDebtStart')) $('totalDebtStart').innerText = formatMoney(debtSum);
}

// SIM ENGINE (monthly minimum logic w/ due dates)
function runSimulation() {
  const tbody = $('simTable')?.querySelector('tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  simulationResults = [];
  cardHistories = {};

  let currentDebts = deepClone(state.debts);
  let currentGoals = deepClone(state.goals || []).map((g) => ({
    ...g,
    saved: g.startingSaved || 0
  }));

  const simStartDate = dateFromYMD(state.startDate);
  let currentDate = new Date(
    simStartDate.getFullYear(),
    simStartDate.getMonth(),
    simStartDate.getDate()
  );

  let prevPeriodEnd = null;

  let iteration = 0;
  const MAX_ITERS = 120;
  let totalInterestPaid = 0;

  const totalDed = state.deductions.reduce((s, x) => s + x.amount, 0);
  const baseNet = state.grossIncome - totalDed;
  const baseFixed = state.fixedExpenses.reduce((s, x) => s + x.amount, 0);

  let debtRemaining = currentDebts.reduce((s, d) => s + d.balance, 0);
  let totalGoalRemaining = currentGoals.reduce(
    (s, g) => s + Math.max(0, (g.targetAmount || 0) - (g.saved || 0)),
    0
  );

  let carryOver = 0;
  let debtFreedomIndex = null;

  // Inicializar historiales por tarjeta
  currentDebts.forEach((d) => {
    cardHistories[d.id] = [];
  });

  // --- Obligaciones mensuales por tarjeta ---
  const minObligations = {}; // { [debtId]: [{dueDate, amountRemaining, monthlyMin, banxicoBaseMin}] }

  currentDebts.forEach((debt) => {
    const balance = debt.balance || 0;
    if (balance <= 0.5) return;

    const banxico = computeBanxicoMonthlyComponents(
      balance,
      debt.rate,
      debt.creditLimit
    );
    const userMin = parseFloat(debt.monthlyMin) || 0;
    const monthlyMin =
      userMin > 0 ? Math.max(userMin, banxico.baseMin) : banxico.baseMin;

    const firstDueDate = getFirstDueDate(simStartDate, debt);

    minObligations[debt.id] = [
      {
        dueDate: firstDueDate,
        amountRemaining: monthlyMin,
        monthlyMin,
        banxicoBaseMin: banxico.baseMin
      }
    ];
  });

  while ((debtRemaining > 5 || totalGoalRemaining > 5) && iteration < MAX_ITERS) {
    iteration++;

    const cYear = currentDate.getFullYear();
    const cMonth = currentDate.getMonth();
    const cDay = currentDate.getDate();
    const isFirstQ = cDay <= 15;

    const periodEnd = currentDate;

    // --- INGRESOS / GASTOS BÁSICOS + EVENTOS ---
    let periodIncome = baseNet;
    let periodExpense = baseFixed + state.discretionary;
    let eventLog = [];

    state.events.forEach((ev) => {
      if (!ev.date) return;
      const evDate = dateFromYMD(ev.date);
      if (!evDate) return;

      let include = false;
      if (prevPeriodEnd) {
        if (evDate > prevPeriodEnd && evDate <= periodEnd) include = true;
      } else {
        if (evDate >= simStartDate && evDate <= periodEnd) include = true;
      }

      if (!include) return;

      if (ev.type === 'income') {
        periodIncome += ev.amount;
        eventLog.push(`+${ev.name}`);
      } else {
        periodExpense += ev.amount;
        eventLog.push(`-${ev.name}`);
      }
    });

    const netThisPeriod = periodIncome - periodExpense;
    let cashAvailable = netThisPeriod + carryOver;
    const initialCash = cashAvailable;

    // --- INTERESES QUINCENALES + registro por tarjeta ---
    const rowDebtData = {};
    currentDebts.forEach((debt) => {
      const debtId = debt.id;
      const prevBalance = debt.balance || 0;
      if (prevBalance <= 0.5) {
        debt.balance = 0;
        return;
      }

      // Interés quincenal (tasa anual / 24) + IVA
      const intereses = (prevBalance * (debt.rate / 100)) / 24;
      const iva = intereses * 0.16;
      const totalCharge = intereses + iva;
      const balanceAfterCharge = prevBalance + totalCharge;

      debt.balance = balanceAfterCharge;
      totalInterestPaid += totalCharge;

      const banxicoComp = computeBanxicoMonthlyComponents(
        prevBalance,
        debt.rate,
        debt.creditLimit
      );

      rowDebtData[debtId] = {
        debtId,
        name: debt.name,
        startingBalance: prevBalance,
        interest: intereses,
        iva,
        minPaid: 0,
        extraPaid: 0,
        endingBalance: debt.balance,
        banxico: banxicoComp
      };
    });

    // --- Generar nuevas obligaciones después de cada vencimiento ---
    Object.keys(minObligations).forEach((idStr) => {
      const debtId = Number(idStr);
      const debt = currentDebts.find((d) => d.id === debtId);
      if (!debt || debt.balance <= 0.5) return;

      const obs = minObligations[debtId];
      if (!obs || !obs.length) return;

      const dueDay = getDueDayOrDefault(debt);
      let lastOb = obs[obs.length - 1];

      // Si ya pasamos el último dueDate, se crea el del siguiente ciclo
      while (periodEnd > lastOb.dueDate && obs.length < 240 && debt.balance > 0.5) {
        const userMin = parseFloat(debt.monthlyMin) || 0;
        const ban = computeBanxicoMonthlyComponents(
          debt.balance,
          debt.rate,
          debt.creditLimit
        );
        const monthlyMin =
          userMin > 0 ? Math.max(userMin, ban.baseMin) : ban.baseMin;

        let y = lastOb.dueDate.getFullYear();
        let m = lastOb.dueDate.getMonth() + 1;
        if (m > 11) {
          m = 0;
          y++;
        }
        const nextDueDate = makeDueDate(y, m, dueDay);

        const newOb = {
          dueDate: nextDueDate,
          amountRemaining: monthlyMin,
          monthlyMin,
          banxicoBaseMin: ban.baseMin
        };

        obs.push(newOb);
        lastOb = newOb;
      }
    });

    // --- PAGOS MÍNIMOS (obligatorios) ---
    let paidMins = 0;
    const minDetails = [];
    const minPaidThisPeriod = {}; // debtId -> monto pagado como mínimo en este periodo

    // Seleccionar deudas con obligaciones pendientes
    const debtsForMin = currentDebts
      .map((debt) => {
        const obs = minObligations[debt.id] || [];
        const activeObs = obs.filter((o) => o.amountRemaining > 0.5);
        if (!activeObs.length || debt.balance <= 0.5) return null;

        const earliestDue = activeObs.reduce(
          (min, o) => (o.dueDate < min ? o.dueDate : min),
          activeObs[0].dueDate
        );
        const totalRemaining = activeObs.reduce(
          (s, o) => s + o.amountRemaining,
          0
        );
        return { debt, obs, earliestDue, totalRemaining };
      })
      .filter(Boolean)
      // Primero las obligaciones con vencimiento más cercano
      .sort(
        (a, b) =>
          a.earliestDue - b.earliestDue || b.totalRemaining - a.totalRemaining
      );

    debtsForMin.forEach(({ debt, obs }) => {
      const debtId = debt.id;
      if (!minPaidThisPeriod[debtId]) minPaidThisPeriod[debtId] = 0;

      const sortedObs = [...obs].sort((a, b) => a.dueDate - b.dueDate);

      for (const ob of sortedObs) {
        if (cashAvailable <= 0) break;
        if (ob.amountRemaining <= 0.5) continue;

        const pay = Math.min(cashAvailable, ob.amountRemaining, debt.balance);
        if (pay <= 0) continue;

        cashAvailable -= pay;
        ob.amountRemaining -= pay;
        debt.balance -= pay;

        paidMins += pay;
        minPaidThisPeriod[debtId] += pay;

        const rec = rowDebtData[debtId] || {
          debtId,
          name: debt.name,
          startingBalance: debt.balance + pay,
          interest: 0,
          iva: 0,
          minPaid: 0,
          extraPaid: 0,
          endingBalance: debt.balance,
          banxico: computeBanxicoMonthlyComponents(
            debt.balance + pay,
            debt.rate,
            debt.creditLimit
          )
        };
        rec.minPaid = (rec.minPaid || 0) + pay;
        rec.endingBalance = debt.balance;
        rowDebtData[debtId] = rec;
      }
    });

    // Construir minDetails con la foto de lo que YA debería estar cubierto a esta fecha
    currentDebts.forEach((debt) => {
      const debtId = debt.id;
      const obs = minObligations[debtId];
      if (!obs || !obs.length) return;

      const paid = minPaidThisPeriod[debtId] || 0;

      let requiredNow = 0; // mínimo acumulado que debería estar cubierto a esta fecha
      let remainingNow = 0; // adeudo pendiente de mínimos vencidos
      let earliestDue = null;
      let nextDue = null;

      obs.forEach((ob) => {
        if (!earliestDue || ob.dueDate < earliestDue) earliestDue = ob.dueDate;
        if (ob.amountRemaining > 0.5) {
          if (!nextDue || ob.dueDate < nextDue) nextDue = ob.dueDate;
        }
        if (ob.dueDate <= periodEnd) {
          requiredNow += ob.monthlyMin || 0;
          remainingNow += ob.amountRemaining;
        }
      });

      const baseMonthlyMin = obs[0].monthlyMin || 0;
      const banxicoBaseMin = obs[0].banxicoBaseMin || 0;

      minDetails.push({
        name: debt.name,
        paid,
        required: requiredNow,
        components: {
          requiredBefore: requiredNow,
          remainingAfter: remainingNow,
          firstDueDate: earliestDue,
          nextDueDate: nextDue,
          monthlyMin: baseMonthlyMin,
          banxicoBaseMin
        }
      });
    });

    // --- ESTRATEGIA (EXTRA) ---
    let strategyLog = [];
    let targetName = '';
    if (cashAvailable > 1) {
      const strategy = state.strategy || 'snowball';
      const activeDebts = currentDebts.filter((d) => d.balance > 0.5);
      const totalActiveBalance = activeDebts.reduce(
        (s, d) => s + d.balance,
        0
      );

      if (strategy === 'flat' && totalActiveBalance > 0) {
        // Distribuir extra proporcional al saldo
        let extra = cashAvailable;
        activeDebts.forEach((debt) => {
          if (extra <= 1) return;
          const share = debt.balance / totalActiveBalance;
          let pay = extra * share;
          pay = Math.min(pay, debt.balance);
          if (pay <= 0) return;

          const before = debt.balance;
          debt.balance -= pay;
          extra -= pay;

          strategyLog.push({ name: debt.name, amount: pay });
          if (!targetName) targetName = 'Diversificado';

          const rec = rowDebtData[debt.id] || {
            debtId: debt.id,
            name: debt.name,
            startingBalance: before,
            interest: 0,
            iva: 0,
            minPaid: 0,
            extraPaid: 0,
            endingBalance: debt.balance,
            banxico: computeBanxicoMonthlyComponents(
              before,
              debt.rate,
              debt.creditLimit
            )
          };
          rec.extraPaid = (rec.extraPaid || 0) + pay;
          rec.endingBalance = debt.balance;
          rowDebtData[debt.id] = rec;
        });
        cashAvailable = extra;
      } else {
        // Ordenar tarjetas según estrategia
        const orderedDebts = [...activeDebts].sort((a, b) => {
          switch (strategy) {
            case 'snowball':
              return a.balance - b.balance;
            case 'avalanche':
              return b.rate - a.rate;
            case 'highMin': {
              const ta = parseFloat(a.monthlyMin) || 0;
              const tb = parseFloat(b.monthlyMin) || 0;
              return tb - ta;
            }
            case 'reverseSnowball':
              return b.balance - a.balance; // subóptima a propósito
            default:
              return b.rate - a.rate; // fallback avalanche
          }
        });

        let extra = cashAvailable;
        for (const debt of orderedDebts) {
          if (extra <= 1) break;
          const pay = Math.min(extra, debt.balance);
          if (pay <= 0) continue;

          const before = debt.balance;
          debt.balance -= pay;
          extra -= pay;

          strategyLog.push({ name: debt.name, amount: pay });
          if (!targetName) targetName = debt.name;

          const rec = rowDebtData[debt.id] || {
            debtId: debt.id,
            name: debt.name,
            startingBalance: before,
            interest: 0,
            iva: 0,
            minPaid: 0,
            extraPaid: 0,
            endingBalance: debt.balance,
            banxico: computeBanxicoMonthlyComponents(
              before,
              debt.rate,
              debt.creditLimit
            )
          };
          rec.extraPaid = (rec.extraPaid || 0) + pay;
          rec.endingBalance = debt.balance;
          rowDebtData[debt.id] = rec;
        }
        cashAvailable = extra;
      }
    }

    // Normalizar saldos muy pequeños
    currentDebts.forEach((d) => {
      if (d.balance < 1) d.balance = 0;
    });

    debtRemaining = currentDebts.reduce((s, d) => s + d.balance, 0);

    // Guardar libertad de deuda
    const rowIndexForFreedom = simulationResults.length;
    if (debtFreedomIndex === null && debtRemaining <= 5) {
      debtFreedomIndex = rowIndexForFreedom;
    }

    // --- GOALS (solo después de liquidar deudas) ---
    let savingDetails = [];
    let totalSavingThisPeriod = 0;
    const canSaveNow = debtRemaining <= 5 && currentGoals.length > 0;

    if (cashAvailable > 1 && canSaveNow) {
      const orderedGoals = currentGoals
        .filter((g) => (g.targetAmount || 0) - (g.saved || 0) > 1)
        .sort((a, b) => (a.priority || 999) - (b.priority || 999));

      let extra = cashAvailable;
      for (const goal of orderedGoals) {
        if (extra <= 1) break;
        const need = (goal.targetAmount || 0) - (goal.saved || 0);
        if (need <= 0) continue;
        const pay = Math.min(need, extra);
        goal.saved = (goal.saved || 0) + pay;
        extra -= pay;
        totalSavingThisPeriod += pay;
        savingDetails.push({ name: goal.name, amount: pay });
      }
      cashAvailable = extra;
    }

    totalGoalRemaining = currentGoals.reduce(
      (s, g) => s + Math.max(0, (g.targetAmount || 0) - (g.saved || 0)),
      0
    );

    const pocket = Math.max(0, cashAvailable);
    carryOver = pocket;

    const resultIndex = simulationResults.length;
    const totalStrategy = strategyLog.reduce((s, x) => s + x.amount, 0);

    const notesParts = [];
    if (eventLog.length) notesParts.push(eventLog.join(', '));
    if (savingDetails.length)
      notesParts.push(
        'Ahorro: ' + savingDetails.map((s) => s.name).join(', ')
      );
    const notes = notesParts.join(' / ');

    const rowData = {
      id: iteration,
      dateStr: formatDateShort(currentDate),
      income: periodIncome,
      expenses: periodExpense,
      initialCash,
      minDetails,
      strategyDetails: strategyLog,
      savingDetails,
      endBalance: debtRemaining,
      pocket,
      notes
    };
    simulationResults.push(rowData);

    // Construir historial por tarjeta
    currentDebts.forEach((debt) => {
      const debtId = debt.id;
      const rec = rowDebtData[debtId];
      const historyArr = cardHistories[debtId];
      if (!historyArr) return;

      if (!rec) {
        const last =
          historyArr.length > 0
            ? historyArr[historyArr.length - 1].endingBalance
            : debt.balance;
        historyArr.push({
          date: new Date(periodEnd),
          dateLabel: formatDateShort(periodEnd),
          startingBalance: last,
          interest: 0,
          iva: 0,
          minPaid: 0,
          extraPaid: 0,
          endingBalance: debt.balance
        });
      } else {
        historyArr.push({
          date: new Date(periodEnd),
          dateLabel: formatDateShort(periodEnd),
          startingBalance: rec.startingBalance,
          interest: rec.interest,
          iva: rec.iva,
          minPaid: rec.minPaid,
          extraPaid: rec.extraPaid,
          endingBalance: rec.endingBalance
        });
      }
    });

    // Pintar fila en tabla principal
    const tr = document.createElement('tr');
    tr.onclick = function () {
      openActionPlan(resultIndex);
    };
    tr.innerHTML = `
      <td>${iteration}</td>
      <td>${rowData.dateStr}</td>
      <td class="mono ${
        rowData.initialCash < 0 ? 'negative' : ''
      }">${formatMoney(rowData.initialCash)}</td>
      <td class="text-danger">-${formatMoney(paidMins)}</td>
      <td class="positive">${totalStrategy ? '-' + formatMoney(totalStrategy) : '-'}</td>
      <td><strong>${
        targetName ||
        (savingDetails.length
          ? savingDetails.map((s) => s.name).join(', ')
          : debtRemaining < 10
          ? 'LIBRE'
          : '')
      }</strong></td>
      <td class="mono">${formatMoney(debtRemaining)}</td>
      <td style="font-size:0.75rem">${rowData.notes}</td>
    `;
    tbody.appendChild(tr);

    // actualizar límite inferior para eventos del siguiente periodo
    prevPeriodEnd = new Date(periodEnd);

    // Avanzar a la siguiente quincena
    if (isFirstQ) {
      currentDate = new Date(cYear, cMonth + 1, 0); // fin de mes
    } else {
      currentDate = new Date(cYear, cMonth + 1, 15); // día 15 del siguiente mes
    }
  }

  if ($('totalInterestPaid'))
    $('totalInterestPaid').innerText = formatMoney(totalInterestPaid);

  // Target de la estrategia actual
  let tempD = deepClone(state.debts);
  if (state.strategy === 'snowball')
    tempD.sort((a, b) => a.balance - b.balance);
  else if (state.strategy === 'avalanche')
    tempD.sort((a, b) => b.rate - a.rate);
  else if (state.strategy === 'highMin')
    tempD.sort(
      (a, b) =>
        (parseFloat(b.monthlyMin) || 0) - (parseFloat(a.monthlyMin) || 0)
    );
  else if (state.strategy === 'reverseSnowball')
    tempD.sort((a, b) => b.balance - a.balance);
  else tempD.sort((a, b) => b.rate - a.rate); // fallback

  const active = tempD.find((d) => d.balance > 0);
  if ($('currentTargetName'))
    $('currentTargetName').innerText = active ? active.name : '¡Libre!';

  // Libertad financiera estimada
  if (debtFreedomIndex !== null && simulationResults.length > 0) {
    const row =
      simulationResults[debtFreedomIndex] ||
      simulationResults[simulationResults.length - 1];
    $('freedomDate').innerText = row.dateStr;
    $('freedomDate').style.color = 'var(--success)';
    $('freedomTimeLeft').innerText = `${debtFreedomIndex + 1} Quincenas`;
  } else if (simulationResults.length === 0) {
    $('freedomDate').innerText = 'Sin datos';
    $('freedomDate').style.color = 'var(--text-muted)';
    $('freedomTimeLeft').innerText = '—';
  } else {
    $('freedomDate').innerText = 'Nunca';
    $('freedomDate').style.color = 'var(--danger)';
    $('freedomTimeLeft').innerText = 'Interés > Pago';
  }

  if ($('chartModal')?.open) {
    renderChart();
  }

  // Si el modal de deuda está abierto, refrescar la tabla de esa tarjeta
  if (editingType === 'debt' && editingIndex != null) {
    renderDebtSchedule(editingIndex);
  }
}

// CHART MODAL
function openChartModal() {
  const modal = $('chartModal');
  if (!modal) return;
  modal.showModal();
  renderChart();
}

function closeChartModal() {
  const modal = $('chartModal');
  if (!modal) return;
  modal.close();
}

function renderChart() {
  const canvas = $('simChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const labels = simulationResults.map((r) => r.dateStr);
  const debtData = simulationResults.map((r) => r.endBalance);
  const pocketData = simulationResults.map((r) => r.pocket);

  if (surplusChart) surplusChart.destroy();

  surplusChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Deuda restante',
          data: debtData,
          borderColor: '#f87171',
          backgroundColor: 'rgba(248,113,113,0.12)',
          tension: 0.25,
          borderWidth: 2,
          pointRadius: 0
        },
        {
          label: 'Bolsa (sobrante)',
          data: pocketData,
          borderColor: '#4ade80',
          backgroundColor: 'rgba(74,222,128,0.12)',
          tension: 0.25,
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { color: '#e5e7eb', font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#9ca3af', maxRotation: 0, autoSkip: true },
          grid: { color: 'rgba(148,163,184,0.15)' }
        },
        y: {
          type: 'linear',
          position: 'left',
          title: {
            display: true,
            text: 'Deuda',
            color: '#e5e7eb',
            font: { size: 11 }
          },
          ticks: {
            color: '#9ca3af',
            callback: (v) => formatMoney(v)
          },
          grid: { color: 'rgba(148,163,184,0.1)' }
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: {
            display: true,
            text: 'Bolsa',
            color: '#e5e7eb',
            font: { size: 11 }
          },
          ticks: {
            color: '#9ca3af',
            callback: (v) => formatMoney(v)
          },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// RECEIPT MODAL
function openActionPlan(index) {
  const data = simulationResults[index];
  if (!data) return;

  $('receiptDate').innerText = data.dateStr;
  $('receiptIncome').innerText = formatMoney(data.income);
  $('receiptExpenses').innerText = '-' + formatMoney(data.expenses);
  $('receiptAvailable').innerText = formatMoney(data.initialCash);

  const minList = $('receiptMinList');
  minList.innerHTML = '';
  let totalMin = 0;

  if (!data.minDetails || data.minDetails.length === 0) {
    minList.innerHTML =
      '<div class="receipt-item">No hay pagos mínimos.</div>';
  } else {
    data.minDetails.forEach((m) => {
      totalMin += m.paid;
      const isOnTrack =
        (m.components?.remainingAfter ?? 0) < 0.5 ||
        (m.components?.requiredBefore ?? 0) === 0;
      minList.innerHTML += `
        <div class="receipt-item">
          <span>${m.name}</span>
          <span class="${
            isOnTrack ? '' : 'negative'
          }">-${formatMoney(m.paid)}</span>
        </div>
      `;
    });
  }
  $('receiptTotalMin').innerText = '-' + formatMoney(totalMin);

  // Desglose detallado de mínimos (para el botón "?")
  const bd = $('receiptMinBreakdown');
  if (bd) {
    let html = '';
    if (data.minDetails && data.minDetails.length) {
      data.minDetails.forEach((m) => {
        const c = m.components || {};
        const firstDueStr = c.firstDueDate
          ? formatDateShort(c.firstDueDate)
          : 'N/D';
        const nextDueStr = c.nextDueDate
          ? formatDateShort(c.nextDueDate)
          : '—';

        html += `
          <div class="receipt-min-card">
            <div class="receipt-row bold">
              <span>${m.name}</span>
              <span>Mínimo mensual configurado: ${formatMoney(
                c.monthlyMin ?? 0
              )}</span>
            </div>
            <div class="receipt-row">
              <span>Aproximación Banxico (referencia mensual)</span>
              <span>${formatMoney(c.banxicoBaseMin ?? 0)}</span>
            </div>
            <div class="receipt-row">
              <span>Primer vencimiento registrado</span>
              <span>${firstDueStr}</span>
            </div>
            <div class="receipt-row">
              <span>Próximo vencimiento con adeudo pendiente</span>
              <span>${nextDueStr}</span>
            </div>
            <div class="receipt-row">
              <span>Mínimo acumulado que ya debería estar cubierto</span>
              <span>${formatMoney(c.requiredBefore ?? 0)}</span>
            </div>
            <div class="receipt-row">
              <span>Pendiente acumulado de mínimos vencidos</span>
              <span class="${
                (c.remainingAfter ?? 0) > 0.5 ? 'negative' : ''
              }">${formatMoney(c.remainingAfter ?? 0)}</span>
            </div>
            <div class="receipt-row">
              <span>Pagaste en este periodo</span>
              <span>${formatMoney(m.paid)}</span>
            </div>
            <div class="receipt-row">
              <span>Nota</span>
              <span style="text-align:right; max-width:230px;">
                ${
                  c.remainingAfter > 0.5
                    ? 'Aún falta cubrir parte del mínimo de uno o más ciclos ya vencidos. Esto implica riesgo de mora si no lo regularizas.'
                    : 'Los mínimos de todos los ciclos vencidos están completamente cubiertos a esta fecha.'
                }
              </span>
            </div>
          </div>
        `;
      });
    } else {
      html =
        '<div class="receipt-item" style="color:var(--text-muted)">No hay desglose disponible.</div>';
    }
    bd.innerHTML = html;
    bd.style.display = 'none';
  }

  const stratList = $('receiptStrategyList');
  stratList.innerHTML = '';
  if (!data.strategyDetails || data.strategyDetails.length === 0) {
    stratList.innerHTML =
      '<div class="receipt-item" style="color:var(--text-muted)">Sin remanente para estrategia de deuda.</div>';
  } else {
    data.strategyDetails.forEach((s) => {
      stratList.innerHTML += `
        <div class="receipt-item" style="color:var(--success); font-weight:700">
          <span>${s.name} (Acelerador)</span>
          <span>-${formatMoney(s.amount)}</span>
        </div>
      `;
    });
  }

  const saveList = $('receiptSavingList');
  saveList.innerHTML = '';
  if (!data.savingDetails || data.savingDetails.length === 0) {
    saveList.innerHTML =
      '<div class="receipt-item" style="color:var(--text-muted)">No hay aportes a metas este periodo.</div>';
  } else {
    data.savingDetails.forEach((s) => {
      saveList.innerHTML += `
        <div class="receipt-item">
          <span>${s.name}</span>
          <span class="positive">-${formatMoney(s.amount)}</span>
        </div>
      `;
    });
  }

  $('receiptEndBalance').innerText = formatMoney(data.endBalance);
  $('receiptPocket').innerText = formatMoney(data.pocket);

  const modal = $('actionPlanModal');
  if (modal) modal.showModal();
}

// toggle del panel de desglose de mínimos
function toggleMinBreakdown() {
  const bd = $('receiptMinBreakdown');
  if (!bd) return;
  bd.style.display =
    bd.style.display === 'none' || !bd.style.display ? 'block' : 'none';
}

// --- PER-CARD SCHEDULE / DETAIL ---
function renderDebtSchedule(index) {
  const container = $('debtScheduleContainer');
  if (!container) return;
  const debt = state.debts[index];
  if (!debt) {
    container.innerHTML =
      '<small style="color:var(--text-muted)">No se encontró la deuda.</small>';
    return;
  }

  const history = cardHistories[debt.id] || [];
  if (!history.length) {
    container.innerHTML =
      '<small style="color:var(--text-muted)">Aún no hay simulación para esta tarjeta. Ajusta datos y guarda.</small>';
    return;
  }

  let totalInterest = 0;
  let totalPaid = 0;
  let payoffIndex = -1;

  history.forEach((h, idx) => {
    totalInterest += (h.interest || 0) + (h.iva || 0);
    totalPaid += (h.minPaid || 0) + (h.extraPaid || 0);
    if (payoffIndex === -1 && h.endingBalance <= 5) {
      payoffIndex = idx;
    }
  });

  const payoffLabel =
    payoffIndex >= 0
      ? history[payoffIndex].dateLabel
      : 'No se liquida en el horizonte simulado';
  const periodsToPayoff = payoffIndex >= 0 ? payoffIndex + 1 : null;

  const rowsHtml = history
    .map((h, idx) => {
      if (idx > 59) return ''; // limitar a 60 filas para no saturar el modal
      const totalPago = (h.minPaid || 0) + (h.extraPaid || 0);
      const interesesTot = (h.interest || 0) + (h.iva || 0);
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${h.dateLabel}</td>
          <td>${formatMoney(h.minPaid || 0)}</td>
          <td>${formatMoney(h.extraPaid || 0)}</td>
          <td>${formatMoney(totalPago)}</td>
          <td>${formatMoney(interesesTot)}</td>
          <td>${formatMoney(h.endingBalance || 0)}</td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="debt-schedule-header">
      <span class="debt-schedule-pill">Saldo inicial: ${formatMoney(
        history[0].startingBalance
      )}</span>
      <span class="debt-schedule-pill">Intereses totales estimados: ${formatMoney(
        totalInterest
      )}</span>
      <span class="debt-schedule-pill">Pagos totales (mín + extra): ${formatMoney(
        totalPaid
      )}</span>
      <span class="debt-schedule-pill">
        ${
          periodsToPayoff
            ? `Se liquida aprox. en ${periodsToPayoff} quincenas (${payoffLabel})`
            : 'No se liquida con la configuración actual'
        }
      </span>
    </div>
    <table class="debt-schedule-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Fecha</th>
          <th>Pago mín.</th>
          <th>Extra</th>
          <th>Total pago</th>
          <th>Intereses+IVA</th>
          <th>Saldo fin</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="7">Sin movimientos.</td></tr>'}
      </tbody>
    </table>
  `;
}

// MODALS / CRUD
function openModal(type, index = null) {
  editingIndex = index;
  editingType = type;
  const modal = $(`${type}Modal`);
  const form = $(`${type}Form`);
  const delBtn = $(`btnDelete${capitalize(type)}`);

  form.reset();

  if (index !== null && index >= 0) {
    if (delBtn) {
      delBtn.style.display = 'block';
      delBtn.onclick = () => deleteItem(type, index);
    }
    let targetArray =
      type === 'expense'
        ? state.fixedExpenses
        : type === 'deduction'
        ? state.deductions
        : type === 'goal'
        ? state.goals
        : state[type + 's'];
    const item = targetArray[index];
    if (item) {
      Array.from(form.elements).forEach((input) => {
        if (input.name && item[input.name] !== undefined) {
          if (input.type === 'radio') {
            input.checked = input.value === item[input.name];
          } else {
            input.value = item[input.name];
          }
        }
      });
    }
  } else {
    if (delBtn) delBtn.style.display = 'none';
    if (type === 'event') form.elements['date'].value = state.startDate;
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    saveItem(type, new FormData(form));
  };

  modal.showModal();

  // Si es deuda existente, renderizar la tabla de proyección
  if (type === 'debt' && index !== null && index >= 0) {
    renderDebtSchedule(index);
  } else if (type === 'debt') {
    const container = $('debtScheduleContainer');
    if (container) {
      container.innerHTML =
        '<small style="color:var(--text-muted)">Guarda la nueva deuda para ver su proyección.</small>';
    }
  }
}

function saveItem(type, formData) {
  const newItem = {};
  formData.forEach((v, k) => (newItem[k] = v));

  if (newItem.amount !== undefined) newItem.amount = parseFloat(newItem.amount) || 0;
  if (newItem.balance !== undefined)
    newItem.balance = parseFloat(newItem.balance) || 0;
  if (newItem.rate !== undefined) newItem.rate = parseFloat(newItem.rate) || 0;
  if (newItem.targetAmount !== undefined)
    newItem.targetAmount = parseFloat(newItem.targetAmount) || 0;
  if (newItem.startingSaved !== undefined)
    newItem.startingSaved = parseFloat(newItem.startingSaved) || 0;
  if (newItem.priority !== undefined && newItem.priority !== '')
    newItem.priority = parseInt(newItem.priority, 10);
  if (newItem.creditLimit !== undefined) {
    const parsed = parseFloat(newItem.creditLimit);
    newItem.creditLimit = isNaN(parsed) ? null : parsed;
  }
  if (newItem.monthlyMin !== undefined) {
    const parsed = parseFloat(newItem.monthlyMin);
    newItem.monthlyMin = isNaN(parsed) ? 0 : parsed;
  }
  if (newItem.dueDay !== undefined && newItem.dueDay !== '') {
    const parsed = parseInt(newItem.dueDay, 10);
    newItem.dueDay = isNaN(parsed) ? null : parsed;
  }

  let targetArray =
    type === 'expense'
      ? state.fixedExpenses
      : type === 'deduction'
      ? state.deductions
      : type === 'goal'
      ? state.goals
      : state[type + 's'];

  if (type === 'debt') {
    if (editingIndex !== null && targetArray[editingIndex]?.id != null) {
      newItem.id = targetArray[editingIndex].id;
    } else {
      newItem.id = Date.now();
    }
  }

  if (type === 'event') {
    if (editingIndex !== null && targetArray[editingIndex]?.id != null) {
      newItem.id = targetArray[editingIndex].id;
    } else {
      newItem.id = Date.now();
    }
    newItem.type = newItem.type === 'expense' ? 'expense' : 'income';
  }

  if (type === 'goal') {
    if (editingIndex !== null && targetArray[editingIndex]?.id != null) {
      newItem.id = targetArray[editingIndex].id;
    } else {
      newItem.id = Date.now();
    }
    if (!newItem.priority || newItem.priority < 1) {
      newItem.priority = targetArray.length + 1;
    }
  }

  if (editingIndex !== null && editingIndex >= 0) {
    targetArray[editingIndex] = newItem;
  } else {
    targetArray.push(newItem);
  }

  closeModal(type);
  saveAndRun();
  renderLists();
}

function deleteItem(type, index) {
  let targetArray =
    type === 'expense'
      ? state.fixedExpenses
      : type === 'deduction'
      ? state.deductions
      : type === 'goal'
      ? state.goals
      : state[type + 's'];
  if (index >= 0 && index < targetArray.length) {
    targetArray.splice(index, 1);
  }
  closeModal(type);
  saveAndRun();
  renderLists();
}

function closeModal(type) {
  const modal = $(`${type}Modal`);
  if (modal) modal.close();
  if (type === 'debt') {
    editingIndex = null;
    editingType = null;
  }
}

// Profiles (full CRUD + import/export)
function createNewProfile() {
  const name = prompt('Nombre del Perfil:');
  if (!name) return;
  const newId = 'p_' + Date.now();
  profiles.push({ id: newId, name, data: normalizeState(defaultData) });
  switchProfile(newId);
}
function renameProfile() {
  const p = profiles.find((x) => x.id === currentProfileId);
  const name = prompt('Nuevo nombre:', p.name);
  if (name) {
    p.name = name;
    saveAll();
    initUI();
  }
}
function deleteCurrentProfile() {
  if (profiles.length < 2) return alert('Debe quedar al menos 1 perfil.');
  if (!confirm('¿Borrar perfil?')) return;
  profiles = profiles.filter((p) => p.id !== currentProfileId);
  switchProfile(profiles[0].id);
}
function exportCurrentProfile() {
  const p = profiles.find((x) => x.id === currentProfileId);
  const dataStr =
    'data:text/json;charset=utf-8,' +
    encodeURIComponent(JSON.stringify(p, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute('href', dataStr);
  dlAnchorElem.setAttribute('download', `freedom_${p.name}.json`);
  dlAnchorElem.click();
}

function handleProfileImportInputChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const json = JSON.parse(ev.target.result);
      if (json.data && json.name) {
        json.id = 'p_' + Date.now();
        json.data = normalizeState(json.data);
        profiles.push(json);
        switchProfile(json.id);
      } else alert('Formato inválido');
    } catch (err) {
      console.error(err);
      alert('Error al leer archivo');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function setupProfileImportListener() {
  const input = $('profileImportInput');
  if (!input || input.__fsBound) return;
  input.__fsBound = true;
  input.addEventListener('change', handleProfileImportInputChange);
}

function resetToDefaults() {
  if (!confirm('¿Restaurar datos a la configuración inicial?')) return;
  state = normalizeState(defaultData);
  state.startDate = new Date().toISOString().split('T')[0];
  saveAndRun();
  initUI();
}

// Helpers
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Hooks
window.addEventListener('load', loadApp);

// Expose for HTML inline handlers
window.openModal = openModal;
window.closeModal = closeModal;
window.deleteItem = deleteItem;
window.resetToDefaults = resetToDefaults;
window.createNewProfile = createNewProfile;
window.renameProfile = renameProfile;
window.deleteCurrentProfile = deleteCurrentProfile;
window.exportCurrentProfile = exportCurrentProfile;
window.openChartModal = openChartModal;
window.closeChartModal = closeChartModal;
window.toggleMinBreakdown = toggleMinBreakdown;
window.openActionPlan = openActionPlan;