/**
 * FREEDOM SIM - LOGIC V7.1
 * - Profile Save / Import / Export
 * - Quincenal labels
 * - Compact profile toolbar above KPIs
 */

// --- DATOS INICIALES (TU SITUACIÓN REAL) ---
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

// --- GESTIÓN DE PERFILES & ESTADO ---
const STORAGE_KEY_STATE = 'debtSimStateV7'; // legacy / compat
const STORAGE_KEY_PROFILES = 'freedomSimProfilesV1';
const STORAGE_KEY_CURRENT_PROFILE = 'freedomSimCurrentProfileId';

let profiles = [];
let currentProfileId = null;
let state = null;
let editingIndex = null;

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function normalizeImportedState(data) {
    const clone = deepClone(data || {});
    if (!Array.isArray(clone.deductions)) clone.deductions = [];
    if (!Array.isArray(clone.fixedExpenses)) clone.fixedExpenses = [];
    if (!Array.isArray(clone.debts)) clone.debts = [];
    if (!Array.isArray(clone.events)) clone.events = [];
    clone.grossIncome = Number(clone.grossIncome ?? defaultData.grossIncome) || 0;
    clone.discretionary = Number(clone.discretionary ?? defaultData.discretionary) || 0;
    clone.strategy = clone.strategy || defaultData.strategy || 'snowball';
    return clone;
}

function getSerializableState() {
    const clone = deepClone(state || {});
    delete clone.computedNet;
    delete clone.computedFixed;
    return clone;
}

function loadInitialState() {
    const storedProfilesRaw = localStorage.getItem(STORAGE_KEY_PROFILES);
    const storedCurrentId = localStorage.getItem(STORAGE_KEY_CURRENT_PROFILE);
    const legacyStateRaw = localStorage.getItem(STORAGE_KEY_STATE);

    let storedProfiles = null;
    let legacyState = null;

    try {
        storedProfiles = storedProfilesRaw ? JSON.parse(storedProfilesRaw) : null;
    } catch (e) {
        storedProfiles = null;
    }
    try {
        legacyState = legacyStateRaw ? JSON.parse(legacyStateRaw) : null;
    } catch (e) {
        legacyState = null;
    }

    if (storedProfiles && Array.isArray(storedProfiles) && storedProfiles.length > 0) {
        profiles = storedProfiles;
        if (storedCurrentId && profiles.some(p => p.id === storedCurrentId)) {
            currentProfileId = storedCurrentId;
        } else {
            currentProfileId = profiles[0].id;
        }
    } else {
        // No profiles yet: bootstrap from legacy state or defaults
        const initialState = legacyState && legacyState.debts && Array.isArray(legacyState.debts)
            ? legacyState
            : deepClone(defaultData);

        const defaultProfile = {
            id: 'p_' + Date.now().toString(16),
            name: 'Perfil 1',
            data: normalizeImportedState(initialState)
        };
        profiles = [defaultProfile];
        currentProfileId = defaultProfile.id;
        localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
        localStorage.setItem(STORAGE_KEY_CURRENT_PROFILE, currentProfileId);
    }

    const currentProfile = profiles.find(p => p.id === currentProfileId) || profiles[0];
    state = normalizeImportedState(currentProfile.data || defaultData);

    // Mantener compat con almacenamiento legado
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(getSerializableState()));
}

function persistProfiles() {
    if (!profiles || profiles.length === 0) return;
    const idx = profiles.findIndex(p => p.id === currentProfileId);
    if (idx !== -1) {
        profiles[idx].data = getSerializableState();
    }
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
    localStorage.setItem(STORAGE_KEY_CURRENT_PROFILE, currentProfileId);
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(getSerializableState()));
}

// Cargar estado inicial antes de cualquier uso
loadInitialState();

// --- UTILS ---
const $ = (id) => document.getElementById(id);
const formatMoney = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);
const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
};

// --- GESTIÓN DE PERFILES (UI) ---

function refreshProfileSelect() {
    const select = $('profileSelect');
    if (!select) return;
    select.innerHTML = '';
    profiles.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
    select.value = currentProfileId;
}

