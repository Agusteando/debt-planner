<template>
  <div class="app-layout">
    <!-- SIDEBAR: DATA ENTRY -->
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-icon">
          <span class="material-icons-round">donut_large</span>
        </div>
        <div class="brand-text">
          <h2>FreedomSim</h2>
          <span class="version-tag">V8.3</span>
        </div>
      </div>

      <div class="scrollable-content">
        <!-- 0. SETTINGS -->
        <div class="section-group">
          <label class="section-label">Configuración</label>
          <div class="input-field">
            <label>Fecha de Inicio</label>
            <div class="input-wrapper">
              <span class="material-icons-round input-icon">calendar_today</span>
              <input type="date" id="startDate" />
            </div>
          </div>
        </div>

        <!-- 1. INCOME -->
        <div class="section-card">
          <div class="section-header">
            <h3>Ingresos (Quincenal)</h3>
          </div>
          <div class="input-field">
            <label>Sueldo Bruto</label>
            <div class="input-wrapper">
              <span class="currency-symbol">$</span>
              <input type="number" id="grossIncome" placeholder="0.00" />
            </div>
          </div>

          <div class="list-header">
            <label>Deducciones</label>
            <button class="btn-icon-small" onclick="openModal('deduction')">
              <span class="material-icons-round">add</span>
            </button>
          </div>
          <div id="deductionList" class="interactive-list"></div>

          <div class="summary-row">
            <span>Neto en Mano</span>
            <span id="netIncomeDisplay" class="value-highlight">$0.00</span>
          </div>
        </div>

        <!-- 2. EXPENSES -->
        <div class="section-card">
          <div class="section-header">
            <h3>Gastos Fijos</h3>
            <button class="btn-icon-small" onclick="openModal('expense')">
              <span class="material-icons-round">add</span>
            </button>
          </div>

          <div id="expenseList" class="interactive-list"></div>

          <div class="input-field mt-3">
            <label>Discrecional / Hormiga</label>
            <div class="input-wrapper">
              <span class="currency-symbol">$</span>
              <input type="number" id="discretionary" placeholder="0.00" />
            </div>
          </div>

          <div class="summary-row separator-top">
            <span>Cashflow Inicial</span>
            <span id="availableForDebt" class="value-highlight positive">$0.00</span>
          </div>
        </div>

        <!-- 3. DEBTS -->
        <div class="section-card">
          <div class="section-header">
            <h3>Cartera de Deudas</h3>
            <button class="btn-icon" onclick="openModal('debt')">
              <span class="material-icons-round">add_card</span>
            </button>
          </div>
          <div id="debtList" class="interactive-list"></div>
        </div>

        <!-- 3b. SAVING GOALS -->
        <div class="section-card">
          <div class="section-header">
            <h3>Metas de Ahorro</h3>
            <button class="btn-icon" onclick="openModal('goal')">
              <span class="material-icons-round">savings</span>
            </button>
          </div>
          <div id="goalList" class="interactive-list"></div>
        </div>

        <!-- 4. EVENTS -->
        <div class="section-card">
          <div class="section-header">
            <h3>Eventos Futuros</h3>
            <button class="btn-icon" onclick="openModal('event')">
              <span class="material-icons-round">event</span>
            </button>
          </div>
          <div id="eventList" class="interactive-list"></div>
        </div>

        <button class="btn-secondary full-width" onclick="resetToDefaults()">
          Restaurar Defaults
        </button>
      </div>
    </aside>

    <!-- MAIN CONTENT -->
    <main class="main-content">
      <!-- TOOLBAR -->
      <header class="top-bar">
        <div class="profile-manager">
          <div class="profile-selector">
            <span class="material-icons-round">face</span>
            <select id="profileSelect"></select>
          </div>
          <div class="profile-actions">
            <button onclick="createNewProfile()" title="Nuevo">
              <span class="material-icons-round">add</span>
            </button>
            <button onclick="renameProfile()" title="Renombrar">
              <span class="material-icons-round">edit</span>
            </button>
            <button onclick="deleteCurrentProfile()" title="Borrar">
              <span class="material-icons-round">delete</span>
            </button>
            <div class="divider"></div>
            <button onclick="exportCurrentProfile()" title="Exportar">
              <span class="material-icons-round">download</span>
            </button>
            <button
              onclick="document.getElementById('profileImportInput').click()"
              title="Importar"
            >
              <span class="material-icons-round">upload</span>
            </button>
            <input type="file" id="profileImportInput" hidden accept=".json" />
          </div>
        </div>

        <div class="dashboard-grid">
          <!-- KPI 1 -->
          <div class="kpi-card highlight-card">
            <div class="kpi-icon">
              <span class="material-icons-round">flag</span>
            </div>
            <div class="kpi-content">
              <span class="kpi-label">Libertad Financiera</span>
              <h1 id="freedomDate">---</h1>
              <span id="freedomTimeLeft" class="kpi-sub">Calculando...</span>
            </div>
          </div>

          <!-- KPI 2 -->
          <div class="kpi-card control-card">
            <span class="kpi-label">Estrategia Activa</span>
            <div class="strategy-select">
              <select id="strategySelect">
                <option value="snowball">❄️ Bola de Nieve (Menor Saldo)</option>
                <option value="avalanche">🏔️ Avalancha (Mayor Tasa)</option>
                <option value="highMin">📌 Mayor Pago Mínimo</option>
                <option value="reverseSnowball">
                  🐢 Saldo Más Grande Primero (subóptima)
                </option>
                <option value="flat">
                  ⚖️ Proporcional (extra repartido)
                </option>
              </select>
            </div>
            <div class="target-indicator">
              Target: <strong id="currentTargetName">---</strong>
            </div>
          </div>

          <!-- KPI 3 -->
          <div class="kpi-card">
            <span class="kpi-label">Deuda Total Inicial</span>
            <h2 id="totalDebtStart">---</h2>
          </div>

          <!-- KPI 4 -->
          <div class="kpi-card">
            <span class="kpi-label">Intereses Totales</span>
            <h2 id="totalInterestPaid" class="text-danger">---</h2>
          </div>
        </div>
      </header>

      <!-- SIMULATION TABLE -->
      <div class="table-wrapper">
        <div class="table-header-info">
          <div>
            <h3>Simulación de Pagos</h3>
            <small
              >La fecha es la del periodo (quincena). Los eventos se agrupan por
              mes y quincena.</small
            >
          </div>
          <button type="button" class="btn-ghost" onclick="openChartModal()">
            <span
              class="material-icons-round"
              style="font-size: 16px"
              >show_chart</span
            >
            Ver gráfica
          </button>
        </div>
        <div class="table-container">
          <table id="simTable">
            <thead>
              <tr>
                <th width="5%">#</th>
                <th width="12%">Fecha Periodo</th>
                <th width="12%">Flujo Disp.</th>
                <th width="12%">Mínimos (Todos)</th>
                <th width="12%">Estrategia (Extra)</th>
                <th width="25%">Target Atacado / Ahorro</th>
                <th width="12%">Deuda Restante</th>
                <th width="10%">Notas</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </main>

    <!-- MODAL: ACTION PLAN (RECEIPT) -->
    <dialog id="actionPlanModal" class="receipt-modal">
      <div class="receipt-wrapper">
        <div class="receipt-header">
          <h3>🧾 Plan de Acción</h3>
          <span id="receiptDate" class="receipt-date">---</span>
        </div>

        <div class="receipt-body">
          <!-- A: Money In/Out -->
          <div class="receipt-section">
            <div class="receipt-row">
              <span>Ingresos Totales (Neto + Eventos)</span>
              <span id="receiptIncome" class="mono positive"></span>
            </div>
            <div class="receipt-row">
              <span>Gastos (Fijos + Eventos + Discrecional)</span>
              <span id="receiptExpenses" class="mono negative"></span>
            </div>
            <div class="receipt-divider"></div>
            <div class="receipt-row bold highlight-row">
              <span>Dinero para Deuda / Metas</span>
              <span id="receiptAvailable" class="mono"></span>
            </div>
          </div>

          <!-- B: Minimums -->
          <div class="receipt-section">
            <h4>
              1. Pagos Obligatorios (Mínimos)
              <button
                type="button"
                class="hint-icon"
                onclick="toggleMinBreakdown()"
                title="Ver detalle del mínimo mensual y lo que falta por cubrir"
              >
                ?
              </button>
            </h4>
            <small class="section-desc">
              El simulador respeta el <strong>pago mínimo mensual real</strong> de
              cada tarjeta (el que tú capturas). Como referencia adicional se muestra
              una aproximación a la fórmula normativa de Banxico
              (1.5% del saldo + intereses mensuales + IVA vs 1.25% de la línea).
            </small>
            <div id="receiptMinList" class="receipt-list"></div>
            <div class="receipt-row subtotal">
              <span>Total Mínimos pagados en este periodo</span>
              <span id="receiptTotalMin" class="mono negative"></span>
            </div>
            <div id="receiptMinBreakdown" class="receipt-min-breakdown"></div>
          </div>

          <!-- C: Strategy -->
          <div class="receipt-section">
            <h4>2. Estrategia (Excedente a Deuda)</h4>
            <small class="section-desc"
              >El dinero que sobró después de cubrir los mínimos acelera el Target de
              la estrategia seleccionada.</small
            >
            <div id="receiptStrategyList" class="receipt-list"></div>
          </div>

          <!-- D: Goals -->
          <div class="receipt-section">
            <h4>3. Metas de Ahorro</h4>
            <small class="section-desc"
              >Una vez liquidadas las deudas, el excedente se va a tus metas (auto,
              viaje, etc.).</small
            >
            <div id="receiptSavingList" class="receipt-list"></div>
          </div>

          <!-- E: Footer -->
          <div class="receipt-footer">
            <div class="receipt-row bold">
              <span>Deuda Restante Total</span>
              <span id="receiptEndBalance" class="mono"></span>
            </div>
            <div class="receipt-row">
              <span>Dinero Sobrante (Bolsa para siguiente quincena)</span>
              <span id="receiptPocket" class="mono"></span>
            </div>
          </div>
        </div>

        <div class="receipt-actions">
          <button
            type="button"
            class="btn-primary full-width"
            onclick="document.getElementById('actionPlanModal').close()"
          >
            Entendido
          </button>
        </div>
      </div>
    </dialog>

    <!-- MODAL: CHART -->
    <dialog id="chartModal" class="chart-modal">
      <div class="chart-modal-header">
        <h3>Evolución de deuda vs bolsa</h3>
        <button type="button" class="btn-ghost" onclick="closeChartModal()">
          <span class="material-icons-round" style="font-size: 16px">close</span>
          Cerrar
        </button>
      </div>
      <div class="chart-modal-body">
        <div class="chart-modal-body-inner">
          <canvas id="simChart"></canvas>
        </div>
      </div>
    </dialog>

    <!-- EDIT MODALS -->
    <dialog id="debtModal" class="editor-modal editor-modal-wide">
      <form method="dialog" id="debtForm">
        <h3>Tarjeta / Deuda</h3>
        <div class="input-field">
          <label>Nombre</label>
          <input type="text" name="name" required />
        </div>
        <div class="row">
          <div class="input-field">
            <label>Saldo</label>
            <input type="number" name="balance" step="0.01" required />
          </div>
          <div class="input-field">
            <label>Tasa Anual (%)</label>
            <input type="number" name="rate" step="0.01" required />
          </div>
        </div>
        <div class="row">
          <div class="input-field">
            <label>Límite de crédito (opcional)</label>
            <input type="number" name="creditLimit" step="0.01" />
          </div>
          <div class="input-field">
            <label>Pago Mínimo Mensual (real)</label>
            <input
              type="number"
              name="monthlyMin"
              step="0.01"
              placeholder="Monto del estado de cuenta"
            />
          </div>
        </div>
        <div class="row">
          <div class="input-field">
            <label>Día de Pago (1-31)</label>
            <input
              type="number"
              name="dueDay"
              min="1"
              max="31"
              step="1"
              placeholder="Día de vencimiento"
            />
          </div>
        </div>

        <!-- Per-card schedule / progress -->
        <div class="debt-schedule-section">
          <h4>Proyección para esta tarjeta</h4>
          <div id="debtScheduleContainer">
            <small style="color: var(--text-muted)">
              La proyección se genera a partir de la simulación actual. Edita los
              datos y guarda para recalcular.
            </small>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn-text" onclick="closeModal('debt')">
            Cancelar
          </button>
          <button
            type="button"
            class="btn-danger"
            id="btnDeleteDebt"
            style="display: none"
          >
            Eliminar
          </button>
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
      </form>
    </dialog>

    <dialog id="expenseModal" class="editor-modal">
      <form method="dialog" id="expenseForm">
        <h3>Gasto Fijo</h3>
        <div class="input-field">
          <label>Concepto</label>
          <input type="text" name="name" required />
        </div>
        <div class="input-field">
          <label>Monto Quincenal</label>
          <input type="number" name="amount" step="0.01" required />
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-text" onclick="closeModal('expense')">
            Cancelar
          </button>
          <button
            type="button"
            class="btn-danger"
            id="btnDeleteExpense"
            style="display: none"
          >
            Eliminar
          </button>
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
      </form>
    </dialog>

    <dialog id="deductionModal" class="editor-modal">
      <form method="dialog" id="deductionForm">
        <h3>Deducción de Nómina</h3>
        <div class="input-field">
          <label>Concepto</label>
          <input type="text" name="name" required />
        </div>
        <div class="input-field">
          <label>Monto</label>
          <input type="number" name="amount" step="0.01" required />
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-text" onclick="closeModal('deduction')">
            Cancelar
          </button>
          <button
            type="button"
            class="btn-danger"
            id="btnDeleteDeduction"
            style="display: none"
          >
            Eliminar
          </button>
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
      </form>
    </dialog>

    <dialog id="eventModal" class="editor-modal">
      <form method="dialog" id="eventForm">
        <h3>Evento Extraordinario</h3>
        <div class="input-field">
          <label>Nombre</label>
          <input type="text" name="name" required />
        </div>
        <div class="input-field">
          <label>Tipo</label>
          <div class="toggle-switch">
            <input type="radio" id="evInc" name="type" value="income" checked />
            <label for="evInc">Ingreso (+)</label>
            <input type="radio" id="evExp" name="type" value="expense" />
            <label for="evExp">Gasto (-)</label>
          </div>
        </div>
        <div class="row">
          <div class="input-field">
            <label>Monto</label>
            <input type="number" name="amount" step="0.01" required />
          </div>
          <div class="input-field">
            <label>Fecha</label>
            <input type="date" name="date" required />
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-text" onclick="closeModal('event')">
            Cancelar
          </button>
          <button
            type="button"
            class="btn-danger"
            id="btnDeleteEvent"
            style="display: none"
          >
            Eliminar
          </button>
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
      </form>
    </dialog>

    <dialog id="goalModal" class="editor-modal">
      <form method="dialog" id="goalForm">
        <h3>Meta de Ahorro</h3>
        <div class="input-field">
          <label>Nombre</label>
          <input type="text" name="name" required />
        </div>
        <div class="row">
          <div class="input-field">
            <label>Monto objetivo</label>
            <input type="number" name="targetAmount" step="0.01" required />
          </div>
          <div class="input-field">
            <label>Ahorro inicial</label>
            <input type="number" name="startingSaved" step="0.01" />
          </div>
        </div>
        <div class="input-field">
          <label>Prioridad (1 = primero)</label>
          <input type="number" name="priority" min="1" step="1" />
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-text" onclick="closeModal('goal')">
            Cancelar
          </button>
          <button
            type="button"
            class="btn-danger"
            id="btnDeleteGoal"
            style="display: none"
          >
            Eliminar
          </button>
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<script>
export default {
  name: 'App'
};
</script>