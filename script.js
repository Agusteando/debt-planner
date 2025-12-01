/**
 * FREEDOM SIM - LOGIC V8.3 (patched)
 * - Fixed event date handling (quincenas match table correctly)
 * - Fixed cashflow propagation (bolsa carry-over)
 * - Improved payment allocation (extra spreads across debts)
 */

// --- DATOS POR DEFECTO ---
const defaultData = {
    grossIncome: 9250,
    deductions: [
        { name: 'Pensión Hija', amount: 2000 },
        { name: 'Préstamo Org', amount: 2000 },
        { name: 'Crédito Nómina', amount: 800 }
    ],
    fixedExpenses: [
        { name: 'Transporte', amount: 672 }
    ],
    discretionary: 300,
    strategy: 'snowball',
    debts: [
        { id: 1, name: 'Didi', balance: 11334.59, rate: 86.5 },
        { id: 2, name: 'Visa 40', balance: 14326.18, rate: 72.0 },
        { id: 3, name: 'Plata', balance: 2500, rate: 99.0 }
    ],
    events: [
        { id: 1, name: 'Aguinaldo + Qna Full', date: '2025-12-15', amount: 9250, type: 'income' },
        { id: 2, name: 'Creme', date: '2025-12-15', amount: 1526, type: 'expense' },
        { id: 3, name: 'XS', date: '2025-12-15', amount: 1700, type: 'expense' }
    ]
};

// --- STATE ---
const STORAGE_KEY_PROFILES = 'freedomSimProfilesV8_3';
const STORAGE_KEY_CURRENT = 'freedomSimCurrentIdV8_3';

let profiles = [];
let currentProfileId = null;
let state = null;
let editingIndex = null;
let simulationResults = [];
let surplusChart = null;

// Utils
const $ = (id) => document.getElementById(id);
const formatMoney = (val) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val ?? 0);
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