function switchProfile(id) {
    const target = profiles.find(p => p.id === id);
    if (!target) return;
    currentProfileId = id;
    state = normalizeImportedState(target.data || defaultData);

    persistProfiles();

    $('grossIncome').value = state.grossIncome || 0;
    $('discretionary').value = state.discretionary || 0;
    $('strategySelect').value = state.strategy || 'snowball';

    renderAll();
    runSimulation();
}

function createNewProfile() {
    let name = prompt('Nombre del nuevo perfil:', `Perfil ${profiles.length + 1}`);
    if (!name) name = `Perfil ${profiles.length + 1}`;
    const newProfile = {
        id: 'p_' + Date.now().toString(16) + '_' + Math.random().toString(16).slice(2),
        name,
        data: getSerializableState()
    };
    profiles.push(newProfile);
    currentProfileId = newProfile.id;
    persistProfiles();
    refreshProfileSelect();
}

function renameProfile() {
    const current = profiles.find(p => p.id === currentProfileId);
    if (!current) return;
    const newName = prompt('Nuevo nombre del perfil:', current.name);
    if (!newName) return;
    current.name = newName;
    persistProfiles();
    refreshProfileSelect();
}

function deleteCurrentProfile() {
    if (!profiles || profiles.length <= 1) {
        alert('Debes conservar al menos un perfil.');
        return;
    }
    const current = profiles.find(p => p.id === currentProfileId);
    if (!current) return;
    if (!confirm(`¿Eliminar el perfil "${current.name}"?`)) return;

    profiles = profiles.filter(p => p.id !== currentProfileId);
    currentProfileId = profiles[0].id;
    state = normalizeImportedState(profiles[0].data || defaultData);
    persistProfiles();
    refreshProfileSelect();

    $('grossIncome').value = state.grossIncome || 0;
    $('discretionary').value = state.discretionary || 0;
    $('strategySelect').value = state.strategy || 'snowball';

    renderAll();
    runSimulation();
}

