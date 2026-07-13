class ReefBotPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = undefined;
    this._lastRender = 0;
    this._narrow = false;
    this._lastPressed = undefined;
    this._confirmAction = undefined;
    this._activeDialog = undefined;
    this._activeVial = undefined;
  }

  set hass(hass) {
    this._hass = hass;
    const now = Date.now();
    if (!this.shadowRoot.innerHTML || now - this._lastRender > 750) {
      this._lastRender = now;
      this.render();
    }
  }

  connectedCallback() {
    this.render();
    this._progressTimer = window.setInterval(() => {
      if (this._hass && isChamberActive(buildModel(this._hass, this._lastPressed))) {
        this.render();
      }
    }, 30000);
  }

  disconnectedCallback() {
    if (this._progressTimer) {
      window.clearInterval(this._progressTimer);
      this._progressTimer = undefined;
    }
  }

  set narrow(value) {
    this._narrow = Boolean(value);
    this.updateMenuButton();
  }

  get narrow() {
    return this._narrow;
  }

  render() {
    if (!this._hass) {
      this.shadowRoot.innerHTML = `<style>${styles}</style><main class="page"><div class="empty">Loading ReefBot...</div></main>`;
      return;
    }

    const model = buildModel(this._hass, this._lastPressed);
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <main class="page">
        <section class="shell">
          ${renderHeader(model)}
          <section class="content-grid">
            <section class="center-stack">
              ${renderTests(model)}
              ${renderOperationStrip(model)}
              ${renderMachine(model)}
              ${renderMaintenance(model)}
            </section>
          </section>
        </section>
        ${renderConfirmDialog(this._confirmAction)}
        ${renderAlarmDialog(model, this._activeDialog === "alarms")}
        ${renderVialDialog(model, this._activeVial)}
      </main>
    `;

    this.shadowRoot.querySelectorAll("[data-press]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.pressButton(button);
      });
    });
    this.shadowRoot.querySelectorAll("[data-more-info]").forEach((element) => {
      element.addEventListener("click", (event) => {
        if (element.tagName !== "BUTTON" && event.target?.closest?.("button")) return;
        this.showMoreInfo(element.dataset.moreInfo);
      });
    });
    this.shadowRoot.querySelectorAll("[data-menu]").forEach((button) => {
      button.addEventListener("click", () => this.toggleMenu());
    });
    this.shadowRoot.querySelectorAll("[data-dialog]").forEach((button) => {
      button.addEventListener("click", () => {
        this._activeDialog = button.dataset.dialog;
        this._activeVial = undefined;
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-vial-open]").forEach((element) => {
      element.addEventListener("click", (event) => {
        if (event.target?.closest?.("button")) return;
        this._activeDialog = undefined;
        this._activeVial = Number(element.dataset.vialOpen);
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-dialog-card]").forEach((card) => {
      card.addEventListener("click", (event) => event.stopPropagation());
    });
    this.shadowRoot.querySelectorAll("[data-dialog-close]").forEach((button) => {
      button.addEventListener("click", () => this.closeDialog());
    });
    this.shadowRoot.querySelectorAll("[data-confirm-start]").forEach((button) => {
      button.addEventListener("click", () => this.confirmPendingAction());
    });
    this.updateMenuButton();
  }

  pressButton(button) {
    const entityId = button?.dataset?.press;
    if (!entityId || !this._hass) return;
    const name = button.dataset.label || entityName(this._hass.states[entityId]) || entityId;
    const kind = button.dataset.kind;
    if (kind === "test" || kind === "refill") {
      this._activeVial = undefined;
      this._confirmAction = { entityId, name, kind };
      this.render();
      return;
    }
    this.executeButtonPress({ entityId, name, kind });
  }

  executeButtonPress(action) {
    const { entityId, name, kind } = action || {};
    if (!entityId || !this._hass) return;
    this._lastPressed = kind === "test"
      ? {
        entityId,
        name,
        time: Date.now(),
        kind,
      }
      : undefined;
    this._confirmAction = undefined;
    this.render();
    this._hass.callService("button", "press", { entity_id: entityId });
    this.refreshReefBotEntities();
  }

  confirmPendingAction() {
    const action = this._confirmAction;
    this._confirmAction = undefined;
    this.executeButtonPress(action);
  }

  closeDialog() {
    this._confirmAction = undefined;
    this._activeDialog = undefined;
    this._activeVial = undefined;
    this.render();
  }

  showMoreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      })
    );
  }

  refreshReefBotEntities() {
    if (!this._hass) return;
    const entities = Object.values(this._hass.states)
      .filter((state) => state.entity_id.startsWith("sensor.") || state.entity_id.startsWith("binary_sensor."))
      .filter((state) => isReefBotEntity(state))
      .map((state) => state.entity_id);
    if (!entities.length) return;

    [1000, 5000, 15000].forEach((delay) => {
      window.setTimeout(() => {
        this._hass.callService("homeassistant", "update_entity", { entity_id: entities });
      }, delay);
    });
  }

  toggleMenu() {
    this.dispatchEvent(
      new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })
    );
  }

  updateMenuButton() {
    const button = this.shadowRoot?.querySelector("[data-menu]");
    if (button) {
      button.hidden = !this._narrow;
    }
  }
}

customElements.define("reefbot-panel", ReefBotPanel);

const TEST_DURATIONS_MINUTES = [
  { names: ["RedSea Alkalinity", "RedSea Alkalinity Pro", "Red Sea Alkalinity Pro"], minutes: 26 },
  { names: ["RedSea Phosphate Pro Low Range", "RedSea PO4 Pro Low Range", "RedSea PO4 Pro Low Range 13 drops"], minutes: 57 },
  { names: ["RedSea Phosphate Pro High Range", "RedSea PO4 Pro High Range"], minutes: 57 },
  { names: ["RedSea Calcium"], minutes: 37 },
  { names: ["RedSea Magnesium"], minutes: 59 },
  { names: ["Fauna Marin AquaHome Nitrate", "Fauna Marin NO3", "FaunaMarin NO3"], minutes: 50 },
  { names: ["Fauna Marin AquaHome Nitrite", "Fauna Marin AquaHome NO2", "FaunaMarin NO2"], minutes: 50 },
  { names: ["Fauna Marin Aquahome Phospate", "Fauna Marin AquaHome Phosphate"], minutes: 45 },
  { names: ["Fauna Marin KH"], minutes: 37 },
  { names: ["Colombo phosphate", "Colombo PO4", "Colombo PO4 Saltwater"], minutes: 55 },
  { names: ["Colombo KH Aquatest"], minutes: 37 },
  { names: ["Colombo Magnesium"], minutes: 59 },
  { names: ["Colombo Ammonia"], minutes: 59 },
  { names: ["Colombo pH fresh"], minutes: 20 },
  { names: ["Colombo GH"], minutes: 15 },
  { names: ["Colombo Iron"], minutes: 60 },
  { names: ["Colombo Silicate"], minutes: 45 },
  { names: ["Colombo Nitrite"], minutes: 59 },
  { names: ["API Alkalinity"], minutes: 24 },
  { names: ["API Calcium"], minutes: 36 },
  { names: ["API Nitrate"], minutes: 49 },
  { names: ["API Nitrite"], minutes: 32 },
  { names: ["API Phosphate"], minutes: 45 },
  { names: ["API Ammonia"], minutes: 38 },
  { names: ["API GH"], minutes: 21 },
  { names: ["API Copper"], minutes: 40 },
  { names: ["API pH Fresh"], minutes: 22 },
  { names: ["API High Range pH"], minutes: 24 },
  { names: ["Tropic Marin Nitrate Pro"], minutes: 59 },
  { names: ["Tropic Marin Nitrite Pro"], minutes: 59 },
  { names: ["Tropic Marin Phosphate Pro"], minutes: 41 },
  { names: ["Tropic Marin KH"], minutes: 45 },
  { names: ["Tropic Marin KH Pro"], minutes: 37 },
  { names: ["Tropic Marin GH"], minutes: 45 },
  { names: ["Tropic Marin pH fresh"], minutes: 24 },
  { names: ["Tropic Marin pH salt"], minutes: 24 },
  { names: ["Salifert alkalinity"], minutes: 35 },
  { names: ["Salifert Calcium"], minutes: 59 },
  { names: ["Salifert Ammonia"], minutes: 48 },
  { names: ["Salifert GH"], minutes: 24 },
  { names: ["Salifert pH"], minutes: 24 },
  { names: ["Giesemann Phosphate"], minutes: 49 },
  { names: ["Giesemann Magnesium"], minutes: 59 },
  { names: ["Giesemann Alkalinity"], minutes: 48 },
  { names: ["Giesemann Ammonia"], minutes: 59 },
  { names: ["Giesmann Nitrite"], minutes: 20 },
  { names: ["Giesmann Iron"], minutes: 40 },
  { names: ["Giesmann Ammonium"], minutes: 60 },
  { names: ["Giesemann Aquaristic Iodine", "Giesemann Aquaristic lodine"], minutes: 45 },
  { names: ["Elos KH Wateranalysis"], minutes: 24 },
  { names: ["Elos Cu Wateranalysis"], minutes: 37 },
  { names: ["Elos Phosphate"], minutes: 35 },
  { names: ["Elos Ammonium"], minutes: 52 },
  { names: ["Elos pH"], minutes: 20 },
  { names: ["Elos GH"], minutes: 20 },
  { names: ["Elos Iron"], minutes: 40 },
  { names: ["Elos NO2 wateranalysis"], minutes: 24 },
  { names: ["NTLABS Phosphate Fresh"], minutes: 24 },
  { names: ["NTLABS Phosphate Marine"], minutes: 59 },
  { names: ["NTLABS Nitrate"], minutes: 48 },
  { names: ["NTLABS Calcium"], minutes: 48 },
  { names: ["NTLABS Ammonia"], minutes: 50 },
  { names: ["NTLABS Nitrite"], minutes: 25 },
  { names: ["NTLABS Marine Alkalinity"], minutes: 24 },
  { names: ["NTLABS Alkalinity"], minutes: 36 },
  { names: ["NTLABS pH Marine"], minutes: 24 },
  { names: ["NTLABS pH Freshwater"], minutes: 24 },
  { names: ["NTLABS General Hardness"], minutes: 37 },
  { names: ["Aquaforest Alkalinity"], minutes: 41 },
  { names: ["JBL Alkalinity"], minutes: 37 },
  { names: ["JBL General Hardness"], minutes: 20 },
  { names: ["JBL Silicate"], minutes: 45 },
  { names: ["JBL Carbon dioxide"], minutes: 37 },
  { names: ["JBL Iron"], minutes: 37 },
  { names: ["JBL pH"], minutes: 37 },
  { names: ["H2Ocean Magnesium"], minutes: 59 },
  { names: ["H2Ocean Alkalinity"], minutes: 27 },
  { names: ["Monitor Calcium Saltwater"], minutes: 37 },
  { names: ["Monitor Calcium Freshwater"], minutes: 37 },
  { names: ["Monitor Alkalinity Reef"], minutes: 35 },
  { names: ["Monitor Total Alkalinity"], minutes: 35 },
  { names: ["Monitor Ammonia"], minutes: 37 },
];

function buildModel(hass, lastPressed) {
  const states = Object.values(hass.states);
  const configuredTests = states
    .filter(isConfiguredTestSensor)
    .map((state) => ({
      entityId: state.entity_id,
      name: state.attributes.display_name || state.attributes.friendly_name || state.entity_id,
      parameter: state.state,
      operationName: state.attributes.operation_name,
      method: state.attributes.method,
      chemicals: Array.isArray(state.attributes.chemicals) ? state.attributes.chemicals : [],
      latest: state.attributes.latest_result,
      operationId: state.attributes.available_operation_id,
      button: findTestButton(states, [
        state.attributes.display_name,
        state.attributes.operation_name,
        state.attributes.method,
        state.state,
      ], state.attributes.available_operation_id),
    }));

  const tubes = states
    .filter((state) => state.entity_id.startsWith("sensor.") && state.attributes?.tube_number)
    .sort((a, b) => Number(a.attributes.tube_number) - Number(b.attributes.tube_number))
    .map((state) => {
      const number = Number(state.attributes.tube_number);
      return {
        entityId: state.entity_id,
        number,
        name: state.attributes.chemical_display_name || state.attributes.friendly_name || `Tube ${number}`,
        shortName: shortenChemical(state.attributes.chemical_display_name || state.attributes.friendly_name || `Tube ${number}`),
        current: numberValue(state.attributes.current_volume ?? state.state),
        capacity: numberValue(state.attributes.capacity) ?? 20,
        percentage: clamp(numberValue(state.attributes.fill_percentage) ?? percent(state.attributes.current_volume ?? state.state, state.attributes.capacity ?? 20), 0, 100),
        unit: state.attributes.unit || state.attributes.unit_of_measurement || "mL",
        color: chemicalColor(state.attributes.chemical_display_name || state.attributes.friendly_name || "", number),
        refillButton: findTubeRefillButton(states, number),
      };
    });

  const tests = states
    .filter(isParameterSensor)
    .sort((a, b) => (a.attributes.parameter_name || a.attributes.friendly_name || "").localeCompare(b.attributes.parameter_name || b.attributes.friendly_name || ""))
    .slice(0, 6)
    .map((state) => {
      const parameterName = state.attributes.parameter_name || state.attributes.friendly_name || state.entity_id;
      const configured = findConfiguredTestForParameter(configuredTests, parameterName);
      return {
        entityId: state.entity_id,
        name: configured?.name || parameterName,
        value: state.state,
        unit: state.attributes.unit_of_measurement || "",
        history: extractHistory(state),
        operationName: configured?.name,
        button: configured?.button || findTestButton(states, [parameterName]),
      };
    });

  return {
    tubes,
    tests,
    configuredTests,
    rodi: componentModel(states, "rodi", ["rodi", "rodi tank", "ro tank"]),
    waste: componentModel(states, "waste", ["waste"]),
    syringe: componentModel(states, "syringe", ["syringe"]),
    online: findOnline(states),
    currentOperation: findCurrentOperationSensor(states),
    pending: findPendingOperationsSensor(states),
    currentTestDuration: findTimingSensor(states, "current_test_duration"),
    currentTestElapsed: findTimingSensor(states, "current_test_elapsed_time"),
    currentTestRemaining: findTimingSensor(states, "current_test_remaining_time"),
    currentTestProgress: findTimingSensor(states, "current_test_progress"),
    recentOperation: recentOperationFromHistory(findPendingOperationsSensor(states), configuredTests),
    lastPressed,
    notifications: findNotificationsSensor(states),
    alarmLogs: findReefBotByName(states, ["alarm logs", "alarm log", "alarm history", "alarmhistorie", "alarme"]),
    safeMargins: findReefBotByName(states, ["safe margins", "sicherheitsbereiche"]),
    configuredTestsSummary: findReefBotByName(states, ["configured tests", "konfigurierte tests"]),
    lastUpdate: findReefBotByName(states, ["last update", "letzte aktualisierung"]),
    lastSuccessfulTest: findReefBotByName(states, ["last successful test", "letzter erfolgreicher test"]),
  };
}

function renderHeader(model) {
  const online = model.online;
  const onlineText = online ? (online.state === "on" ? "Online" : "Offline") : "Unknown";
  const onlineClass = online?.state === "on" ? "good" : "warn";
  return `
    <header class="header">
      <button class="menu-button" data-menu hidden title="Open sidebar">
        <ha-icon icon="mdi:menu"></ha-icon>
      </button>
      <div class="brand-mark">
        <span></span><span></span><span></span><i></i>
      </div>
      <div>
        <h1>ReefBot</h1>
        <p>Reagent control, tests, and maintenance</p>
      </div>
      <div class="header-metrics">
        ${headerChip("Status", onlineText, online?.entity_id, onlineClass)}
        ${headerChip("Pending operation", pendingOperationLabel(model), model.currentOperation?.entity_id)}
        ${headerChip("Last operation", lastOperationLabel(model), model.currentOperation?.entity_id)}
        ${headerChip("Alarms & status", alarmSummary(model), model.alarmLogs?.entity_id || model.notifications?.entity_id, alarmClass(model), "alarms")}
      </div>
    </header>
  `;
}

function headerChip(label, value, entityId, valueClass = "", dialog = "") {
  return `
    <div class="header-chip" ${dialog ? `data-dialog="${dialog}"` : entityId ? `data-more-info="${entityId}"` : ""}>
      <b class="${valueClass}">${escapeHtml(value ?? "-")}</b>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function pendingOperationLabel(model) {
  const operation = chamberOperation(model);
  if (operation.active && operation.name) return displayOperationName(operation.name);
  const count = numberValue(model.pending?.state);
  if (count && count > 0) return `${count} pending`;
  return "Ruhezustand";
}

function lastOperationLabel(model) {
  return displayOperationName(model.recentOperation?.name, "-");
}

function alarmSummary(model) {
  const logs = numberValue(model.alarmLogs?.state);
  const notifications = notificationRows(model).length;
  const count = (logs || 0) + notifications;
  if (logs === undefined && !notifications) return "-";
  return count === 0 ? "0 Meldungen" : `${count} Meldungen`;
}

function alarmClass(model) {
  const logs = numberValue(model.alarmLogs?.state);
  return (logs && logs > 0) || notificationRows(model).some((row) => row.alert) ? "warn" : "";
}

function renderConfirmDialog(action) {
  if (!action) return "";
  const isRefill = action.kind === "refill";
  const title = isRefill ? "Füllstand zurücksetzen?" : "Test starten?";
  const message = isRefill
    ? `ReefBot setzt <strong>${escapeHtml(action.name)}</strong> auf voll. Bitte nur bestätigen, wenn das Röhrchen wirklich aufgefüllt wurde.`
    : `ReefBot startet den Test <strong>${escapeHtml(action.name)}</strong>. Währenddessen sollten keine weiteren Tests gestartet werden.`;
  const buttonLabel = isRefill ? "Auffüllen bestätigen" : "Test starten";
  return `
    <div class="dialog-backdrop" data-dialog-close>
      <section class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="confirm-action-title" data-dialog-card>
        <h2 id="confirm-action-title">${escapeHtml(title)}</h2>
        <p>${message}</p>
        <div class="dialog-actions">
          <button class="ghost" data-dialog-close>Abbrechen</button>
          <button class="primary ${isRefill ? "danger" : ""}" data-confirm-start>${escapeHtml(buttonLabel)}</button>
        </div>
      </section>
    </div>
  `;
}

function renderAlarmDialog(model, open) {
  if (!open) return "";
  const logs = alarmRows(model).map((log) => ({
    title: log.parameter || log.message || "Alarm",
    date: log.date,
    detail: alarmDetail(log),
    type: "Alarm",
    alert: true,
  }));
  const notifications = notificationRows(model);
  const rows = [...logs, ...notifications];
  const renderedRows = rows.length
    ? rows.map((row) => `
      <li>
        <b>${escapeHtml(row.title)}</b>
        <span>${escapeHtml([row.type, formatAlarmDate(row.date)].filter(activeState).join(" · "))}</span>
        <small>${escapeHtml(row.detail)}</small>
      </li>
    `).join("")
    : `<li class="empty-row">Keine Alarm- oder Statusmeldungen in der Integration gefunden.</li>`;
  return `
    <div class="dialog-backdrop" data-dialog-close>
      <section class="dialog-card alarm-dialog" role="dialog" aria-modal="true" aria-labelledby="alarm-log-title" data-dialog-card>
        <h2 id="alarm-log-title">Alarme & Status</h2>
        <p>Alarmhistorie und die letzten von Reef Kinetics gelieferten Statusmeldungen.</p>
        <ul class="alarm-list">${renderedRows}</ul>
        <div class="dialog-actions">
          ${model.notifications?.entity_id ? `<button class="ghost" data-more-info="${model.notifications.entity_id}">Status-Verlauf</button>` : ""}
          ${model.alarmLogs?.entity_id ? `<button class="ghost" data-more-info="${model.alarmLogs.entity_id}">Alarm-Verlauf</button>` : ""}
          <button class="primary" data-dialog-close>Schließen</button>
        </div>
      </section>
    </div>
  `;
}

function alarmRows(model) {
  const logs = model.alarmLogs?.attributes?.logs;
  return Array.isArray(logs) ? logs.filter((log) => log && typeof log === "object") : [];
}

function notificationRows(model) {
  const notifications = model.notifications?.attributes?.notifications;
  if (!Array.isArray(notifications)) return [];
  return notifications
    .filter((item) => item && typeof item === "object")
    .slice(0, 10)
    .map((item) => {
      const parsed = parseNotificationMessage(item.message);
      const title = item.title || parsed.title || (parsed.alert ? "Alarm" : "Statusmeldung");
      return {
        title,
        date: item.date || parsed.date,
        detail: parsed.detail || item.message || "Keine weiteren Details",
        type: parsed.alert ? "Alarm" : "Status",
        alert: parsed.alert,
      };
    });
}

function parseNotificationMessage(message) {
  const text = String(message || "").trim();
  const parts = text.split("|").map((part) => part.trim()).filter(Boolean);
  const date = parts.find((part) => !Number.isNaN(Date.parse(part)));
  const messageText = parts.find((part) => !["not read", "read"].includes(part.toLowerCase()) && part !== date) || text;
  const alert = /alert|alarm|threshold|warning|error|empty|waste/i.test(messageText);
  return {
    title: alert ? "Alarm" : "Statusmeldung",
    detail: messageText,
    date,
    alert,
  };
}

function findNotificationsSensor(states) {
  return findReefBotByName(states, ["notifications", "benachrichtigungen", "statusmeldungen"])
    || Object.values(states).find((state) => (
      state.entity_id.startsWith("sensor.")
      && isReefBotEntity(state)
      && Array.isArray(state.attributes?.notifications)
    ));
}

function alarmDetail(log) {
  const details = [
    log.message,
    log.value !== undefined && log.value !== null ? `Value: ${log.value}` : undefined,
    log.status ? `Status: ${log.status}` : undefined,
  ].filter(activeState);
  return details.join(" · ") || "Keine weiteren Details";
}

function formatAlarmDate(value) {
  if (!activeState(value)) return "Zeitpunkt unbekannt";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

function renderTests(model) {
  const tests = model.tests.length ? model.tests : model.configuredTests;
  const testStartLocked = isTestStartLocked(model);
  const cards = tests.slice(0, 5).map((test) => {
    const button = test.button;
    const disabled = !button || testStartLocked ? "disabled" : "";
    const title = testStartLocked ? "ReefBot is busy" : "Start test";
    const trend = testTrendSummary(test.history, test.unit);
    return `
      <article class="test-card" ${test.entityId ? `data-more-info="${test.entityId}"` : ""} title="Open history">
        <div class="test-card-head">
          <button class="play" ${button ? `data-press="${button.entity_id}" data-kind="test" data-label="${escapeHtml(test.operationName || test.name)}"` : ""} ${disabled} title="${title}">
            <ha-icon icon="mdi:play"></ha-icon>
          </button>
          <div class="test-main">
            <strong>${escapeHtml(test.name)}</strong>
            <span>${escapeHtml(trend.label)}</span>
          </div>
          <div class="test-reading">
            <b>${escapeHtml(formatReading(test.value, test.unit))}</b>
            ${trend.delta ? `<small class="${trend.deltaClass}">${escapeHtml(trend.delta)}</small>` : ""}
          </div>
        </div>
        ${resultTrend(test.history)}
      </article>
    `;
  }).join("");

  return `
    <section class="tests">
      <div class="section-title">
        <h2>Tests</h2>
        <span>${model.pending?.state && model.pending.state !== "0" ? `${escapeHtml(model.pending.state)} pending` : "Ready"}</span>
      </div>
      <div class="test-grid">${cards || `<div class="empty compact">No test entities found yet.</div>`}</div>
    </section>
  `;
}

function isTestStartLocked(model) {
  return isChamberActive(model) || (numberValue(model.pending?.state) || 0) > 0;
}

function renderOperationStrip(model) {
  const chamber = chamberOperation(model);
  const active = isChamberActive(model);
  const progress = active ? chamberProgress(chamber, model) : undefined;
  const pendingCount = numberValue(model.pending?.state) || 0;
  const label = active ? "Aktueller Test" : model.recentOperation?.name ? "Letzter Vorgang" : "Status";
  const operation = active
    ? displayOperationName(chamber.name, "Aktiver Test")
    : displayOperationName(model.recentOperation?.name, "Ruhezustand");
  const percent = active && progress ? Math.round(progress.percent) : 0;
  const progressStyle = `--progress:${clamp(percent, 0, 100)}%`;
  const remaining = active ? (progress ? formatRemaining(progress.remainingMs) : "läuft") : "Ruhezustand";
  const duration = active && progress ? `${progress.durationMinutes} min` : "";
  const pendingText = pendingCount === 1 ? "1 wartend" : `${pendingCount} wartend`;
  const meta = active ? (progress ? `${percent}% · ${duration}` : "Dauer offen") : pendingText;

  return `
    <section class="operation-strip ${active ? "active" : "idle"}" style="${progressStyle}" ${model.currentOperation?.entity_id ? `data-more-info="${model.currentOperation.entity_id}"` : ""}>
      <div class="operation-strip-main">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(operation)}</strong>
      </div>
      <b class="operation-strip-time">${escapeHtml(remaining)}</b>
      <span class="operation-strip-meta">${escapeHtml(meta)}</span>
    </section>
  `;
}

function renderMachine(model) {
  const vialCount = Math.max(8, model.tubes.length || 8);
  const totalSlots = vialCount + 1;
  const tubes = Array.from({ length: vialCount }, (_, index) => model.tubes[index] || emptyTube(index + 1));
  const active = isChamberActive(model);
  const chamber = chamberOperation(model);
  const activeTubes = activeTubeNumbers(model, chamber.name, vialCount);
  const sourceA = activeTubes[0] || 1;
  const sourceB = activeTubes[1] || sourceA;
  const frameStyle = [
    `--total-slots:${totalSlots}`,
    `--slot-template:repeat(${vialCount}, minmax(60px, 1fr)) minmax(60px, 1fr)`,
    `--source-a-left:${slotLeft(sourceA, totalSlots)}`,
    `--source-b-left:${slotLeft(sourceB, totalSlots)}`,
    `--chamber-left:${slotLeft(totalSlots, totalSlots)}`,
  ].join("; ");
  return `
    <section class="machine">
      <div class="machine-frame ${active ? "active-test" : ""}" style="${frameStyle}">
        <div class="corner-accent left"></div>
        <div class="corner-accent right"></div>
        <div class="rail"><span></span></div>
        <svg class="energy-chain" viewBox="0 0 1000 72" preserveAspectRatio="none" aria-hidden="true">
          <path class="chain-shadow" d="M930 16 H610 C548 16 548 52 610 52 H760" />
          <path class="chain-links" d="M930 16 H610 C548 16 548 52 610 52 H760" />
        </svg>
        <div class="syringe-carriage">
          <div class="syringe-block"></div>
          <div class="syringe-z">
            <div class="syringe-guide"></div>
            <div class="syringe-body"><span></span></div>
            <div class="syringe-needle"></div>
          </div>
        </div>
        <div class="gantry"></div>
        <div class="vial-row">
          ${tubes.map((tube) => renderVial(tube, active)).join("")}
          ${renderChamberVial(model)}
        </div>
      </div>
    </section>
  `;
}

function renderChamberVial(model) {
  const pendingValue = activeState(model.pending?.state) ? model.pending.state : "0";
  const chamber = chamberOperation(model);
  const operation = displayOperationName(chamber.name, "Ruhezustand");
  const active = isChamberActive(model);
  const prefix = active ? "Live: " : model.recentOperation ? "Last: " : "";
  const progress = active ? chamberProgress(chamber, model) : undefined;
  return `
    <article class="vial-card chamber-slot">
      <div class="chamber-vial ${active ? "active" : ""}">
        <div class="measure-beam beam-left"></div>
        <div class="measure-beam beam-right"></div>
        <i></i>
        <span class="swirl one"></span>
        <span class="swirl two"></span>
        <span class="stir-bar"></span>
      </div>
      <strong class="chamber-label">Test Chamber</strong>
      <div class="chamber-operation ${active ? "live" : "last"}">
        <span>${escapeHtml(prefix.replace(":", ""))}</span>
        <b>${escapeHtml(operation)}</b>
      </div>
      ${progress ? renderChamberProgress(progress) : `<small>${escapeHtml(pendingValue)} pending</small>`}
    </article>
  `;
}

function renderVial(tube, locked = false) {
  const height = clamp(tube.percentage * 0.76, 4, 76);
  const label = `${formatNumber(tube.current)} ${tube.unit}`;
  const refillLabel = `Röhrchen ${tube.number} auffüllen: ${tube.shortName}`;
  return `
    <article class="vial-card ${locked ? "locked" : "clickable"}" ${locked ? "" : `data-vial-open="${tube.number}"`}>
      <div class="vial-cap"></div>
      <div class="vial" style="--fill:${height}%; --liquid:${tube.color}">
        <span>${escapeHtml(label)}</span>
        <em>20 mL</em>
        <i></i>
        <button class="vial-refill" ${tube.refillButton && !locked ? `data-press="${tube.refillButton.entity_id}" data-kind="refill" data-label="${escapeHtml(refillLabel)}"` : "disabled"} title="Röhrchen auffüllen">
          <ha-icon icon="mdi:reload"></ha-icon>
        </button>
      </div>
      <p class="vial-name">
        <strong class="vial-number">${tube.number}</strong>
        <span class="vial-label">${escapeHtml(tube.shortName)}</span>
      </p>
    </article>
  `;
}

function renderVialDialog(model, activeVial) {
  if (!activeVial || isChamberActive(model)) return "";
  const tube = model.tubes.find((item) => item.number === activeVial) || emptyTube(activeVial);
  const height = clamp(tube.percentage * 0.76, 4, 76);
  const current = `${formatNumber(tube.current)} ${tube.unit}`;
  const capacity = `${formatNumber(tube.capacity)} ${tube.unit}`;
  const percentage = `${Math.round(tube.percentage)}%`;
  const refillLabel = `Röhrchen ${tube.number} auffüllen: ${tube.shortName}`;
  return `
    <div class="dialog-backdrop" data-dialog-close>
      <section class="dialog-card vial-dialog" role="dialog" aria-modal="true" aria-labelledby="vial-dialog-title" data-dialog-card>
        <div class="vial-dialog-header">
          <div>
            <span>Röhrchen ${escapeHtml(tube.number)}</span>
            <h2 id="vial-dialog-title">${escapeHtml(tube.shortName)}</h2>
          </div>
          <button class="icon-close" data-dialog-close title="Schließen">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        <div class="vial-dialog-body">
          <div class="vial-dialog-visual">
            <div class="vial-cap"></div>
            <div class="vial" style="--fill:${height}%; --liquid:${tube.color}">
              <span>${escapeHtml(current)}</span>
              <em>${escapeHtml(capacity)}</em>
              <i></i>
            </div>
            <strong>${escapeHtml(percentage)}</strong>
          </div>
          <div class="vial-dialog-details">
            ${vialDetailRow("Füllstand", current)}
            ${vialDetailRow("Kapazität", capacity)}
            ${vialDetailRow("Verbleibend", percentage)}
            ${tube.entityId ? `<button class="secondary wide" data-more-info="${tube.entityId}">HA-Verlauf</button>` : ""}
          </div>
        </div>
        <div class="dialog-actions vial-dialog-actions">
          <button class="ghost" data-dialog-close>Schließen</button>
          <button class="primary danger" ${tube.refillButton ? `data-press="${tube.refillButton.entity_id}" data-kind="refill" data-label="${escapeHtml(refillLabel)}"` : "disabled"}>
            Auffüllen
          </button>
        </div>
      </section>
    </div>
  `;
}

function vialDetailRow(label, value) {
  return `
    <div class="vial-detail-row">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(value)}</b>
    </div>
  `;
}

function renderReservoir(component, title, icon, type) {
  const fill = clamp(component?.percentage ?? 0, 0, 100);
  const action = component?.button;
  const actionLabel = type === "waste" ? "Leeren" : "Auffüllen";
  return `
    <section class="reservoir ${type}">
      <div class="section-title small">
        <h2>${title}</h2>
        <button ${action ? `data-press="${action.entity_id}" data-label="${title}: ${actionLabel}"` : "disabled"}>${actionLabel}</button>
      </div>
      <div class="tank-wrap">
        <div class="tank" style="--fill:${fill}%">
          <i></i>
          <span>${escapeHtml(component?.display || "-")}</span>
        </div>
        <div class="tank-meta">
          <ha-icon icon="${icon}"></ha-icon>
          <b>${Math.round(fill)}%</b>
        </div>
      </div>
    </section>
  `;
}

function renderSyringe(component) {
  const fill = clamp(component?.percentage ?? 0, 0, 100);
  const action = component?.button;
  return `
    <section class="syringe">
      <div class="section-title small">
        <h2>Spritze</h2>
        <button ${action ? `data-press="${action.entity_id}" data-label="Spritze: Ersetzen"` : "disabled"}>Ersetzen</button>
      </div>
      <div class="usage-bar">
        <span style="width:${fill}%"></span>
      </div>
      <strong>${escapeHtml(component?.display || "-")}</strong>
    </section>
  `;
}

function renderMaintenance(model) {
  return `
    <section class="maintenance-bar">
      ${renderCompactReservoir(model.rodi, "Osmosewasser", "mdi:water", "rodi")}
      ${renderCompactReservoir(model.waste, "Abwasser", "mdi:trash-can-outline", "waste")}
      ${renderCompactSyringe(model.syringe)}
    </section>
  `;
}

function renderCompactReservoir(component, title, icon, type) {
  const fill = clamp(component?.percentage ?? 0, 0, 100);
  const action = component?.button;
  const capacity = component?.capacityNumber;
  const actionLabel = type === "waste" ? "Leeren" : "Auffüllen";
  return `
    <article class="maintenance-item ${type}">
      <ha-icon icon="${icon}"></ha-icon>
      <div class="maintenance-main">
        <strong>${title}</strong>
        <span>${escapeHtml(component?.display || "-")} · ${Math.round(fill)}%</span>
        <div class="mini-level"><i style="width:${fill}%"></i></div>
      </div>
      <div class="maintenance-actions">
        <button ${action ? `data-press="${action.entity_id}" data-label="${title}: ${actionLabel}"` : "disabled"}>${actionLabel}</button>
        <button class="secondary" ${capacity ? `data-more-info="${capacity.entity_id}" title="${title} Volumen einstellen"` : "disabled"}>Volumen</button>
      </div>
    </article>
  `;
}

function renderCompactSyringe(component) {
  const fill = clamp(component?.percentage ?? 0, 0, 100);
  const action = component?.button;
  return `
    <article class="maintenance-item syringe-compact">
      <ha-icon icon="mdi:needle"></ha-icon>
      <div class="maintenance-main">
        <strong>Spritze</strong>
        <span>${escapeHtml(component?.display || "-")}</span>
        <div class="mini-level"><i style="width:${fill}%"></i></div>
      </div>
      <button ${action ? `data-press="${action.entity_id}" data-label="Spritze: Ersetzen"` : "disabled"}>Ersetzen</button>
    </article>
  `;
}

function renderChamber(model) {
  const pendingValue = activeState(model.pending?.state) ? model.pending.state : "0";
  const chamber = chamberOperation(model);
  const operation = displayOperationName(chamber.name, "Ruhezustand");
  const active = isChamberActive(model);
  const stateLabel = active ? "Live" : "Ruhezustand";
  const operationPrefix = active ? "Live: " : model.recentOperation ? "Last: " : "";
  const progress = active ? chamberProgress(chamber, model) : undefined;
  return `
    <section class="chamber">
      <div class="section-title small">
        <h2>Test chamber</h2>
        <span class="${active ? "warn" : "good"}">${stateLabel}</span>
      </div>
      <div class="chamber-art ${active ? "active" : ""}">
        <div class="measure-beam beam-left"></div>
        <div class="measure-beam beam-right"></div>
        <div class="cuvette">
          <i></i>
          <span class="swirl one"></span>
          <span class="swirl two"></span>
          <span class="stir-bar"></span>
        </div>
      </div>
      <strong>${escapeHtml(`${operationPrefix}${operation}`)}</strong>
      ${progress ? renderChamberProgress(progress) : `<p>${escapeHtml(pendingValue)} pending operation${pendingValue === "1" ? "" : "s"}</p>`}
    </section>
  `;
}

function isChamberActive(model) {
  const operation = chamberOperation(model);
  return Boolean(operation.active);
}

function chamberOperation(model) {
  const current = model.currentOperation;
  const currentAttrs = current?.attributes || {};
  const currentName = activeState(current?.state)
    ? current.state
    : currentAttrs.name || currentAttrs.operation_name || currentAttrs.display_name;
  const currentActive = Boolean(currentAttrs.pending) || activeState(current?.state);
  if (currentActive && activeState(currentName) && isTestOperation(currentName, model)) {
    return {
      active: true,
      name: currentName,
      startedAt: parseDate(currentAttrs.added || currentAttrs.date || currentAttrs.request_date || currentAttrs.added_date),
      expectedAt: parseDate(currentAttrs.expected_completion_time || currentAttrs.expected_completion || currentAttrs.estimated_completion_time),
    };
  }

  const pending = firstPendingOperation(model.pending, model);
  if (pending) {
    return pending;
  }

  const recentPress = model.lastPressed?.kind === "test" && Date.now() - model.lastPressed.time < recentPressWindow(model.lastPressed.name)
    ? model.lastPressed
    : undefined;
  if (recentPress) {
    return {
      active: true,
      name: recentPress.name,
      startedAt: recentPress.time,
    };
  }

  return {
    active: false,
    name: model.recentOperation?.name,
    startedAt: parseDate(model.recentOperation?.date),
  };
}

function firstPendingOperation(pendingSensor, model) {
  const pending = pendingSensor?.attributes?.pending;
  if (!Array.isArray(pending)) return undefined;
  const item = pending.find((row) => {
    const name = row?.name || row?.operation || row?.display_name;
    return activeState(name) && isTestOperation(name, model);
  });
  if (!item) return undefined;
  return {
    active: true,
    name: item.name || item.operation || item.display_name,
    startedAt: parseDate(item.added || item.date || item.request_date || item.added_date),
    expectedAt: parseDate(item.expected_completion_time || item.expected_completion || item.estimated_completion_time),
  };
}

function activeTubeNumbers(model, operationName, vialCount = 8) {
  if (!operationName) return [];
  const match = findConfiguredTestForOperation(model.configuredTests, operationName);
  if (!match?.chemicals?.length) return [];
  return [...new Set(match.chemicals
    .map((chemical) => Number(chemical.tube))
    .filter((tube) => Number.isInteger(tube) && tube >= 1 && tube <= vialCount))];
}

function slotLeft(slot, totalSlots = 9) {
  const safeTotal = Math.max(2, Number(totalSlots) || 9);
  const safeSlot = clamp(Number(slot) || 1, 1, safeTotal);
  const percent = 6 + ((safeSlot - 0.5) * 88 / safeTotal);
  return `calc(${percent}% - 32px)`;
}

function recentPressWindow(name) {
  const duration = durationForTest(name) || 20;
  return (duration + 5) * 60 * 1000;
}

function chamberProgress(operation, model) {
  const sensorProgress = progressFromSensors(model);
  if (sensorProgress) return sensorProgress;

  if (!operation?.name) return undefined;
  const durationMinutes = durationForTest(operation.name);
  if (!durationMinutes) return undefined;
  const durationMs = durationMinutes * 60 * 1000;
  const expectedAt = operation.expectedAt;
  const startedAt = operation.startedAt || (expectedAt ? expectedAt - durationMs : undefined);
  if (!startedAt) {
    return {
      durationMinutes,
      percent: 0,
      remainingMs: durationMs,
    };
  }
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const remainingMs = Math.max(0, durationMs - elapsedMs);
  return {
    durationMinutes,
    percent: clamp((elapsedMs / durationMs) * 100, 0, 100),
    remainingMs,
  };
}

function progressFromSensors(model) {
  const durationMinutes = numberValue(model.currentTestDuration?.state);
  const progress = numberValue(model.currentTestProgress?.state);
  const remainingMinutes = numberValue(model.currentTestRemaining?.state);
  if (model.currentTestProgress?.attributes?.active !== true) {
    return undefined;
  }
  if (durationMinutes === undefined || progress === undefined || remainingMinutes === undefined) {
    return undefined;
  }
  return {
    durationMinutes,
    percent: clamp(progress, 0, 100),
    remainingMs: Math.max(0, remainingMinutes * 60 * 1000),
  };
}

function renderChamberProgress(progress) {
  return `
    <div class="chamber-progress" title="${progress.durationMinutes} min scheduled duration">
      <span style="width:${progress.percent}%"></span>
    </div>
    <p>${formatRemaining(progress.remainingMs)} remaining · ${Math.round(progress.percent)}% · ${progress.durationMinutes} min test</p>
  `;
}

function renderStatus(model) {
  return `
    <section class="status-list">
      <h2>Signals</h2>
      ${statusRow("Last successful", model.lastSuccessfulTest?.state)}
      ${statusRow("Notifications", model.notifications?.state)}
      ${statusRow("Alarms", model.alarms?.state)}
      ${statusRow("Configured tests", model.configuredTests.length || "-")}
    </section>
  `;
}

function statusRow(label, value) {
  return `<div><span>${label}</span><b>${escapeHtml(value ?? "-")}</b></div>`;
}

function componentModel(states, key, terms) {
  const sensor = states.find((state) => {
    if (!state.entity_id.startsWith("sensor.")) return false;
    if (!isReefBotEntity(state)) return false;
    return entityMatchesAnyTerm(state, terms, [
      state.attributes?.component_name,
      state.attributes?.component_id,
      state.attributes?.device_component_id,
    ]);
  });
  if (!sensor) return undefined;
  const display = sensor.attributes.display_value || `${sensor.state} ${sensor.attributes.unit_of_measurement || sensor.attributes.unit || ""}`.trim();
  const percentage = numberValue(sensor.attributes.fill_percentage) ?? percent(sensor.attributes.current_value ?? sensor.state, sensor.attributes.capacity);
  return {
    sensor,
    display,
    percentage,
    button: findComponentResetButton(states, key, sensor, terms),
    capacityNumber: findComponentCapacityNumber(states, key, sensor, terms),
  };
}

function findComponentResetButton(states, key, sensor, terms) {
  const componentId = componentIdentifier(sensor);
  const byId = states.find((state) => (
    state.entity_id.startsWith("button.")
    && isReefBotEntity(state)
    && componentId
    && componentIdentifier(state) === componentId
  ));
  if (byId) return byId;

  return states.find((state) => (
    state.entity_id.startsWith("button.")
    && isReefBotEntity(state)
    && entityMatchesAnyTerm(state, [`${key}:`, key, ...(terms || [])], [
      state.attributes?.component_name,
      state.attributes?.reset_title,
    ])
  ));
}

function findComponentCapacityNumber(states, key, sensor, terms) {
  const componentId = componentIdentifier(sensor);
  const byId = states.find((state) => (
    state.entity_id.startsWith("number.")
    && isReefBotEntity(state)
    && componentId
    && componentIdentifier(state) === componentId
  ));
  if (byId) return byId;

  const componentName = sensor?.attributes?.component_name;
  const searchTerms = [
    key,
    ...(terms || []),
    componentName,
  ].filter(activeState).map((term) => String(term).toLowerCase());

  return states.find((state) => {
    if (!state.entity_id.startsWith("number.")) return false;
    if (!isReefBotEntity(state)) return false;
    const name = entityName(state).toLowerCase();
    const entity = state.entity_id.toLowerCase();
    const isCapacity = name.includes("capacity")
      || name.includes("kapazität")
      || name.includes("volume")
      || entity.includes("capacity")
      || entity.includes("kapazitat")
      || entity.includes("volume");
    if (!isCapacity) return false;
    return searchTerms.some((term) => name.includes(term) || entity.includes(term.replaceAll(" ", "_")));
  });
}

function componentIdentifier(state) {
  const value = state?.attributes?.device_component_id ?? state?.attributes?.component_id;
  return value === undefined || value === null ? undefined : String(value);
}

function findOnline(states) {
  return states.find((state) => {
    if (!state.entity_id.startsWith("binary_sensor.")) return false;
    if (!isReefBotEntity(state)) return false;
    const name = entityName(state).toLowerCase();
    const entity = state.entity_id.toLowerCase();
    return name.includes("online") || entity.includes("online");
  });
}

function findReefBotByName(states, terms) {
  return states.find((state) => {
    if (!isReefBotEntity(state)) return false;
    const name = entityName(state).toLowerCase();
    const entity = state.entity_id.toLowerCase();
    return terms.some((term) => name.includes(term) || entity.includes(term.replaceAll(" ", "_")));
  });
}

function findCurrentOperationSensor(states) {
  return states.find((state) => {
    if (!state.entity_id.startsWith("sensor.")) return false;
    if (typeof state.attributes?.pending === "boolean") return true;
    const name = entityName(state).toLowerCase();
    return name.includes("current operation") || name.includes("aktueller vorgang");
  });
}

function findPendingOperationsSensor(states) {
  return states.find((state) => {
    if (!state.entity_id.startsWith("sensor.")) return false;
    if (Array.isArray(state.attributes?.pending) || Array.isArray(state.attributes?.recent_history)) return true;
    const name = entityName(state).toLowerCase();
    return name.includes("pending operations") || name.includes("ausstehende");
  });
}

function findTimingSensor(states, suffix) {
  return states.find((state) => {
    if (!state.entity_id.startsWith("sensor.")) return false;
    if (!isReefBotEntity(state)) return false;
    const normalizedEntity = normalize(state.entity_id);
    const normalizedSuffix = normalize(suffix);
    if (normalizedEntity.includes(normalizedSuffix)) return true;
    const name = normalize(entityName(state));
    return name.includes(normalizedSuffix) || normalizedSuffix.includes(name);
  });
}

function findButton(states, terms) {
  return states.find((state) => {
    if (!state.entity_id.startsWith("button.")) return false;
    if (!isReefBotEntity(state)) return false;
    return entityMatchesAnyTerm(state, terms);
  });
}

function findTubeRefillButton(states, tubeNumber) {
  const number = Number(tubeNumber);
  const byAttribute = states.find((state) => (
    state.entity_id.startsWith("button.")
    && isReefBotEntity(state)
    && Number(state.attributes?.tube_number) === number
  ));
  if (byAttribute) return byAttribute;

  const suffix = `refill_tube_${number}`;
  const byEntityId = states.find((state) => (
    state.entity_id.startsWith("button.")
    && isReefBotEntity(state)
    && state.entity_id.toLowerCase().includes(suffix)
  ));
  if (byEntityId) return byEntityId;

  return findButton(states, [`tube ${number}: refill`, `refill tube ${number}`]);
}

function entityMatchesAnyTerm(state, terms, extraValues = []) {
  const haystack = [
    state.entity_id,
    entityName(state),
    ...extraValues,
  ].filter(activeState);
  const normalizedHaystack = haystack.map(normalize).filter(Boolean);
  const textHaystack = haystack.map((value) => String(value).toLowerCase());

  return (terms || []).filter(activeState).some((term) => {
    const textTerm = String(term).toLowerCase();
    const normalizedTerm = normalize(term);
    return textHaystack.some((value) => value.includes(textTerm) || textTerm.includes(value))
      || normalizedHaystack.some((value) => value.includes(normalizedTerm) || normalizedTerm.includes(value));
  });
}

function isReefBotEntity(state) {
  const name = entityName(state).toLowerCase();
  return state.entity_id.includes("reefbot")
    || state.entity_id.includes("reef_bot")
    || name.includes("reefbot")
    || name.includes("reef bot");
}

function findTestButton(states, searchTerms, operationId) {
  if (activeState(operationId)) {
    const byOperationId = states.find((state) => (
      state.entity_id.startsWith("button.")
      && isReefBotEntity(state)
      && String(state.attributes?.available_operation_id) === String(operationId)
    ));
    if (byOperationId) return byOperationId;
  }

  const keys = searchTerms.flatMap((term) => searchAliases(term)).map(normalize).filter(Boolean);
  return states.find((state) => {
    if (!state.entity_id.startsWith("button.")) return false;
    if (!isReefBotEntity(state)) return false;
    const haystack = [
      state.entity_id,
      entityName(state),
      state.attributes?.display_name,
      state.attributes?.operation_name,
      state.attributes?.parameter,
    ].map(normalize).filter(Boolean);
    return keys.some((key) => haystack.some((value) => value.includes(key) || key.includes(value)));
  });
}

function findConfiguredTestForParameter(configuredTests, parameterName) {
  const keys = searchAliases(parameterName).map(normalize).filter(Boolean);
  return configuredTests.find((test) => {
    const haystack = [
      test.name,
      test.parameter,
      test.latest?.operation,
      test.latest?.brand,
    ].flatMap((term) => searchAliases(term)).map(normalize).filter(Boolean);
    return keys.some((key) => haystack.some((value) => value.includes(key) || key.includes(value)));
  });
}

function findConfiguredTestForOperation(configuredTests, operationName) {
  const keys = searchAliases(operationName).map(normalize).filter(Boolean);
  return configuredTests.find((test) => {
    const haystack = [
      test.name,
      test.operationName,
      test.method,
      test.parameter,
      test.latest?.operation,
      test.latest?.brand,
    ].flatMap((term) => searchAliases(term)).map(normalize).filter(Boolean);
    return keys.some((key) => haystack.some((value) => value.includes(key) || key.includes(value)));
  });
}

function recentOperationFromHistory(pendingSensor, configuredTests = []) {
  const history = pendingSensor?.attributes?.recent_history;
  if (!Array.isArray(history)) return undefined;
  const item = history.find((row) => {
    const name = row?.name || row?.operation || row?.display_name;
    return activeState(name) && isTestOperation(name, { configuredTests });
  });
  if (!item) return undefined;
  return {
    name: item.name || item.operation || item.display_name,
    date: item.added || item.date || item.request_date || item.added_date,
  };
}

function isParameterSensor(state) {
  return state.entity_id.startsWith("sensor.")
    && state.attributes?.parameter_name
    && Array.isArray(state.attributes?.history);
}

function isConfiguredTestSensor(state) {
  return state.entity_id.startsWith("sensor.")
    && state.attributes?.available_operation_id
    && state.attributes?.display_name;
}

function extractHistory(state) {
  const history = state.attributes.history;
  if (!Array.isArray(history)) return [];
  return history
    .map((item) => numberValue(item.value ?? item.Value ?? item.display_value))
    .filter((value) => typeof value === "number")
    .reverse();
}

function testTrendSummary(values = [], unit = "") {
  const recent = values.filter((value) => typeof value === "number").slice(-2);
  if (recent.length < 2) {
    return {
      label: "Latest result",
      delta: "",
      deltaClass: "",
    };
  }
  const delta = recent[recent.length - 1] - recent[recent.length - 2];
  const sign = delta > 0 ? "+" : "";
  return {
    label: "Last change",
    delta: `${sign}${formatNumber(delta)} ${unit || ""}`.trim(),
    deltaClass: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

function resultTrend(values = []) {
  if (!values.length) {
    return `
      <div class="result-trend empty-trend">
        <svg class="spark" viewBox="0 0 180 52" aria-hidden="true"><path d="M12 28 L168 28"></path></svg>
        <div class="trend-values"><span>-</span><span>-</span><span>-</span></div>
      </div>
    `;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = 8 + (index / Math.max(values.length - 1, 1)) * 164;
    const y = 42 - ((value - min) / range) * 30;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const recent = values.slice(-3);
  const paddedRecent = [...Array(Math.max(0, 3 - recent.length)).fill(undefined), ...recent];
  const labels = paddedRecent
    .map((value) => `<span>${escapeHtml(formatNumber(value))}</span>`)
    .join("");
  const dotIndexes = recent.map((_, index) => values.length - recent.length + index);
  const dots = dotIndexes.map((valueIndex) => {
    const value = values[valueIndex];
    const x = 8 + (valueIndex / Math.max(values.length - 1, 1)) * 164;
    const y = 42 - ((value - min) / range) * 30;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2"></circle>`;
  }).join("");
  return `
    <div class="result-trend">
      <svg class="spark" viewBox="0 0 180 52" aria-hidden="true">
        <path d="M8 42 L172 42"></path>
        <polyline points="${points}"></polyline>
        <g>${dots}</g>
      </svg>
      <div class="trend-values">${labels}</div>
    </div>
  `;
}

function emptyTube(number) {
  return {
    number,
    name: `Tube ${number}`,
    shortName: "Not configured",
    current: 0,
    capacity: 20,
    percentage: 0,
    unit: "mL",
    color: "#5c6470",
  };
}

function entityName(state) {
  if (!state) return "";
  return state.attributes?.friendly_name || state.entity_id;
}

function displayOperationName(value, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim();
  return text.toLowerCase() === "idle" ? "Ruhezustand" : text;
}

function formatReading(value, unit) {
  if (value === undefined || value === null || value === "unknown" || value === "unavailable") return "-";
  return `${formatNumber(value)} ${unit || ""}`.trim();
}

function activeState(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim().toLowerCase();
  return text !== "" && text !== "0" && text !== "unknown" && text !== "unavailable" && text !== "none" && text !== "idle";
}

function durationForTest(name) {
  const keys = searchAliases(name).map(normalize).filter(Boolean);
  const matches = TEST_DURATIONS_MINUTES
    .map((entry) => ({
      ...entry,
      score: entry.names.reduce((best, candidate) => Math.max(best, matchScore(keys, candidate)), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return matches[0]?.minutes;
}

function isTestOperation(name, model) {
  if (durationForTest(name) !== undefined) return true;
  if (!model?.configuredTests?.length) return false;
  const keys = searchAliases(name).map(normalize).filter(Boolean);
  return model.configuredTests.some((test) => {
    const haystack = [
      test.name,
      test.operationName,
      test.method,
      test.parameter,
      test.latest?.operation,
      test.latest?.brand,
    ].flatMap((term) => searchAliases(term)).map(normalize).filter(Boolean);
    return keys.some((key) => haystack.some((value) => value.includes(key) || key.includes(value)));
  });
}

function matchScore(keys, candidate) {
  const values = searchAliases(candidate).map(normalize).filter(Boolean);
  let score = 0;
  keys.forEach((key) => {
    values.forEach((value) => {
      if (!key || !value) return;
      if (key === value) score = Math.max(score, 1000 + value.length);
      if (key.includes(value)) score = Math.max(score, 500 + value.length);
      if (value.includes(key)) score = Math.max(score, 250 + key.length);
    });
  });
  return score;
}

function parseDate(value) {
  if (!value) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatRemaining(value) {
  if (!Number.isFinite(value)) return "-";
  if (value <= 0) return "0 min";
  const minutes = Math.ceil(value / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function formatNumber(value) {
  const number = numberValue(value);
  if (number === undefined) return `${value ?? "-"}`;
  if (Number.isInteger(number)) return `${number}`;
  return `${Math.round(number * 100) / 100}`;
}

function numberValue(value) {
  if (value === undefined || value === null || value === "" || value === "unknown" || value === "unavailable") return undefined;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : undefined;
}

function percent(current, capacity) {
  const currentNumber = numberValue(current);
  const capacityNumber = numberValue(capacity);
  if (currentNumber === undefined || !capacityNumber) return 0;
  return (currentNumber / capacityNumber) * 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function searchAliases(value) {
  const text = String(value || "").toLowerCase();
  const aliases = [text];
  if (text.includes("nitrate") || text.includes("no3")) aliases.push("no3", "nitrate");
  if (text.includes("nitrite") || text.includes("no2")) aliases.push("no2", "nitrite");
  if (text.includes("phosphate") || text.includes("po4")) aliases.push("po4", "phosphate");
  if (text.includes("alkalinity") || text.includes("alk") || text.includes("kh")) aliases.push("alkalinity", "kh");
  if (text.includes("calcium") || /\bca\b/.test(text)) aliases.push("calcium", "ca");
  return aliases;
}

function shortenChemical(name) {
  return String(name || "")
    .replace(/^Tube\s+\d+:\s*/i, "")
    .replace(/\s*\((ppm|dkh|mg\/l)\)\s*$/i, "")
    .trim();
}

function chemicalColor(name, index) {
  const palette = [
    "#d27a1f",
    "#b8a21e",
    "#83bd35",
    "#31b9a7",
    "#2f87c7",
    "#774bb8",
    "#b94d9a",
    "#cf725a",
  ];
  return palette[(index - 1) % palette.length];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const styles = `
  :host {
    display: block;
    min-height: 100vh;
    color: #edf7fa;
    background: #091114;
    font-family: var(--paper-font-body1_-_font-family, Roboto, system-ui, sans-serif);
  }

  * { box-sizing: border-box; }
  button {
    font: inherit;
    border: 0;
    color: inherit;
    cursor: pointer;
  }
  button[disabled] {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(0, 0, 0, 0.56);
    backdrop-filter: blur(5px);
  }
  .dialog-card {
    width: min(460px, 100%);
    max-height: min(74vh, 620px);
    overflow: auto;
    border-radius: 14px;
    padding: 22px;
    color: #edf7fa;
    background:
      linear-gradient(180deg, rgba(28, 39, 43, 0.98), rgba(12, 20, 23, 0.98));
    border: 1px solid rgba(122, 221, 247, 0.22);
    box-shadow: 0 22px 70px rgba(0, 0, 0, 0.56);
  }
  .dialog-card h2 {
    margin: 0 0 10px;
    font-size: 24px;
  }
  .dialog-card p {
    margin: 0 0 18px;
    color: #aebec5;
    line-height: 1.45;
  }
  .dialog-card strong {
    color: #fff;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
  .dialog-actions button {
    min-height: 38px;
    padding: 0 16px;
  }
  .dialog-actions .ghost {
    color: #9edff0;
    background: rgba(18, 42, 50, 0.72);
    border: 1px solid rgba(102, 215, 247, 0.24);
  }
  .dialog-actions .primary {
    color: #051014;
    background: #66d7f7;
    border: 1px solid rgba(255,255,255,0.2);
    font-weight: 800;
  }
  .dialog-actions .primary.danger {
    color: #fff;
    background: #b73535;
    border-color: rgba(255, 170, 170, 0.34);
  }
  .dialog-actions .secondary,
  .vial-dialog-details .secondary {
    color: #9edff0;
    background: rgba(18, 42, 50, 0.72);
    border: 1px solid rgba(102, 215, 247, 0.24);
  }
  .icon-close {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .alarm-dialog {
    width: min(620px, 100%);
  }
  .alarm-list {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
    display: grid;
    gap: 9px;
  }
  .alarm-list li {
    padding: 11px 12px;
    border-radius: 10px;
    background: rgba(255,255,255,0.045);
    border: 1px solid rgba(255,255,255,0.08);
  }
  .alarm-list b,
  .alarm-list span,
  .alarm-list small {
    display: block;
  }
  .alarm-list b {
    color: #fff;
    font-size: 14px;
  }
  .alarm-list span {
    margin-top: 3px;
    color: #8fdcf0;
    font-size: 12px;
  }
  .alarm-list small {
    margin-top: 5px;
    color: #b7c7cd;
    line-height: 1.35;
  }
  .alarm-list .empty-row {
    color: #aebec5;
  }
  .vial-dialog {
    width: min(620px, 100%);
    max-height: min(88vh, 720px);
  }
  .vial-dialog-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 18px;
  }
  .vial-dialog-header span {
    display: block;
    margin-bottom: 4px;
    color: #72ddf8;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .vial-dialog-header h2 {
    margin: 0;
    overflow-wrap: anywhere;
    line-height: 1.12;
  }
  .vial-dialog-body {
    display: grid;
    grid-template-columns: minmax(150px, 210px) minmax(0, 1fr);
    gap: 22px;
    align-items: center;
  }
  .vial-dialog-visual {
    display: grid;
    justify-items: center;
    gap: 0;
  }
  .vial-dialog-visual .vial-cap {
    width: 92px;
    height: 38px;
    border-radius: 8px;
  }
  .vial-dialog-visual .vial {
    width: 92px;
    height: 248px;
    border-radius: 6px 6px 24px 24px;
  }
  .vial-dialog-visual .vial span {
    inset: auto 7px 45%;
    font-size: 22px;
    line-height: 1.1;
  }
  .vial-dialog-visual .vial em {
    top: 21px;
    left: -12px;
    right: -12px;
    font-size: 13px;
    padding-right: 5px;
  }
  .vial-dialog-visual strong {
    margin-top: 12px;
    color: #edf7fa;
    font-size: 28px;
  }
  .vial-dialog-details {
    display: grid;
    gap: 10px;
  }
  .vial-detail-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 13px 14px;
    border-radius: 10px;
    background: rgba(255,255,255,0.045);
    border: 1px solid rgba(255,255,255,0.08);
  }
  .vial-detail-row span {
    color: #9daeb5;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .vial-detail-row b {
    color: #fff;
    font-size: 18px;
    text-align: right;
  }
  .vial-dialog-details .wide {
    width: 100%;
    min-height: 42px;
    border-radius: 8px;
  }
  .vial-dialog-actions {
    margin-top: 20px;
  }
  .vial-dialog-actions button {
    min-width: 132px;
  }

  .page {
    min-height: 100vh;
    padding: 24px;
    background:
      radial-gradient(circle at 20% 10%, rgba(0, 166, 204, 0.13), transparent 34%),
      linear-gradient(135deg, #071012 0%, #10181b 48%, #071012 100%);
  }

  .shell {
    max-width: 1620px;
    margin: 0 auto;
  }

  .header {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    gap: 18px;
    align-items: center;
    margin-bottom: 18px;
  }
  .menu-button {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #edf7fa;
  }
  .menu-button[hidden] {
    display: none;
  }
  .brand-mark {
    width: 78px;
    height: 78px;
    border-radius: 20px;
    background: #1289a6;
    position: relative;
    overflow: hidden;
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.35);
  }
  .brand-mark span, .brand-mark i {
    position: absolute;
    top: 30px;
    height: 18px;
    border-radius: 12px;
    background: #fff;
    transform: rotate(-12deg);
  }
  .brand-mark span:nth-child(1) { left: 14px; width: 14px; }
  .brand-mark span:nth-child(2) { left: 34px; width: 22px; }
  .brand-mark span:nth-child(3) { left: 62px; width: 34px; }
  .brand-mark i { right: 13px; top: 24px; width: 15px; height: 15px; border-radius: 50%; }
  h1, h2, p { margin: 0; }
  h1 { font-size: 32px; letter-spacing: 0; }
  .header p { color: #91a2a9; margin-top: 4px; }
  .header-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(126px, 1fr));
    gap: 10px;
  }
  .header-chip, .tests, .maintenance-item {
    background: rgba(16, 25, 28, 0.78);
    border: 1px solid rgba(156, 198, 211, 0.16);
    border-radius: 8px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
  }
  .header-chip {
    min-width: 0;
    padding: 13px 15px;
  }
  .header-chip[data-more-info] {
    cursor: pointer;
  }
  .header-chip b { display: block; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .header-chip span, .section-title span { color: #90a2aa; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
  .good { color: #70d58a; }
  .warn { color: #ffd16c; }

  .content-grid {
    display: block;
  }
  .center-stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
  }
  .section-title h2 {
    font-size: 18px;
    font-weight: 700;
  }
  .section-title.small h2 { font-size: 16px; }
  .section-title button {
    background: rgba(0, 173, 217, 0.16);
    color: #66d7f7;
    border: 1px solid rgba(102, 215, 247, 0.28);
    border-radius: 6px;
    padding: 7px 10px;
  }

  .tests {
    padding: 16px;
  }
  .test-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 10px;
  }
  .test-card {
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 12px;
    min-height: 132px;
    padding: 12px;
    border-radius: 8px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.028)),
      rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    cursor: pointer;
    min-width: 0;
  }
  .test-card-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-width: 0;
  }
  .play {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: #1289a6;
    color: #fff;
  }
  .play[disabled] {
    color: #8fa0a7;
    background: rgba(255,255,255,0.08);
  }
  .test-main strong {
    display: block;
    line-height: 1.15;
    white-space: normal;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .test-main span {
    display: block;
    color: #b9c6cb;
    margin-top: 3px;
  }
  .test-reading {
    justify-self: end;
    min-width: 76px;
    max-width: 108px;
    text-align: right;
  }
  .test-reading b {
    display: block;
    padding: 5px 8px;
    border-radius: 999px;
    background: rgba(79, 210, 242, 0.12);
    border: 1px solid rgba(79, 210, 242, 0.22);
    color: #edf9fb;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .test-reading small {
    display: block;
    margin-top: 5px;
    color: #b9c6cb;
    font-size: 11px;
    line-height: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .test-reading small.up { color: #8ee69c; }
  .test-reading small.down { color: #ff9a8f; }
  .test-reading small.flat { color: #b9c6cb; }
  .spark {
    width: 100%;
    height: 52px;
  }
  .result-trend {
    min-width: 0;
  }
  .trend-values {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-top: -3px;
    color: #b8c7cc;
    font-size: 11px;
    line-height: 1;
  }
  .trend-values span {
    min-width: 0;
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spark path, .spark polyline {
    fill: none;
    stroke: #4fd2f2;
    stroke-width: 2.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.9;
  }
  .spark path {
    stroke: rgba(185, 198, 203, 0.2);
    stroke-width: 1.2;
  }
  .spark circle {
    fill: #1d2b2f;
    stroke: #4fd2f2;
    stroke-width: 2.2;
  }

  .operation-strip {
    --progress: 0%;
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 12px;
    min-height: 64px;
    overflow: hidden;
    padding: 12px 14px;
    border-radius: 10px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.048), rgba(255, 255, 255, 0.018)),
      rgba(7, 19, 23, 0.86);
    border: 1px solid rgba(102, 215, 247, 0.18);
    box-shadow: 0 16px 42px rgba(0, 0, 0, 0.22);
  }
  .operation-strip[data-more-info] {
    cursor: pointer;
  }
  .operation-strip::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--progress);
    background:
      linear-gradient(90deg, rgba(18, 137, 166, 0.42), rgba(79, 210, 242, 0.22)),
      linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent);
    box-shadow: 20px 0 46px rgba(79, 210, 242, 0.12);
    opacity: 0;
    transition: width 0.5s ease, opacity 0.25s ease;
  }
  .operation-strip.idle::before {
    width: 100%;
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0));
    opacity: 1;
    box-shadow: none;
  }
  .operation-strip.active::before {
    opacity: 1;
  }
  .operation-strip > * {
    position: relative;
    z-index: 1;
  }
  .operation-strip-main {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .operation-strip-main span {
    color: #8fa3ab;
    font-size: 12px;
    letter-spacing: 0.08em;
    line-height: 1;
    text-transform: uppercase;
  }
  .operation-strip-main strong {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: #edf7fa;
    font-size: 17px;
    line-height: 1.18;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .operation-strip-time {
    color: #effbff;
    font-size: 25px;
    line-height: 1;
    white-space: nowrap;
  }
  .operation-strip.idle .operation-strip-time {
    color: #aebdc3;
    font-size: 18px;
  }
  .operation-strip-meta {
    min-width: 84px;
    padding: 7px 10px;
    border-radius: 999px;
    background: rgba(79, 210, 242, 0.12);
    border: 1px solid rgba(79, 210, 242, 0.2);
    color: #d6f5fb;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    text-align: center;
    white-space: nowrap;
  }

  .machine {
    min-height: 510px;
    overflow-x: auto;
    padding-bottom: 10px;
    scrollbar-color: rgba(102, 215, 247, 0.35) rgba(255,255,255,0.08);
    -webkit-overflow-scrolling: touch;
  }
  .machine-frame {
    position: relative;
    width: min(100%, 1320px);
    min-width: max(920px, calc(var(--total-slots, 9) * 84px));
    height: 510px;
    margin: 0 auto;
    overflow: hidden;
    clip-path: polygon(26px 0, calc(100% - 26px) 0, 100% 26px, 100% calc(100% - 26px), calc(100% - 26px) 100%, 26px 100%, 0 calc(100% - 26px), 0 26px);
    background: linear-gradient(180deg, #1b2226 0%, #0c1113 100%);
    border: 10px solid #30383d;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.08),
      inset 0 40px 80px rgba(0, 0, 0, 0.45),
      0 24px 54px rgba(0, 0, 0, 0.35);
  }
  .machine-frame::before {
    content: "";
    position: absolute;
    inset: 22px;
    border-radius: 6px;
    background: linear-gradient(180deg, rgba(255,255,255,0.05), transparent 30%);
    border: 1px solid rgba(255,255,255,0.07);
  }
  .corner-accent {
    position: absolute;
    top: 4px;
    width: 31px;
    height: 9px;
    border-radius: 999px;
    background: rgba(232,240,242,0.70);
    z-index: 4;
  }
  .corner-accent.left {
    left: 2px;
    transform: translate(7px, 11px) rotate(-45deg);
  }
  .corner-accent.right {
    right: 2px;
    transform: translate(-7px, 11px) rotate(45deg);
  }
  .rail {
    position: absolute;
    left: 5.5%;
    right: 5.5%;
    top: 46px;
    height: 18px;
    border-radius: 3px;
    background: #232b30;
    border-top: 2px solid rgba(255,255,255,0.18);
    box-shadow: 0 14px 26px rgba(0,0,0,0.28);
    z-index: 3;
  }
  .rail span {
    position: absolute;
    left: 4px;
    right: 4px;
    bottom: 3px;
    height: 5px;
    border-radius: 2px;
    background:
      repeating-linear-gradient(90deg, #2b3439 0 3px, #0d1113 3px 6px),
      #0d1113;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,0.28);
  }
  .energy-chain {
    position: absolute;
    left: 5.5%;
    right: 5.5%;
    top: 12px;
    height: 64px;
    z-index: 2;
    opacity: 0.92;
    pointer-events: none;
  }
  .energy-chain path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .chain-shadow {
    stroke: #0b0e10;
    stroke-width: 12;
    opacity: 0.65;
  }
  .chain-links {
    stroke: #171c1f;
    stroke-width: 9;
    stroke-dasharray: 6 3;
  }
  .syringe-carriage {
    position: absolute;
    left: var(--source-a-left);
    top: 38px;
    width: 64px;
    height: 214px;
    z-index: 5;
    opacity: 0.94;
    transform: translateX(0);
  }
  .active-test .syringe-carriage {
    animation: syringeCollect 9s ease-in-out infinite;
  }
  .syringe-block {
    position: absolute;
    left: 16px;
    top: 0;
    width: 32px;
    height: 24px;
    border-radius: 6px;
    background:
      linear-gradient(135deg, rgba(255,255,255,0.08), transparent 45%),
      #151b1f;
    border: 1px solid rgba(210, 225, 230, 0.22);
    box-shadow: 0 8px 18px rgba(0,0,0,0.34);
  }
  .syringe-z {
    position: absolute;
    inset: 0;
  }
  .active-test .syringe-z {
    animation: syringeZAxis 9s ease-in-out infinite;
  }
  .syringe-guide {
    position: absolute;
    left: 29px;
    top: 24px;
    width: 6px;
    height: 12px;
    border-radius: 4px;
    background: rgba(210, 225, 230, 0.72);
  }
  .syringe-body {
    position: absolute;
    left: 23px;
    top: 36px;
    width: 18px;
    height: 88px;
    border-radius: 9px;
    border: 2px solid rgba(200, 218, 222, 0.38);
    background:
      repeating-linear-gradient(180deg, transparent 0 7px, rgba(30, 37, 41, 0.58) 7px 8px, transparent 8px 12px),
      linear-gradient(90deg, rgba(255,255,255,0.42), transparent 34%, rgba(255,255,255,0.13)),
      linear-gradient(180deg, rgba(235, 244, 246, 0.68), rgba(134, 152, 157, 0.42));
    box-shadow: inset 0 0 10px rgba(0,0,0,0.28), 0 8px 18px rgba(0,0,0,0.3);
  }
  .syringe-body span {
    position: absolute;
    left: 5px;
    right: 5px;
    top: 11px;
    bottom: 10px;
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.15)),
      rgba(108, 215, 241, 0.34);
    opacity: 0.4;
    transform: scaleY(0.15);
    transform-origin: bottom;
  }
  .active-test .syringe-body span {
    animation: syringeFill 9s ease-in-out infinite;
  }
  .syringe-body span::before {
    content: "";
    position: absolute;
    left: -7px;
    top: 8px;
    width: 5px;
    height: 66px;
    background: repeating-linear-gradient(180deg, rgba(8, 12, 14, 0.86) 0 1px, transparent 1px 6px);
    opacity: 0.75;
  }
  .syringe-body::after {
    content: "";
    position: absolute;
    left: -16px;
    right: -16px;
    bottom: 20px;
    height: 7px;
    border-radius: 999px;
    background: rgba(210, 220, 222, 0.52);
    box-shadow: 0 0 0 1px rgba(210, 225, 230, 0.18), 0 3px 8px rgba(0,0,0,0.28);
  }
  .syringe-needle {
    position: absolute;
    left: 31px;
    top: 124px;
    width: 2px;
    height: 22px;
    background: rgba(200, 218, 222, 0.72);
    box-shadow: 0 0 8px rgba(108, 215, 241, 0.28);
  }
  .syringe-needle::before,
  .syringe-needle::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 100%;
    width: 6px;
    height: 8px;
    border-radius: 50% 50% 58% 58%;
    background:
      radial-gradient(circle at 38% 28%, rgba(225, 252, 255, 0.95), transparent 38%),
      linear-gradient(180deg, rgba(126, 226, 249, 0.96), rgba(41, 159, 189, 0.9));
    box-shadow: 0 0 10px rgba(106, 217, 244, 0.82);
    opacity: 0;
    transform: translate(-50%, 0) scale(0.65);
    z-index: 5;
  }
  .syringe-needle::after {
    width: 4px;
    height: 6px;
  }
  .active-test .syringe-needle::before {
    animation: needleDropletFall 9s ease-in-out infinite;
  }
  .active-test .syringe-needle::after {
    animation: needleDropletFall 9s ease-in-out infinite;
    animation-delay: 0.28s;
  }
  .gantry {
    position: absolute;
    left: 6%;
    right: 6%;
    bottom: 134px;
    height: 34px;
    background: #20242a;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 18px 32px rgba(0,0,0,0.35);
    z-index: 1;
  }
  .vial-row {
    position: absolute;
    left: 6%;
    right: 6%;
    bottom: 18px;
    display: grid;
    grid-template-columns: var(--slot-template);
    gap: 6px;
    align-items: start;
    min-height: 310px;
    z-index: 3;
  }
  .vial-card {
    min-width: 0;
    display: grid;
    grid-template-rows: 24px 150px auto;
    justify-items: center;
    align-items: start;
    text-align: center;
  }
  .vial-card.clickable {
    cursor: pointer;
  }
  .vial-card.clickable .vial,
  .vial-card.clickable .vial-name {
    transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
  }
  .vial-card.clickable:hover .vial {
    border-color: rgba(102, 215, 247, 0.44);
    box-shadow:
      inset 0 16px 18px rgba(0,0,0,0.34),
      inset 0 0 18px rgba(0,0,0,0.42),
      0 10px 22px rgba(0,0,0,0.3),
      0 0 16px rgba(102, 215, 247, 0.15);
    transform: translateY(-1px);
  }
  .vial-card.clickable:hover .vial-name {
    border-color: rgba(102, 215, 247, 0.32);
  }
  .vial-card.locked {
    cursor: default;
  }
  .vial-cap {
    width: min(56px, 88%);
    height: 24px;
    margin: 0;
    border-radius: 4px;
    background:
      linear-gradient(90deg, rgba(255,255,255,0.08), transparent 30%),
      linear-gradient(180deg, #171d20, #07090b);
    border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 5px 10px rgba(0,0,0,0.36);
    position: relative;
    z-index: 2;
  }
  .vial {
    position: relative;
    width: min(56px, 88%);
    height: 150px;
    margin: 0 auto 8px;
    border-radius: 3px 3px 12px 12px;
    background:
      linear-gradient(90deg, rgba(255,255,255,0.19), rgba(255,255,255,0.03) 32%, rgba(255,255,255,0.10)),
      rgba(11, 13, 14, 0.72);
    border: 2px solid rgba(210,220,220,0.27);
    overflow: hidden;
    box-shadow:
      inset 0 16px 18px rgba(0,0,0,0.34),
      inset 0 0 18px rgba(0,0,0,0.42),
      0 10px 22px rgba(0,0,0,0.3);
  }
  .vial i {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: var(--fill);
    min-height: 8px;
    background:
      linear-gradient(90deg, rgba(255,255,255,0.20), transparent 26%, rgba(0,0,0,0.08)),
      linear-gradient(180deg, color-mix(in srgb, var(--liquid), white 18%), var(--liquid));
    opacity: 0.9;
    animation: liquidPulse 3.8s ease-in-out infinite;
  }
  .vial i::before {
    content: "";
    position: absolute;
    left: -20%;
    top: -5px;
    width: 140%;
    height: 10px;
    border-radius: 50%;
    background: rgba(255,255,255,0.25);
    animation: wave 4s ease-in-out infinite;
  }
  .vial em {
    position: absolute;
    left: -8px;
    right: -8px;
    top: 9px;
    z-index: 2;
    height: 1px;
    font-style: normal;
    font-size: 7px;
    line-height: 0;
    color: rgba(230, 238, 238, 0.68);
    text-shadow: 0 1px 3px rgba(0,0,0,0.7);
    border-top: 1px solid rgba(230, 238, 238, 0.55);
    text-align: right;
    padding-right: 2px;
  }
  .vial span {
    position: absolute;
    inset: auto 2px 48%;
    z-index: 1;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 4px rgba(0,0,0,0.7);
  }
  .vial-refill {
    position: absolute;
    left: 50%;
    bottom: 9px;
    z-index: 4;
    width: 23px;
    height: 23px;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 50%;
    color: #ffe8e8;
    background: rgba(183, 53, 53, 0.82);
    border: 1px solid rgba(255, 185, 185, 0.42);
    box-shadow: 0 4px 10px rgba(0,0,0,0.36), 0 0 10px rgba(183,53,53,0.22);
    overflow: hidden;
    transform: translateX(-50%);
  }
  .vial-refill ha-icon {
    width: 15px;
    height: 15px;
    --mdc-icon-size: 15px;
  }
  .vial-card strong {
    display: block;
    font-size: 12px;
    color: #a9bac1;
  }
  .vial-card .vial-number {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin: 0;
    border-radius: 50%;
    color: #dff7ff;
    font-size: 15px;
    font-weight: 800;
    background: rgba(13, 37, 47, 0.8);
    border: 1px solid rgba(102, 215, 247, 0.55);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07), 0 0 12px rgba(102,215,247,0.22);
  }
  .vial-card .vial-name,
  .chamber-operation {
    width: 100%;
    min-height: 58px;
    padding: 14px 7px 8px;
    border-radius: 8px;
    background: rgba(8, 18, 21, 0.78);
    border: 1px solid rgba(102, 215, 247, 0.14);
    box-shadow: 0 10px 22px rgba(0,0,0,0.22);
  }
  .vial-card .vial-name {
    position: relative;
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: 24px auto;
    gap: 6px;
    justify-items: center;
    align-items: start;
    margin-top: 22px;
    padding: 7px 6px 8px;
    color: #edf7fa;
    font-size: 12px;
    line-height: 1.25;
    overflow: visible;
  }
  .vial-card .vial-label {
    display: block;
    width: 100%;
    text-align: center;
    overflow-wrap: break-word;
    word-break: normal;
    white-space: normal;
  }
  .chamber-slot small {
    display: block;
    grid-column: 1;
    color: #9daeb5;
    font-size: 11px;
    margin-top: 5px;
  }
  .chamber-vial {
    position: relative;
    grid-row: 1 / 3;
    width: min(56px, 88%);
    height: 174px;
    margin: 0 auto 8px;
    border-radius: 3px 3px 16px 16px;
    border: 2px solid rgba(225,235,238,0.34);
    overflow: visible;
    background:
      linear-gradient(90deg, rgba(255,255,255,0.19), rgba(255,255,255,0.03) 32%, rgba(255,255,255,0.10)),
      rgba(8, 12, 14, 0.74);
    box-shadow:
      inset 0 18px 22px rgba(0,0,0,0.38),
      inset 0 0 22px rgba(0,0,0,0.46),
      0 12px 25px rgba(0,0,0,0.34);
  }
  .chamber-vial::before {
    content: "";
    position: absolute;
    left: -58px;
    right: -58px;
    top: 92px;
    height: 6px;
    border-radius: 999px;
    background:
      radial-gradient(circle, rgba(255,255,255,0.98), rgba(130,235,255,0.78) 28%, transparent 58%),
      linear-gradient(90deg, transparent, rgba(128,232,255,0.9), rgba(255,255,255,0.96), rgba(128,232,255,0.9), transparent);
    filter: drop-shadow(0 0 10px rgba(120, 229, 255, 0.95));
    opacity: 0;
    pointer-events: none;
    z-index: 6;
  }
  .chamber-vial.active::before {
    animation: measurementFlash 3.2s ease-in-out infinite;
  }
  .chamber-vial i {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 45%;
    border-radius: 0 0 14px 14px;
    background: linear-gradient(180deg, rgba(135, 222, 241, 0.94), #1289a6);
  }
  .chamber-vial.active i {
    animation: chamberLiquid 1.5s ease-in-out infinite;
  }
  .chamber-vial .swirl {
    position: absolute;
    left: 12px;
    right: 12px;
    height: 16px;
    border-radius: 50%;
    border-top: 2px solid rgba(255,255,255,0.36);
    border-bottom: 1px solid rgba(255,255,255,0.13);
    z-index: 2;
    opacity: 0;
  }
  .chamber-vial .swirl.one { bottom: 58px; }
  .chamber-vial .swirl.two { bottom: 42px; transform: rotate(180deg); }
  .chamber-vial.active .swirl {
    opacity: 1;
    animation: stirSwirl 1.15s linear infinite;
  }
  .chamber-vial.active .swirl.two {
    animation-delay: -0.45s;
  }
  .chamber-vial .stir-bar {
    position: absolute;
    left: 17px;
    bottom: 22px;
    width: 24px;
    height: 5px;
    border-radius: 999px;
    background: rgba(230, 238, 238, 0.78);
    box-shadow: 0 0 10px rgba(96, 214, 247, 0.45);
    transform-origin: 50% 50%;
    z-index: 2;
  }
  .chamber-vial.active .stir-bar {
    animation: stirBar 0.8s linear infinite;
  }
  .chamber-vial .measure-beam {
    position: absolute;
    top: 96px;
    width: 54px;
    height: 4px;
    opacity: 0;
    background: linear-gradient(90deg, transparent, rgba(120, 229, 255, 0.95), transparent);
    filter: drop-shadow(0 0 8px rgba(120, 229, 255, 0.75));
    z-index: 3;
  }
  .chamber-vial .beam-left { left: -39px; }
  .chamber-vial .beam-right { right: -39px; transform: rotate(180deg); }
  .chamber-vial.active .measure-beam {
    animation: sensorFlash 3.2s ease-in-out infinite;
  }
  .chamber-vial.active .beam-right {
    animation-delay: 0.18s;
  }
  .chamber-label {
    display: grid !important;
    place-items: center;
    height: 28px;
    margin-top: 6px;
    color: #a9bac1;
  }
  .chamber-operation {
    margin: 0 auto;
  }
  .chamber-operation.live {
    background: linear-gradient(180deg, rgba(14, 93, 112, 0.42), rgba(8, 18, 21, 0.8));
    border-color: rgba(102, 215, 247, 0.34);
  }
  .chamber-operation span,
  .chamber-operation b {
    display: block;
  }
  .chamber-operation span {
    color: #72ddf8;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .chamber-operation b {
    margin-top: 2px;
    color: #f3fbfd;
    font-size: 12px;
    line-height: 1.15;
  }

  .maintenance-bar {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  .maintenance-item {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: center;
    min-width: 0;
    padding: 12px;
  }
  .maintenance-item ha-icon {
    color: #66d7f7;
  }
  .maintenance-main {
    min-width: 0;
  }
  .maintenance-main strong,
  .maintenance-main span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .maintenance-main span {
    color: #aebdc4;
    font-size: 13px;
    margin-top: 2px;
  }
  .maintenance-item button {
    background: rgba(0, 173, 217, 0.16);
    color: #66d7f7;
    border: 1px solid rgba(102, 215, 247, 0.28);
    border-radius: 6px;
    padding: 7px 10px;
  }
  .maintenance-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .maintenance-actions .secondary {
    background: rgba(255, 255, 255, 0.06);
    color: #b9cbd1;
    border-color: rgba(255, 255, 255, 0.14);
  }
  .mini-level {
    height: 6px;
    margin-top: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255,255,255,0.08);
  }
  .mini-level i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #5fd7f7, #1289a6);
  }
  .waste .mini-level i {
    background: linear-gradient(90deg, #d9a85f, #7b5a2a);
  }

  .reservoir, .syringe, .chamber, .status-list {
    padding: 16px;
  }
  .tank-wrap {
    display: grid;
    grid-template-columns: 86px 1fr;
    gap: 12px;
    align-items: center;
  }
  .tank {
    position: relative;
    height: 210px;
    border-radius: 42px / 18px;
    border: 2px solid rgba(255,255,255,0.24);
    overflow: hidden;
    background: rgba(255,255,255,0.05);
    box-shadow: inset 0 12px 24px rgba(255,255,255,0.06), inset 0 -20px 28px rgba(0,0,0,0.28);
  }
  .tank i {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: var(--fill);
    background: linear-gradient(180deg, #75d8f4, #1289a6);
    transition: height 0.7s ease;
  }
  .waste .tank i { background: linear-gradient(180deg, #d9a85f, #7b5a2a); }
  .tank span {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 1;
    text-align: center;
    padding: 10px;
    font-size: 13px;
    text-shadow: 0 1px 5px rgba(0,0,0,0.75);
  }
  .tank-meta ha-icon {
    color: #60d6f7;
  }
  .tank-meta b {
    display: block;
    margin-top: 8px;
    font-size: 26px;
  }
  .usage-bar {
    height: 18px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(255,255,255,0.08);
    margin: 18px 0 12px;
  }
  .usage-bar span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #5fd7f7, #ffd16c);
    border-radius: inherit;
  }
  .syringe strong {
    color: #cbd8dc;
  }

  .chamber-art {
    position: relative;
    height: 210px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: rgba(255,255,255,0.045);
    border: 1px solid rgba(255,255,255,0.06);
    margin-bottom: 12px;
  }
  .cuvette {
    position: relative;
    width: 54px;
    height: 150px;
    border-radius: 8px 8px 16px 16px;
    border: 2px solid rgba(255,255,255,0.32);
    overflow: hidden;
    box-shadow: inset 0 0 18px rgba(255,255,255,0.06);
  }
  .cuvette i {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 48%;
    background: linear-gradient(180deg, #81d6e9, #1289a6);
  }
  .chamber-art.active .cuvette i {
    animation: chamberLiquid 1.5s ease-in-out infinite;
  }
  .swirl {
    position: absolute;
    left: 8px;
    right: 8px;
    height: 16px;
    border-radius: 50%;
    border-top: 2px solid rgba(255,255,255,0.34);
    border-bottom: 1px solid rgba(255,255,255,0.12);
    z-index: 2;
    opacity: 0;
  }
  .swirl.one { bottom: 42px; }
  .swirl.two { bottom: 28px; transform: rotate(180deg); }
  .chamber-art.active .swirl {
    opacity: 1;
    animation: stirSwirl 1.15s linear infinite;
  }
  .chamber-art.active .swirl.two {
    animation-delay: -0.45s;
  }
  .stir-bar {
    position: absolute;
    left: 16px;
    bottom: 14px;
    width: 22px;
    height: 5px;
    border-radius: 999px;
    background: rgba(230, 238, 238, 0.76);
    box-shadow: 0 0 10px rgba(96, 214, 247, 0.45);
    transform-origin: 50% 50%;
  }
  .chamber-art.active .stir-bar {
    animation: stirBar 0.8s linear infinite;
  }
  .measure-beam {
    position: absolute;
    top: 95px;
    width: 78px;
    height: 4px;
    opacity: 0;
    background: linear-gradient(90deg, transparent, rgba(120, 229, 255, 0.95), transparent);
    filter: drop-shadow(0 0 8px rgba(120, 229, 255, 0.75));
  }
  .beam-left {
    left: 24px;
  }
  .beam-right {
    right: 24px;
    transform: rotate(180deg);
  }
  .chamber-art.active .measure-beam {
    animation: sensorFlash 3.2s ease-in-out infinite;
  }
  .chamber-art.active .beam-right {
    animation-delay: 0.18s;
  }
  .chamber p {
    margin-top: 5px;
    color: #9daeb5;
  }
  .chamber-progress {
    height: 8px;
    margin-top: 10px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.06);
  }
  .chamber-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #35c8e8, #ffd16c);
    box-shadow: 0 0 14px rgba(53, 200, 232, 0.36);
    transition: width 0.5s ease;
  }

  .status-list h2 {
    font-size: 16px;
    margin-bottom: 12px;
  }
  .status-list div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 0;
    border-top: 1px solid rgba(255,255,255,0.08);
  }
  .status-list b {
    text-align: right;
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    padding: 24px;
    color: #91a2a9;
  }
  .empty.compact {
    padding: 10px;
  }

  @keyframes wave {
    0%, 100% { transform: translateX(-4px); }
    50% { transform: translateX(4px); }
  }
  @keyframes liquidPulse {
    0%, 100% { filter: brightness(1); }
    50% { filter: brightness(1.12); }
  }
  @keyframes syringeCollect {
    0%, 9% { left: var(--source-a-left); }
    18%, 34% { left: var(--chamber-left); }
    44%, 55% { left: var(--source-b-left); }
    67%, 100% { left: var(--chamber-left); }
  }
  @keyframes syringeZAxis {
    0%, 2%, 9%, 18%, 20%, 34%, 44%, 45%, 55%, 67%, 69%, 96%, 100% {
      transform: translateY(0);
    }
    3%, 7%, 21%, 32%, 46%, 53%, 70%, 90% {
      transform: translateY(30px);
    }
  }
  @keyframes syringeFill {
    0%, 3%, 34%, 46%, 67%, 90%, 100% {
      opacity: 0.4;
      transform: scaleY(0.15);
      transform-origin: bottom;
    }
    7%, 21%, 53%, 70% {
      opacity: 0.9;
      transform: scaleY(1);
      transform-origin: bottom;
    }
    22%, 32%, 71%, 81% {
      opacity: 0.72;
      transform: scaleY(0.15);
      transform-origin: bottom;
    }
  }
  @keyframes needleDropletFall {
    0%, 21%, 33%, 70%, 82%, 100% {
      opacity: 0;
      transform: translate(-50%, 0) scale(0.65);
    }
    25%, 74% {
      opacity: 1;
      transform: translate(-50%, 10px) scale(1);
    }
    31%, 81% {
      opacity: 0.18;
      transform: translate(-50%, 42px) scale(0.72);
    }
  }
  @keyframes chamberLiquid {
    0%, 100% { height: 48%; filter: hue-rotate(0deg); }
    50% { height: 53%; filter: hue-rotate(18deg); }
  }
  @keyframes stirSwirl {
    0% { transform: translateX(-5px) scaleX(0.88); }
    50% { transform: translateX(5px) scaleX(1.08); }
    100% { transform: translateX(-5px) scaleX(0.88); }
  }
  @keyframes stirBar {
    to { transform: rotate(360deg); }
  }
  @keyframes sensorFlash {
    0%, 18%, 100% { opacity: 0; transform: translateX(0); }
    24%, 32% { opacity: 1; transform: translateX(12px); }
  }
  @keyframes measurementFlash {
    0%, 17%, 36%, 100% {
      opacity: 0;
      transform: scaleX(0.35);
    }
    21%, 26% {
      opacity: 1;
      transform: scaleX(1);
    }
    30% {
      opacity: 0.25;
      transform: scaleX(1.12);
    }
  }

  @media (max-width: 1350px) {
    .header-metrics {
      grid-template-columns: repeat(3, minmax(120px, 1fr));
    }
    .test-grid {
      grid-template-columns: repeat(3, minmax(128px, 1fr));
    }
  }

  @media (max-width: 1100px) {
    .header-metrics {
      grid-template-columns: repeat(2, minmax(120px, 1fr));
    }
    .maintenance-bar {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    .page { padding: 12px; }
    .header {
      grid-template-columns: auto 1fr;
    }
    .header-metrics {
      grid-column: 1 / -1;
      width: 100%;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .header-metrics div {
      min-width: 0;
      flex: 1;
    }
    .machine {
      min-height: 0;
      overflow-x: auto;
      padding-bottom: 10px;
      scrollbar-color: rgba(102, 215, 247, 0.35) rgba(255,255,255,0.08);
    }
    .machine-frame {
      width: 920px;
      min-width: 920px;
      max-width: none;
      height: 510px;
    }
    .syringe-carriage {
      top: 38px;
    }
    .test-grid {
      grid-template-columns: repeat(2, minmax(128px, 1fr));
    }
    .operation-strip {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px 10px;
      min-height: 58px;
      padding: 11px 12px;
    }
    .operation-strip-meta {
      grid-column: 1 / -1;
      justify-self: start;
      min-width: 0;
    }
    .vial-dialog-body {
      grid-template-columns: 1fr;
      gap: 18px;
    }
    .vial-dialog-visual .vial-cap {
      width: 104px;
      height: 40px;
    }
    .vial-dialog-visual .vial {
      width: 104px;
      height: 260px;
    }
  }

  @media (max-width: 480px) {
    .page {
      padding: 6px;
    }
    .dialog-backdrop {
      padding: 10px;
    }
    .dialog-card {
      border-radius: 12px;
      padding: 16px;
      max-height: 92vh;
    }
    .vial-dialog-header {
      margin-bottom: 14px;
    }
    .vial-dialog-header h2 {
      font-size: 21px;
    }
    .vial-dialog-visual .vial-cap {
      width: 96px;
      height: 38px;
    }
    .vial-dialog-visual .vial {
      width: 96px;
      height: 238px;
    }
    .vial-dialog-visual .vial span {
      font-size: 20px;
    }
    .vial-dialog-actions {
      display: grid;
      grid-template-columns: 1fr;
    }
    .vial-dialog-actions button {
      width: 100%;
      min-height: 46px;
    }
    .test-grid { grid-template-columns: 1fr; }
    .operation-strip {
      border-radius: 8px;
      padding: 10px;
    }
    .operation-strip-main span {
      font-size: 10px;
    }
    .operation-strip-main strong {
      font-size: 14px;
    }
    .operation-strip-time {
      font-size: 20px;
    }
    .operation-strip.idle .operation-strip-time {
      font-size: 15px;
    }
    .operation-strip-meta {
      font-size: 11px;
      padding: 6px 9px;
    }
    .machine {
      width: calc(100vw - 2px);
      height: 272px;
      min-height: 0;
      margin-left: calc(50% - 50vw + 1px);
      overflow: visible;
      padding-bottom: 0;
    }
    .machine-frame {
      width: 880px;
      min-width: 880px;
      height: 500px;
      border-width: 8px;
      margin: 0;
      transform: scale(0.543);
      transform-origin: top left;
    }
    .syringe-carriage {
      top: 36px;
    }
  }

  @media (max-width: 460px) {
    .machine {
      height: 260px;
    }
    .machine-frame {
      transform: scale(0.52);
    }
  }

  @media (max-width: 440px) {
    .machine {
      height: 243px;
    }
    .machine-frame {
      transform: scale(0.486);
    }
  }

  @media (max-width: 420px) {
    .machine {
      height: 232px;
    }
    .machine-frame {
      transform: scale(0.463);
    }
  }

  @media (max-width: 400px) {
    .machine {
      height: 221px;
    }
    .machine-frame {
      transform: scale(0.441);
    }
  }

  @media (max-width: 380px) {
    .machine {
      height: 209px;
    }
    .machine-frame {
      transform: scale(0.418);
    }
  }
`;