// Normalization
function normalizeState(data) {
    const s = deepClone(data || {});

    if (!Array.isArray(s.deductions)) s.deductions = [];
    if (!Array.isArray(s.fixedExpenses)) s.fixedExpenses = [];
    if (!Array.isArray(s.debts)) s.debts = [];
    if (!Array.isArray(s.events)) s.events = [];

    s.grossIncome = parseFloat(s.grossIncome) || 0;
    s.discretionary = parseFloat(s.discretionary) || 0;
    s.strategy = s.strategy || 'snowball';

    s.deductions = s.deductions.map(d => ({
        name: d.name || '',
        amount: parseFloat(d.amount) || 0
    }));

    s.fixedExpenses = s.fixedExpenses.map(e => ({
        name: e.name || '',
        amount: parseFloat(e.amount) || 0
    }));

    s.debts = s.debts.map((d, idx) => ({
        id: (d.id !== undefined && d.id !== null) ? d.id : (idx + 1),
        name: d.name || `Deuda ${idx + 1}`,
        balance: parseFloat(d.balance) || 0,
        rate: parseFloat(d.rate) || 0
    }));

    const todayStr = new Date().toISOString().split('T')[0];

    s.events = s.events.map((ev, idx) => ({
        id: (ev.id !== undefined && ev.id !== null) ? ev.id : (idx + 1),
        name: ev.name || `Evento ${idx + 1}`,
        date: ev.date || todayStr,
        amount: parseFloat(ev.amount) || 0,
        type: ev.type === 'expense' ? 'expense' : 'income'
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
            console.error("Error parsing storage", e);
            profiles = [];
        }
    }

    if (!profiles || profiles.length === 0) {
        const newId = 'p_' + Date.now();
        profiles = [{ id: newId, name: 'Plan Personal', data: normalizeState(defaultData) }];
        currentProfileId = newId;
    }

    if (!profiles.find(p => p.id === currentProfileId)) currentProfileId = profiles[0].id;

    const p = profiles.find(p => p.id === currentProfileId);
    state = normalizeState(p.data);

    saveAll();
    initUI();
}

function saveAll() {
    const idx = profiles.findIndex(p => p.id === currentProfileId);
    if (idx >= 0) profiles[idx].data = deepClone(state);
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
    localStorage.setItem(STORAGE_KEY_CURRENT, currentProfileId);
}

// UI INIT
function initUI() {
    const sel = $('profileSelect');
    sel.innerHTML = '';
    profiles.forEach(p => {
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

    $('startDate').onchange = (e) => { state.startDate = e.target.value; saveAndRun(); };
    $('grossIncome').oninput = (e) => { state.grossIncome = parseFloat(e.target.value) || 0; saveAndRun(); };
    $('discretionary').oninput = (e) => { state.discretionary = parseFloat(e.target.value) || 0; saveAndRun(); };
    $('strategySelect').onchange = (e) => { state.strategy = e.target.value; saveAndRun(); };

    renderLists();
    runSimulation();
}

function switchProfile(id) {
    currentProfileId = id;
    const p = profiles.find(x => x.id === id);
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
        const color = d.rate > 80 ? 'var(--danger)' : (d.rate > 50 ? '#fbbf24' : 'var(--primary)');
        el.innerHTML += `
            <div class="list-item" style="border-left-color:${color}" onclick="openModal('debt', ${i})">
                <div style="display:flex; flex-direction:column">
                    <strong>${d.name}</strong>
                    <small style="color:${color}; font-size:0.7em">Tasa ${d.rate}%</small>
                </div>
                <span class="mono">${formatMoney(d.balance)}</span>
            </div>`;
    });
}

function renderEvents() {
    const el = $('eventList');
    if (!el) return;
    el.innerHTML = '';

    const sorted = [...state.events].sort((a, b) => compareYMD(a.date, b.date));

    sorted.forEach(ev => {
        const isInc = ev.type === 'income';
        const originalIndex = state.events.findIndex(e => e.id === ev.id);
        if (originalIndex === -1) return;
        el.innerHTML += `
            <div class="list-item" style="border-left-color: ${isInc ? 'var(--success)' : 'var(--danger)'}" onclick="openModal('event', ${originalIndex})">
                <div style="display:flex; flex-direction:column">
                    <strong>${ev.name}</strong>
                    <small style="color:var(--text-muted)">${formatDateShort(ev.date)}</small>
                </div>
                <span class="${isInc ? 'positive' : 'negative'}">${isInc ? '+' : '-'}${formatMoney(ev.amount)}</span>
            </div>`;
    });
}

function renderSummary() {
    const totalDed = state.deductions.reduce((s, x) => s + (x.amount || 0), 0);
    const net = state.grossIncome - totalDed;
    const totalFix = state.fixedExpenses.reduce((s, x) => s + (x.amount || 0), 0);
    const avail = net - totalFix - state.discretionary;

    if ($('netIncomeDisplay')) $('netIncomeDisplay').innerText = formatMoney(net);
    if ($('availableForDebt')) $('availableForDebt').innerText = formatMoney(avail);

    const debtSum = state.debts.reduce((s, d) => s + (d.balance || 0), 0);
    if ($('totalDebtStart')) $('totalDebtStart').innerText = formatMoney(debtSum);
}

// SIM ENGINE
function runSimulation() {
    const tbody = $('simTable')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    simulationResults = [];

    let currentDebts = deepClone(state.debts);

    const startParts = parseYMD(state.startDate);
    let currentDate = startParts
        ? new Date(startParts.year, startParts.month - 1, startParts.day)
        : new Date();

    let iteration = 0;
    const MAX_ITERS = 120;
    let totalInterestPaid = 0;

    const totalDed = state.deductions.reduce((s, x) => s + x.amount, 0);
    const baseNet = state.grossIncome - totalDed;
    const baseFixed = state.fixedExpenses.reduce((s, x) => s + x.amount, 0);

    let debtRemaining = currentDebts.reduce((s, d) => s + d.balance, 0);

    // NEW: carry-over pocket between periods
    let carryOver = 0;

    while (debtRemaining > 5 && iteration < MAX_ITERS) {
        iteration++;

        const cYear = currentDate.getFullYear();
        const cMonth = currentDate.getMonth();
        const cDay = currentDate.getDate();
        const isFirstQ = cDay <= 15;

        let periodIncome = baseNet;
        let periodExpense = baseFixed + state.discretionary;
        let eventLog = [];

        // Events by month + quincena
        state.events.forEach(ev => {
            if (!ev.date) return;
            const p = parseYMD(ev.date);
            if (!p) return;
            const evYear = p.year;
            const evMonth = p.month - 1;
            const evDay = p.day;

            if (evYear === cYear && evMonth === cMonth) {
                const evIsFirst = evDay <= 15;
                if (evIsFirst === isFirstQ) {
                    if (ev.type === 'income') {
                        periodIncome += ev.amount;
                        eventLog.push(`+${ev.name}`);
                    } else {
                        periodExpense += ev.amount;
                        eventLog.push(`-${ev.name}`);
                    }
                }
            }
        });

        const netThisPeriod = periodIncome - periodExpense;
        let cashAvailable = netThisPeriod + carryOver; // incluye bolsa anterior
        const initialCash = cashAvailable;

        // Interest
        currentDebts.forEach(debt => {
            if (debt.balance > 0) {
                const i = (debt.balance * (debt.rate / 100)) / 24;
                const iva = i * 0.16;
                const totalCharge = i + iva;
                debt.balance += totalCharge;
                totalInterestPaid += totalCharge;
            }
        });

        // Minimums
        let minPayments = [];
        currentDebts.forEach((debt, idx) => {
            if (debt.balance < 1) return;
            let calcMin = (debt.balance * 0.03);
            if (calcMin < debt.balance && calcMin < 200) calcMin = 200;
            if (calcMin > debt.balance) calcMin = debt.balance;
            minPayments.push({ idx, name: debt.name, amount: calcMin });
        });

        let paidMins = 0;
        let minDetails = [];

        minPayments.forEach(p => {
            if (cashAvailable <= 0) {
                minDetails.push({ name: p.name, paid: 0, required: p.amount });
                return;
            }
            let actualPay = Math.min(cashAvailable, p.amount);
            const debtObj = currentDebts[p.idx];
            if (!debtObj) return;
            debtObj.balance -= actualPay;
            cashAvailable -= actualPay;
            paidMins += actualPay;
            minDetails.push({ name: p.name, paid: actualPay, required: p.amount });
        });

        // Strategy: use all remaining extra across debts in order
        let strategyLog = [];
        let targetName = "";

        if (cashAvailable > 1) {
            const orderedDebts = currentDebts
                .filter(d => d.balance > 1)
                .sort(state.strategy === 'snowball'
                    ? (a, b) => a.balance - b.balance // menor saldo primero
                    : (a, b) => b.rate - a.rate      // mayor tasa primero
                );

            let extra = cashAvailable;
            for (const debt of orderedDebts) {
                if (extra <= 1) break;
                const payAmount = Math.min(debt.balance, extra);
                if (payAmount <= 0) continue;
                debt.balance -= payAmount;
                extra -= payAmount;
                strategyLog.push({ name: debt.name, amount: payAmount });
                if (!targetName) targetName = debt.name;
            }
            cashAvailable = extra;
        }

        currentDebts.forEach(d => { if (d.balance < 1) d.balance = 0; });
        debtRemaining = currentDebts.reduce((s, d) => s + d.balance, 0);

        const pocket = Math.max(0, cashAvailable);
        carryOver = pocket; // NEW: propagate bolsa

        const resultIndex = simulationResults.length;
        const totalStrategy = strategyLog.reduce((s, x) => s + x.amount, 0);

        const rowData = {
            id: iteration,
            dateStr: formatDateShort(currentDate),
            income: periodIncome,
            expenses: periodExpense,
            initialCash,
            minDetails,
            strategyDetails: strategyLog,
            endBalance: debtRemaining,
            pocket,
            notes: eventLog.join(', ')
        };
        simulationResults.push(rowData);

        const tr = document.createElement('tr');
        tr.onclick = function () { openActionPlan(resultIndex); };
        tr.innerHTML = `
            <td>${iteration}</td>
            <td>${rowData.dateStr}</td>
            <td class="mono ${rowData.initialCash < 0 ? 'negative' : ''}">${formatMoney(rowData.initialCash)}</td>
            <td class="text-danger">-${formatMoney(paidMins)}</td>
            <td class="positive">${totalStrategy ? '-' + formatMoney(totalStrategy) : '-'}</td>
            <td><strong>${targetName || (debtRemaining < 10 ? 'LIBRE' : '')}</strong></td>
            <td class="mono">${formatMoney(debtRemaining)}</td>
            <td style="font-size:0.75rem">${rowData.notes}</td>
        `;
        tbody.appendChild(tr);

        // Avanzar a la siguiente quincena (fecha de periodo)
        if (isFirstQ) {
            // Ir al último día del mes actual
            currentDate = new Date(cYear, cMonth + 1, 0);
        } else {
            // Ir al día 15 del siguiente mes
            currentDate = new Date(cYear, cMonth + 1, 15);
        }
    }

    if ($('totalInterestPaid')) $('totalInterestPaid').innerText = formatMoney(totalInterestPaid);

    let tempD = deepClone(state.debts);
    if (state.strategy === 'snowball') tempD.sort((a, b) => a.balance - b.balance);
    else tempD.sort((a, b) => b.rate - a.rate);
    const active = tempD.find(d => d.balance > 0);
    if ($('currentTargetName')) $('currentTargetName').innerText = active ? active.name : "¡Libre!";

    if (debtRemaining < 100 && simulationResults.length > 0) {
        const last = simulationResults[simulationResults.length - 1];
        $('freedomDate').innerText = last ? last.dateStr : "Hoy";
        $('freedomDate').style.color = 'var(--success)';
        $('freedomTimeLeft').innerText = `${simulationResults.length} Quincenas`;
    } else if (simulationResults.length === 0) {
        $('freedomDate').innerText = "Sin datos";
        $('freedomDate').style.color = 'var(--text-muted)';
        $('freedomTimeLeft').innerText = "—";
    } else {
        $('freedomDate').innerText = "Nunca";
        $('freedomDate').style.color = 'var(--danger)';
        $('freedomTimeLeft').innerText = "Interés > Pago";
    }

    // Chart only rerenders if modal is opened; but keep last data ready
    if ($('chartModal')?.open) {
        renderChart();
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

    const labels = simulationResults.map(r => r.dateStr);
    const debtData = simulationResults.map(r => r.endBalance);
    const pocketData = simulationResults.map(r => r.pocket);

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
                legend: { display: true, labels: { color: '#e5e7eb', font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}`
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
                    title: { display: true, text: 'Deuda', color: '#e5e7eb', font: { size: 11 } },
                    ticks: {
                        color: '#9ca3af',
                        callback: v => formatMoney(v)
                    },
                    grid: { color: 'rgba(148,163,184,0.1)' }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Bolsa', color: '#e5e7eb', font: { size: 11 } },
                    ticks: {
                        color: '#9ca3af',
                        callback: v => formatMoney(v)
                    },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });
}

// RECEIPT MODAL
window.openActionPlan = function (index) {
    const data = simulationResults[index];
    if (!data) return;

    $('receiptDate').innerText = data.dateStr;
    $('receiptIncome').innerText = formatMoney(data.income);
    $('receiptExpenses').innerText = '-' + formatMoney(data.expenses);
    $('receiptAvailable').innerText = formatMoney(data.initialCash);

    const minList = $('receiptMinList');
    minList.innerHTML = '';
    let totalMin = 0;

    if (data.minDetails.length === 0) {
        minList.innerHTML = '<div class="receipt-item">No hay pagos mínimos.</div>';
    } else {
        data.minDetails.forEach(m => {
            totalMin += m.paid;
            const isFull = m.paid >= m.required;
            minList.innerHTML += `
                <div class="receipt-item">
                    <span>${m.name}</span>
                    <span class="${isFull ? '' : 'negative'}">-${formatMoney(m.paid)}</span>
                </div>
            `;
        });
    }
    $('receiptTotalMin').innerText = '-' + formatMoney(totalMin);

    const stratList = $('receiptStrategyList');
    stratList.innerHTML = '';
    if (data.strategyDetails.length === 0) {
        stratList.innerHTML = '<div class="receipt-item" style="color:var(--text-muted)">Sin remanente para estrategia.</div>';
    } else {
        data.strategyDetails.forEach(s => {
            stratList.innerHTML += `
                <div class="receipt-item" style="color:var(--success); font-weight:700">
                    <span>${s.name} (Acelerador)</span>
                    <span>-${formatMoney(s.amount)}</span>
                </div>
            `;
        });
    }

    $('receiptEndBalance').innerText = formatMoney(data.endBalance);
    $('receiptPocket').innerText = formatMoney(data.pocket);

    const modal = $('actionPlanModal');
    if (modal) modal.showModal();
};

// MODALS / CRUD
function openModal(type, index = null) {
    editingIndex = index;
    const modal = $(`${type}Modal`);
    const form = $(`${type}Form`);
    const delBtn = $(`btnDelete${capitalize(type)}`);

    form.reset();

    if (index !== null && index >= 0) {
        if (delBtn) { delBtn.style.display = 'block'; delBtn.onclick = () => deleteItem(type, index); }
        let targetArray = type === 'expense'
            ? state.fixedExpenses
            : (type === 'deduction' ? state.deductions : state[type + 's']);
        const item = targetArray[index];
        if (item) {
            Array.from(form.elements).forEach(input => {
                if (input.name && item[input.name] !== undefined) {
                    if (input.type === 'radio') {
                        input.checked = (input.value === item[input.name]);
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
}

function saveItem(type, formData) {
    const newItem = {};
    formData.forEach((v, k) => newItem[k] = v);

    if (newItem.amount !== undefined) newItem.amount = parseFloat(newItem.amount) || 0;
    if (newItem.balance !== undefined) newItem.balance = parseFloat(newItem.balance) || 0;
    if (newItem.rate !== undefined) newItem.rate = parseFloat(newItem.rate) || 0;

    let targetArray = type === 'expense'
        ? state.fixedExpenses
        : (type === 'deduction' ? state.deductions : state[type + 's']);

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
    let targetArray = type === 'expense'
        ? state.fixedExpenses
        : (type === 'deduction' ? state.deductions : state[type + 's']);
    if (index >= 0 && index < targetArray.length) {
        targetArray.splice(index, 1);
    }
    closeModal(type);
    saveAndRun();
    renderLists();
}

function closeModal(type) { $(`${type}Modal`).close(); }

// Profiles
function createNewProfile() {
    const name = prompt("Nombre del Perfil:");
    if (!name) return;
    const newId = 'p_' + Date.now();
    profiles.push({ id: newId, name, data: normalizeState(defaultData) });
    switchProfile(newId);
}
function renameProfile() {
    const p = profiles.find(x => x.id === currentProfileId);
    const name = prompt("Nuevo nombre:", p.name);
    if (name) { p.name = name; saveAll(); initUI(); }
}
function deleteCurrentProfile() {
    if (profiles.length < 2) return alert("Debe quedar al menos 1 perfil.");
    if (!confirm("¿Borrar perfil?")) return;
    profiles = profiles.filter(p => p.id !== currentProfileId);
    switchProfile(profiles[0].id);
}
function exportCurrentProfile() {
    const p = profiles.find(x => x.id === currentProfileId);
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(p));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `freedom_${p.name}.json`);
    dlAnchorElem.click();
}
$('profileImportInput').addEventListener('change', (e) => {
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
            } else alert("Formato inválido");
        } catch (err) { alert("Error al leer archivo"); }
    };
    reader.readAsText(file);
    e.target.value = '';
});

function resetToDefaults() {
    if (!confirm("¿Restaurar datos a la configuración inicial?")) return;
    state = normalizeState(defaultData);
    state.startDate = new Date().toISOString().split('T')[0];
    saveAndRun();
    initUI();
}

// Helpers
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

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

// Hooks
window.onload = loadApp;
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