function exportCurrentProfile() {
    const current = profiles.find(p => p.id === currentProfileId);
    if (!current) return;

    const payload = {
        meta: {
            app: 'FreedomSimMX',
            version: '1',
            exportedAt: new Date().toISOString()
        },
        profile: {
            name: current.name,
            data: getSerializableState()
        }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (current.name || 'perfil').replace(/[^\w\-]+/g, '_');
    a.href = url;
    a.download = `freedomSim_${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleImportFile(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target.result;
            const json = JSON.parse(text);

            let importedName = 'Perfil Importado';
            let importedData = null;

            if (json && json.profile && json.profile.data) {
                importedName = json.profile.name || importedName;
                importedData = json.profile.data;
            } else if (json && (json.grossIncome !== undefined || json.debts)) {
                importedData = json;
                if (json.profileName) importedName = json.profileName;
            }

            if (!importedData) {
                alert('El archivo no parece ser un perfil válido de FreedomSim.');
                return;
            }

            importedData = normalizeImportedState(importedData);

            const newProfile = {
                id: 'p_' + Date.now().toString(16) + '_' + Math.random().toString(16).slice(2),
                name: importedName,
                data: importedData
            };

            profiles.push(newProfile);
            currentProfileId = newProfile.id;
            state = deepClone(importedData);

            persistProfiles();
            refreshProfileSelect();

            $('grossIncome').value = state.grossIncome || 0;
            $('discretionary').value = state.discretionary || 0;
            $('strategySelect').value = state.strategy || 'snowball';

            renderAll();
            runSimulation();
        } catch (err) {
            console.error(err);
            alert('No se pudo leer el archivo de perfil.');
        } finally {
            input.value = '';
        }
    };
    reader.readAsText(file);
}

function setupProfileUI() {
    const select = $('profileSelect');
    if (select) {
        refreshProfileSelect();
        select.addEventListener('change', (e) => switchProfile(e.target.value));
    }

    const btnNew = $('btnNewProfile');
    if (btnNew) btnNew.addEventListener('click', createNewProfile);

    const btnRen = $('btnRenameProfile');
    if (btnRen) btnRen.addEventListener('click', renameProfile);

    const btnDel = $('btnDeleteProfile');
    if (btnDel) btnDel.addEventListener('click', deleteCurrentProfile);

    const btnExport = $('btnExportProfile');
    if (btnExport) btnExport.addEventListener('click', exportCurrentProfile);

    const btnImport = $('btnImportProfile');
    const importInput = $('profileImportInput');
    if (btnImport && importInput) {
        btnImport.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', handleImportFile);
    }
}

// --- INICIALIZACIÓN ---
function init() {
    $('grossIncome').value = state.grossIncome;
    $('discretionary').value = state.discretionary;
    $('strategySelect').value = state.strategy;

    attachListeners();
    setupProfileUI();

    renderAll();
    runSimulation();
}

function attachListeners() {
    // Inputs simples
    const inputs = ['grossIncome', 'discretionary'];
    inputs.forEach(id => {
        const el = $(id);
        if (el) {
            el.addEventListener('input', (e) => {
                state[id] = parseFloat(e.target.value) || 0;
                saveState();
            });
        }
    });

    // Select Estrategia
    const strat = $('strategySelect');
    if (strat) {
        strat.addEventListener('change', (e) => {
            state.strategy = e.target.value;
            saveState();
        });
    }
}

function saveState() {
    persistProfiles();
    updateSummary();
    runSimulation();
}

// --- RENDERIZADO DOM ---

function renderAll() {
    renderList('deduction', state.deductions);
    renderList('expense', state.fixedExpenses);
    renderDebts();
    renderEvents();
    updateSummary();
}

function renderList(type, list) {
    const listId = type === 'expense' ? 'expenseList' : 'deductionList';
    const el = $(listId);
    if (!el) return;
    el.innerHTML = '';
    
    list.forEach((item, i) => {
        el.innerHTML += `
            <div class="list-item" onclick="openModal('${type}', ${i})">
                <div class="list-item-content"><strong>${item.name}</strong></div>
                <div class="negative">-${formatMoney(item.amount)}</div>
            </div>`;
    });
}

function renderDebts() {
    const el = $('debtList');
    if (!el) return;
    el.innerHTML = '';
    
    state.debts.forEach((d, i) => {
        let color = d.rate > 80 ? '#ef4444' : (d.rate > 50 ? '#f59e0b' : '#3b82f6');
        el.innerHTML += `
            <div class="list-item" style="border-left-color: ${color}" onclick="openModal('debt', ${i})">
                <div class="list-item-content">
                    <strong>${d.name}</strong>
                    <small style="color:${color}">Tasa ${d.rate}%</small>
                </div>
                <div class="mono">${formatMoney(d.balance)}</div>
            </div>`;
    });
}

function renderEvents() {
    const el = $('eventList');
    if (!el) return;
    el.innerHTML = '';
    state.events.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    state.events.forEach((e, i) => {
        const isInc = e.type === 'income';
        el.innerHTML += `
            <div class="list-item" style="border-left-color: ${isInc ? 'var(--success)' : 'var(--danger)'}" onclick="openModal('event', ${i})">
                <div class="list-item-content">
                    <strong>${e.name}</strong>
                    <small>${formatDate(e.date)}</small>
                </div>
                <div class="${isInc ? 'positive' : 'negative'}">
                    ${isInc ? '+' : '-'}${formatMoney(e.amount)}
                </div>
            </div>`;
    });
}

function updateSummary() {
    const totalDeductions = state.deductions.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
    const net = state.grossIncome - totalDeductions;
    const totalFixed = state.fixedExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const available = net - totalFixed - state.discretionary;

    $('netIncomeDisplay').innerText = formatMoney(net);
    const availEl = $('availableForDebt');
    availEl.innerText = formatMoney(available);
    availEl.className = `highlight-value ${available >= 0 ? 'positive' : 'negative'}`;

    const currentTotalDebt = state.debts.reduce((sum, d) => sum + (parseFloat(d.balance) || 0), 0);
    $('totalDebtStart').innerText = formatMoney(currentTotalDebt);

    state.computedNet = net;
    state.computedFixed = totalFixed;
}

// --- SISTEMA DE MODALES ---

function openModal(type, index = null) {
    editingIndex = index;
    const modal = $(`${type}Modal`);
    const form = $(`${type}Form`);
    const deleteBtn = $(`btnDelete${type.charAt(0).toUpperCase() + type.slice(1)}`);
    
    if (!modal || !form) return;
    form.reset();

    if (index !== null) {
        if (deleteBtn) {
            deleteBtn.style.display = 'block';
            deleteBtn.onclick = () => deleteItem(type, index);
        }
        const listName = type === 'expense' ? 'fixedExpenses' : type + 's';
        const data = state[listName][index];
        for (const key in data) {
            const input = form.elements[key];
            if (input) {
                if (input.type === 'radio' && form.elements['type']) {
                    form.elements['type'].value = data[key];
                } else {
                    input.value = data[key];
                }
            }
        }
    } else {
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (type === 'event' && form.elements['date']) form.elements['date'].value = '2026-01-15';
    }

    form.onsubmit = (e) => {
        e.preventDefault();
        saveItem(type, new FormData(form));
    };
    modal.showModal();
}

function closeModal(type) {
    const modal = $(`${type}Modal`);
    if (modal && typeof modal.close === 'function') {
        modal.close();
    }
}

function saveItem(type, formData) {
    const newItem = {};
    formData.forEach((value, key) => newItem[key] = value);

    if (newItem.amount) newItem.amount = parseFloat(newItem.amount) || 0;
    if (newItem.balance) newItem.balance = parseFloat(newItem.balance) || 0;
    if (newItem.rate) newItem.rate = parseFloat(newItem.rate) || 0;

    const listName = type === 'expense' ? 'fixedExpenses' : type + 's';
    if (editingIndex !== null) state[listName][editingIndex] = newItem;
    else state[listName].push(newItem);

    closeModal(type);
    saveState();
    renderAll();
}

function deleteItem(type, index) {
    const listName = type === 'expense' ? 'fixedExpenses' : type + 's';
    state[listName].splice(index, 1);
    closeModal(type);
    saveState();
    renderAll();
}

function resetToDefaults() {
    if (confirm("¿Reiniciar este perfil a los valores originales?")) {
        state = normalizeImportedState(defaultData);
        persistProfiles();

        $('grossIncome').value = state.grossIncome || 0;
        $('discretionary').value = state.discretionary || 0;
        $('strategySelect').value = state.strategy || 'snowball';

        renderAll();
        runSimulation();
    }
}

// --- MOTOR DE SIMULACIÓN ---

function runSimulation() {
    const tbody = $('simTable').querySelector('tbody');
    tbody.innerHTML = '';

    let currentDebts = JSON.parse(JSON.stringify(state.debts));
    let currentDate = new Date('2025-12-15T00:00:00');
    let iteration = 0;
    const maxIterations = 90;

    let totalInterestPaid = 0;
    let totalDebt = currentDebts.reduce((s, d) => s + d.balance, 0);

    // Estrategia activa
    let tempDebts = [...currentDebts];
    if (state.strategy === 'snowball') tempDebts.sort((a, b) => a.balance - b.balance);
    else tempDebts.sort((a, b) => b.rate - a.rate);
    
    const targetEl = $('currentTargetName');
    if (targetEl) {
        if (tempDebts.length > 0 && tempDebts[0].balance > 0) {
            targetEl.innerText = `${tempDebts[0].name}`;
        } else {
            targetEl.innerText = "Libre";
        }
    }

    // Loop
    while (totalDebt > 100 && iteration < maxIterations) {
        iteration++;

        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();
        const currentDay = currentDate.getDate();
        const isFirstQ = currentDay <= 15;
        const displayDate = currentDate.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: '2-digit' });

        let income = state.computedNet;
        let expenses = state.computedFixed + state.discretionary;
        let notes = [];

        // Eventos por quincena
        state.events.forEach(ev => {
            const d = new Date(ev.date + 'T00:00:00');
            if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
                const evIsFirstQ = d.getDate() <= 15;
                if (isFirstQ === evIsFirstQ) {
                    if (ev.type === 'income') {
                        income += ev.amount;
                        notes.push(`+${ev.name}`);
                    } else {
                        expenses += ev.amount;
                        notes.push(`-${ev.name}`);
                    }
                }
            }
        });

        let cashAvailable = income - expenses;
        let periodInterest = 0;
        let paymentsLog = [];

        // A. Intereses
        currentDebts.forEach(d => {
            if (d.balance > 10) {
                const periodicRate = (d.rate / 100) / 24;
                const interest = d.balance * periodicRate;
                const iva = interest * 0.16;
                const charge = interest + iva;
                
                d.balance += charge;
                periodInterest += charge;
                totalInterestPaid += charge;
            }
        });

        // B. Pagos mínimos
        let remainingCash = cashAvailable;
        currentDebts.forEach(d => {
            if (d.balance <= 0) return;
            const periodicRate = (d.rate / 100) / 24;
            const financeCharge = d.balance * periodicRate * 1.16;
            const capitalPay = d.balance * 0.015;
            const minPayment = financeCharge + capitalPay;

            let payAmount = Math.min(minPayment, remainingCash);
            
            if (payAmount > 0) {
                d.balance -= payAmount;
                remainingCash -= payAmount;
            }
        });

        // C. Estrategia (excedente)
        if (state.strategy === 'snowball') currentDebts.sort((a, b) => a.balance - b.balance);
        else currentDebts.sort((a, b) => b.rate - a.rate);

        if (remainingCash > 10) {
            currentDebts.forEach(d => {
                if (remainingCash <= 0 || d.balance <= 5) return;
                
                let payAmount = Math.min(d.balance, remainingCash);
                d.balance -= payAmount;
                remainingCash -= payAmount;
                
                paymentsLog.push(`<b>${d.name}</b>: ${formatMoney(payAmount)} (Extra)`);
            });
        } else {
            if (cashAvailable > 0) paymentsLog.push("Solo Mínimos");
            else paymentsLog.push("<span class='negative'>Déficit</span>");
        }

        totalDebt = currentDebts.reduce((s, d) => s + d.balance, 0);

        // Render fila
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${iteration}</td>
            <td class="mono">${displayDate}</td>
            <td class="mono ${cashAvailable < 0 ? 'negative' : 'positive'}">${formatMoney(cashAvailable)}</td>
            <td style="color:var(--danger); font-size:0.85rem">-${formatMoney(periodInterest)}</td>
            <td style="font-size:0.8rem">${paymentsLog.length ? paymentsLog.join('<br>') : '-'}</td>
            <td class="mono" style="font-weight:bold">${formatMoney(totalDebt)}</td>
            <td style="font-size:0.75rem; color:#94a3b8">${notes.join(', ')}</td>
        `;
        tbody.appendChild(tr);

        // Avanzar quincena
        if (isFirstQ) currentDate = new Date(currentYear, currentMonth + 1, 0);
        else currentDate = new Date(currentYear, currentMonth + 1, 15);
    }

    $('totalInterestPaid').innerText = formatMoney(totalInterestPaid);
    const freedomDateEl = $('freedomDate');
    const timeEl = $('freedomTimeLeft');
    
    if (totalDebt <= 150) {
        const lastRow = tbody.lastElementChild;
        freedomDateEl.innerText = lastRow ? lastRow.children[1].innerText : "Hoy";
        freedomDateEl.style.color = 'var(--success)';
        timeEl.innerText = `${iteration} quincenas`;
    } else {
        freedomDateEl.innerText = "Deuda Infinita";
        freedomDateEl.style.color = 'var(--danger)';
        timeEl.innerText = "Interés > Pago";
    }
}

// Global exports
window.openModal = openModal;
window.closeModal = closeModal;
window.saveItem = saveItem;
window.deleteItem = deleteItem;
window.resetToDefaults = resetToDefaults;

// Start
window.onload = init;
