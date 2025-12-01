/**
 * FREEDOM SIM - LOGIC V8.3
 * - Metas de ahorro
 * - Chart modal fixed
 * - Pago mínimo conforme Banxico (Circular 13/2011):
 *   PagoMin = max(
 *      1.5% del saldo revolvente al corte + intereses del periodo + IVA,
 *      1.25% del límite de la línea de crédito
 *   ), acotado al saldo total.  (Aplicado por quincena en el simulador.)
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
        { id: 1, name: 'Didi',  balance: 11334.59, rate: 86.5, creditLimit: null },
        { id: 2, name: 'Visa 40', balance: 14326.18, rate: 72.0, creditLimit: null },
        { id: 3, name: 'Plata', balance: 2500, rate: 99.0, creditLimit: null }
    ],
    goals: [
        { id: 1, name: 'Auto', targetAmount: 60000, startingSaved: 0, priority: 1 }
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
    if (!Array.isArray(s.goals)) s.goals = [];

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
        rate: parseFloat(d.rate) || 0,
        creditLimit: d.creditLimit !== undefined && d.creditLimit !== null
            ? (parseFloat(d.creditLimit) || null)
            : null
    }));

    const todayStr = new Date().toISOString().split('T')[0];

    s.events = s.events.map((ev, idx) => ({
        id: (ev.id !== undefined && ev.id !== null) ? ev.id : (idx + 1),
        name: ev.name || `Evento ${idx + 1}`,
        date: ev.date || todayStr,
        amount: parseFloat(ev.amount) || 0,
        type: ev.type === 'expense' ? 'expense' : 'income'
    }));

    s.goals = s.goals.map((g, idx) => ({
        id: (g.id !== undefined && g.id !== null) ? g.id : (idx + 1),
        name: g.name || `Meta ${idx + 1}`,
        targetAmount: parseFloat(g.targetAmount) || 0,
        startingSaved: parseFloat(g.startingSaved ?? g.saved ?? 0) || 0,
        priority: parseInt(g.priority ?? (idx + 1), 10) || (idx + 1)
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
        const color = d.rate > 80 ? 'var(--danger)' : (d.rate > 50 ? '#fbbf24' : 'var(--primary)');
        const limitStr = d.creditLimit ? ` · Límite ${formatMoney(d.creditLimit)}` : '';
        el.innerHTML += `
            <div class="list-item" style="border-left-color:${color}" onclick="openModal('debt', ${i})">
                <div style="display:flex; flex-direction:column">
                    <strong>${d.name}</strong>
                    <small style="color:${color}; font-size:0.7em">
                        Tasa ${d.rate}%${limitStr}
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

    const sorted = [...state.goals].sort((a, b) => (a.priority || 999) - (b.priority || 999));

    sorted.forEach(g => {
        const originalIndex = state.goals.findIndex(x => x.id === g.id);
        if (originalIndex === -1) return;
        const saved = g.startingSaved || 0;
        const progress = g.targetAmount > 0
            ? Math.min(100, Math.round((saved / g.targetAmount) * 100))
            : 0;

        el.innerHTML += `
            <div class="list-item" onclick="openModal('goal', ${originalIndex})">
                <div style="display:flex; flex-direction:column; gap:2px;">
                    <strong>${g.name}</strong>
                    <small style="color:var(--text-muted); font-size:0.7rem;">
                        Objetivo ${formatMoney(g.targetAmount)} · Ahorro inicial ${formatMoney(saved)}${g.priority ? ' · Prio ' + g.priority : ''}
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
    let currentGoals = deepClone(state.goals || []).map(g => ({
        ...g,
        saved: g.startingSaved || 0
    }));

    const startParts = parseYMD(state.startDate);
    let currentDate = startParts
        ? new Date(startParts.year, startParts.month - 1, startParts.day)
        : new Date();

    const simStartDate = dateFromYMD(state.startDate);
    let prevPeriodEnd = null; // para asignar eventos por rango (prevEnd, currentEnd]

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

    while ((debtRemaining > 5 || totalGoalRemaining > 5) && iteration < MAX_ITERS) {
        iteration++;

        const cYear = currentDate.getFullYear();
        const cMonth = currentDate.getMonth();
        const cDay = currentDate.getDate();
        const isFirstQ = cDay <= 15;

        let periodIncome = baseNet;
        let periodExpense = baseFixed + state.discretionary;
        let eventLog = [];

        const periodEnd = currentDate;

        // --- EVENTOS: rango inteligente (prevEnd, periodEnd] ---
        state.events.forEach(ev => {
            if (!ev.date) return;
            const evDate = dateFromYMD(ev.date);
            if (!evDate) return;

            let include = false;
            if (prevPeriodEnd) {
                // periodos después del primero
                if (evDate > prevPeriodEnd && evDate <= periodEnd) include = true;
            } else {
                // primer periodo: desde startDate hasta periodEnd
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

        // --- INTERESES + MINIMOS (Banxico exacto sobre periodo quincenal) ---
        let minPayments = [];

        currentDebts.forEach((debt, idx) => {
            const prevBalance = debt.balance;
            if (prevBalance <= 0.5) {
                debt.balance = 0;
                return;
            }

            // Interés quincenal (tasa anual nominal / 24) + IVA
            const intereses = (prevBalance * (debt.rate / 100)) / 24;
            const iva = intereses * 0.16;
            const totalCharge = intereses + iva;
            const balanceAfterCharge = prevBalance + totalCharge;

            // Opción A: 1.5% del saldo revolvente + intereses+IVA
            const base1p5 = 0.015 * prevBalance;
            const optionA = base1p5 + totalCharge;

            // Opción B: 1.25% de la línea de crédito (si se capturó)
            let optionB = 0;
            if (debt.creditLimit && debt.creditLimit > 0) {
                optionB = 0.0125 * debt.creditLimit;
            }

            let baseMin = Math.max(optionA, optionB);
            let chosen = 'a';
            if (optionB > optionA && optionB > 0) chosen = 'b';

            // Si el pago mínimo rebasa el saldo total, se cobra el saldo total
            if (baseMin > balanceAfterCharge) {
                baseMin = balanceAfterCharge;
                chosen = 'all';
            }

            debt.balance = balanceAfterCharge;

            minPayments.push({
                idx,
                name: debt.name,
                amount: baseMin,
                components: {
                    prevBalance,
                    interest: intereses,
                    iva,
                    totalCharge,
                    balanceAfterCharge,
                    base1p5,
                    optionA,
                    optionB,
                    baseMin,
                    chosen,
                    creditLimit: debt.creditLimit || null
                }
            });

            totalInterestPaid += totalCharge;
        });

        // Aplicar mínimos con el cash disponible
        let paidMins = 0;
        let minDetails = [];

        minPayments.forEach(p => {
            if (cashAvailable <= 0) {
                minDetails.push({
                    name: p.name,
                    paid: 0,
                    required: p.amount,
                    components: p.components
                });
                return;
            }
            let actualPay = Math.min(cashAvailable, p.amount);
            const debtObj = currentDebts[p.idx];
            if (!debtObj) return;
            debtObj.balance -= actualPay;
            cashAvailable -= actualPay;
            paidMins += actualPay;
            minDetails.push({
                name: p.name,
                paid: actualPay,
                required: p.amount,
                components: p.components
            });
        });

        // Strategy: extra contra deudas
        let strategyLog = [];
        let targetName = "";

        if (cashAvailable > 1) {
            const orderedDebts = currentDebts
                .filter(d => d.balance > 1)
                .sort(state.strategy === 'snowball'
                    ? (a, b) => a.balance - b.balance
                    : (a, b) => b.rate - a.rate
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

        // Marcar quincena donde quedas sin deuda
        const rowIndexForFreedom = simulationResults.length;
        if (debtFreedomIndex === null && debtRemaining <= 5) {
            debtFreedomIndex = rowIndexForFreedom;
        }

        // Savings goals: solo después de liquidar deudas
        let savingDetails = [];
        let totalSavingThisPeriod = 0;
        const canSaveNow = debtRemaining <= 5 && currentGoals.length > 0;

        if (cashAvailable > 1 && canSaveNow) {
            const orderedGoals = currentGoals
                .filter(g => (g.targetAmount || 0) - (g.saved || 0) > 1)
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
        if (savingDetails.length) notesParts.push('Ahorro: ' + savingDetails.map(s => s.name).join(', '));
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

        const tr = document.createElement('tr');
        tr.onclick = function () { openActionPlan(resultIndex); };
        tr.innerHTML = `
            <td>${iteration}</td>
            <td>${rowData.dateStr}</td>
            <td class="mono ${rowData.initialCash < 0 ? 'negative' : ''}">${formatMoney(rowData.initialCash)}</td>
            <td class="text-danger">-${formatMoney(paidMins)}</td>
            <td class="positive">${totalStrategy ? '-' + formatMoney(totalStrategy) : '-'}</td>
            <td><strong>${targetName || (savingDetails.length ? savingDetails.map(s => s.name).join(', ') : (debtRemaining < 10 ? 'LIBRE' : ''))}</strong></td>
            <td class="mono">${formatMoney(debtRemaining)}</td>
            <td style="font-size:0.75rem">${rowData.notes}</td>
        `;
        tbody.appendChild(tr);

        // actualizar límite inferior para eventos del siguiente periodo
        prevPeriodEnd = new Date(periodEnd);

        // Avanzar a la siguiente quincena (fecha de periodo)
        if (isFirstQ) {
            currentDate = new Date(cYear, cMonth + 1, 0);  // fin de mes
        } else {
            currentDate = new Date(cYear, cMonth + 1, 15); // día 15 del siguiente mes
        }
    }

    if ($('totalInterestPaid')) $('totalInterestPaid').innerText = formatMoney(totalInterestPaid);

    let tempD = deepClone(state.debts);
    if (state.strategy === 'snowball') tempD.sort((a, b) => a.balance - b.balance);
    else tempD.sort((a, b) => b.rate - a.rate);
    const active = tempD.find(d => d.balance > 0);
    if ($('currentTargetName')) $('currentTargetName').innerText = active ? active.name : "¡Libre!";

    if (debtFreedomIndex !== null && simulationResults.length > 0) {
        const row = simulationResults[debtFreedomIndex] || simulationResults[simulationResults.length - 1];
        $('freedomDate').innerText = row.dateStr;
        $('freedomDate').style.color = 'var(--success)';
        $('freedomTimeLeft').innerText = `${debtFreedomIndex + 1} Quincenas`;
    } else if (simulationResults.length === 0) {
        $('freedomDate').innerText = "Sin datos";
        $('freedomDate').style.color = 'var(--text-muted)';
        $('freedomTimeLeft').innerText = "—";
    } else {
        $('freedomDate').innerText = "Nunca";
        $('freedomDate').style.color = 'var(--danger)';
        $('freedomTimeLeft').innerText = "Interés > Pago";
    }

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

    if (!data.minDetails || data.minDetails.length === 0) {
        minList.innerHTML = '<div class="receipt-item">No hay pagos mínimos.</div>';
    } else {
        data.minDetails.forEach(m => {
            totalMin += m.paid;
            const isFull = m.paid >= m.required - 0.01;
            minList.innerHTML += `
                <div class="receipt-item">
                    <span>${m.name}</span>
                    <span class="${isFull ? '' : 'negative'}">-${formatMoney(m.paid)}</span>
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
            data.minDetails.forEach(m => {
                const c = m.components || {};
                html += `
                    <div class="receipt-min-card">
                        <div class="receipt-row bold">
                            <span>${m.name}</span>
                            <span>Min. requerido: ${formatMoney(c.baseMin ?? m.required)}</span>
                        </div>
                        <div class="receipt-row">
                            <span>Saldo revolvente al corte</span>
                            <span>${formatMoney(c.prevBalance ?? 0)}</span>
                        </div>
                        ${c.creditLimit ? `
                        <div class="receipt-row">
                            <span>Límite de crédito</span>
                            <span>${formatMoney(c.creditLimit)}</span>
                        </div>` : ''}
                        <div class="receipt-row">
                            <span>1.5% del saldo (capital)</span>
                            <span>${formatMoney(c.base1p5 ?? 0)}</span>
                        </div>
                        <div class="receipt-row">
                            <span>Intereses del periodo</span>
                            <span>${formatMoney(c.interest ?? 0)}</span>
                        </div>
                        <div class="receipt-row">
                            <span>IVA de intereses</span>
                            <span>${formatMoney(c.iva ?? 0)}</span>
                        </div>
                        <div class="receipt-row">
                            <span>Intereses + IVA</span>
                            <span>${formatMoney(c.totalCharge ?? 0)}</span>
                        </div>
                        <div class="receipt-row">
                            <span>Opción A (1.5% + intereses+IVA)</span>
                            <span>${formatMoney(c.optionA ?? 0)}</span>
                        </div>
                        ${c.optionB && c.optionB > 0 ? `
                        <div class="receipt-row">
                            <span>Opción B (1.25% línea de crédito)</span>
                            <span>${formatMoney(c.optionB)}</span>
                        </div>` : ''}
                        <div class="receipt-row">
                            <span>Regla aplicada</span>
                            <span style="text-align:right; max-width:180px;">
                                ${c.chosen === 'a'
                                    ? 'Se tomó la opción A (1.5% del saldo + intereses+IVA).'
                                    : c.chosen === 'b'
                                        ? 'Se tomó la opción B (1.25% de la línea de crédito).'
                                        : 'El saldo era menor al pago mínimo, se liquida el saldo completo.'}
                            </span>
                        </div>
                        <div class="receipt-row">
                            <span>Pagaste en esta quincena</span>
                            <span>${formatMoney(m.paid)}</span>
                        </div>
                    </div>
                `;
            });
        } else {
            html = '<div class="receipt-item" style="color:var(--text-muted)">No hay desglose disponible.</div>';
        }
        bd.innerHTML = html;
        bd.style.display = 'none';
    }

    const stratList = $('receiptStrategyList');
    stratList.innerHTML = '';
    if (!data.strategyDetails || data.strategyDetails.length === 0) {
        stratList.innerHTML = '<div class="receipt-item" style="color:var(--text-muted)">Sin remanente para estrategia de deuda.</div>';
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

    const saveList = $('receiptSavingList');
    saveList.innerHTML = '';
    if (!data.savingDetails || data.savingDetails.length === 0) {
        saveList.innerHTML = '<div class="receipt-item" style="color:var(--text-muted)">No hay aportes a metas este periodo.</div>';
    } else {
        data.savingDetails.forEach(s => {
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
};

// toggle del panel de desglose de mínimos
function toggleMinBreakdown() {
    const bd = $('receiptMinBreakdown');
    if (!bd) return;
    bd.style.display = (bd.style.display === 'none' || !bd.style.display) ? 'block' : 'none';
}

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
            : (type === 'deduction'
                ? state.deductions
                : (type === 'goal'
                    ? state.goals
                    : state[type + 's']));
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
    if (newItem.targetAmount !== undefined) newItem.targetAmount = parseFloat(newItem.targetAmount) || 0;
    if (newItem.startingSaved !== undefined) newItem.startingSaved = parseFloat(newItem.startingSaved) || 0;
    if (newItem.priority !== undefined && newItem.priority !== '') newItem.priority = parseInt(newItem.priority, 10);
    if (newItem.creditLimit !== undefined) {
        const parsed = parseFloat(newItem.creditLimit);
        newItem.creditLimit = isNaN(parsed) ? null : parsed;
    }

    let targetArray = type === 'expense'
        ? state.fixedExpenses
        : (type === 'deduction'
            ? state.deductions
            : (type === 'goal'
                ? state.goals
                : state[type + 's']));

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
    let targetArray = type === 'expense'
        ? state.fixedExpenses
        : (type === 'deduction'
            ? state.deductions
            : (type === 'goal'
                ? state.goals
                : state[type + 's']));
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
window.toggleMinBreakdown = toggleMinBreakdown;
