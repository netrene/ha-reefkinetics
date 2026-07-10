class ReefBotPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = undefined;
    this._lastRender = 0;
    this._narrow = false;
    this._lastPressed = undefined;
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
            <aside class="left-rail">
              ${renderReservoir(model.rodi, "RODI", "mdi:water", "rodi")}
              ${renderReservoir(model.waste, "Waste", "mdi:trash-can-outline", "waste")}
              ${renderSyringe(model.syringe)}
            </aside>

            <section class="center-stack">
              ${renderTests(model)}
              ${renderMachine(model)}
            </section>

            <aside class="right-rail">
              ${renderChamber(model)}
              ${renderStatus(model)}
            </aside>
          </section>
        </section>
      </main>
    `;

    this.shadowRoot.querySelectorAll("[data-press]").forEach((button) => {
      button.addEventListener("click", () => this.pressButton(button));
    });
    this.shadowRoot.querySelectorAll("[data-menu]").forEach((button) => {
      button.addEventListener("click", () => this.toggleMenu());
    });
    this.updateMenuButton();
  }

  pressButton(button) {
    const entityId = button?.dataset?.press;
    if (!entityId || !this._hass) return;
    const name = button.dataset.label || entityName(this._hass.states[entityId]) || entityId;
    this._lastPressed = {
      entityId,
      name,
      time: Date.now(),
    };
    this.render();
    this._hass.callService("button", "press", { entity_id: entityId });
    this.refreshReefBotEntities();
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
      latest: state.attributes.latest_result,
      button: findTestButton(states, [
        state.attributes.display_name,
        state.attributes.operation_name,
        state.attributes.method,
        state.state,
      ]),
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
        refillButton: findButton(states, [`tube ${number}: refill`, `refill tube ${number}`]),
      };
    });

  const tests = states
    .filter(isParameterSensor)
    .sort((a, b) => (a.attributes.parameter_name || a.attributes.friendly_name || "").localeCompare(b.attributes.parameter_name || b.attributes.friendly_name || ""))
    .slice(0, 6)
    .map((state) => {
      const name = state.attributes.parameter_name || state.attributes.friendly_name || state.entity_id;
      const configured = findConfiguredTestForParameter(configuredTests, name);
      return {
        entityId: state.entity_id,
        name,
        value: state.state,
        unit: state.attributes.unit_of_measurement || "",
        history: extractHistory(state),
        operationName: configured?.name,
        button: configured?.button || findTestButton(states, [name]),
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
    recentOperation: recentOperationFromHistory(findPendingOperationsSensor(states)),
    lastPressed,
    notifications: findByName(states, ["notifications"]),
    alarms: findByName(states, ["alarm logs", "safe margins"]),
    lastUpdate: findByName(states, ["last update", "letzte aktualisierung"]),
    lastSuccessfulTest: findByName(states, ["last successful test", "letzter erfolgreicher test"]),
  };
}

function renderHeader(model) {
  const online = model.online;
  const onlineText = online ? (online.state === "on" ? "Online" : "Offline") : "Unknown";
  const onlineClass = online?.state === "on" ? "good" : "warn";
  const lastUpdate = model.lastUpdate?.state && model.lastUpdate.state !== "unknown" ? model.lastUpdate.state : "-";
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
        <div><b class="${onlineClass}">${onlineText}</b><span>Status</span></div>
        <div><b>${escapeHtml(lastUpdate)}</b><span>Last update</span></div>
      </div>
    </header>
  `;
}

function renderTests(model) {
  const tests = model.tests.length ? model.tests : model.configuredTests;
  const cards = tests.slice(0, 5).map((test) => {
    const button = test.button;
    const disabled = button && button.state === "unavailable" ? "disabled" : "";
    return `
      <article class="test-card">
        <button class="play" ${button ? `data-press="${button.entity_id}" data-label="${escapeHtml(test.operationName || test.name)}"` : "disabled"} ${disabled} title="Start test">
          <ha-icon icon="mdi:play"></ha-icon>
        </button>
        <div class="test-main">
          <strong>${escapeHtml(test.name)}</strong>
          <span>${escapeHtml(formatReading(test.value, test.unit))}</span>
        </div>
        ${sparkline(test.history)}
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

function renderMachine(model) {
  const tubes = Array.from({ length: 8 }, (_, index) => model.tubes[index] || emptyTube(index + 1));
  const active = isChamberActive(model);
  return `
    <section class="machine">
      <div class="machine-frame ${active ? "active-test" : ""}">
        <div class="top-rail"></div>
        <div class="syringe-carriage">
          <div class="syringe-body"><span></span></div>
          <div class="syringe-needle"></div>
        </div>
        <div class="gantry"></div>
        <div class="led-strip"></div>
        <div class="vial-row">
          ${tubes.map(renderVial).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderVial(tube) {
  const height = clamp(tube.percentage * 0.86, 4, 86);
  const label = `${formatNumber(tube.current)} ${tube.unit}`;
  return `
    <article class="vial-card">
      <button class="mini-reset" ${tube.refillButton ? `data-press="${tube.refillButton.entity_id}" data-label="Refill Tube ${tube.number}"` : "disabled"} title="Refill tube">
        <ha-icon icon="mdi:restore"></ha-icon>
      </button>
      <div class="vial-cap"></div>
      <div class="vial" style="--fill:${height}%; --liquid:${tube.color}">
        <span>${escapeHtml(label)}</span>
        <em>20 mL</em>
        <i></i>
      </div>
      <strong>Tube ${tube.number}</strong>
      <p>${escapeHtml(tube.shortName)}</p>
    </article>
  `;
}

function renderReservoir(component, title, icon, type) {
  const fill = clamp(component?.percentage ?? 0, 0, 100);
  const action = component?.button;
  const actionLabel = type === "waste" ? "Empty" : "Refill";
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
        <h2>Syringe</h2>
        <button ${action ? `data-press="${action.entity_id}" data-label="Syringe: Replace"` : "disabled"}>Replace</button>
      </div>
      <div class="usage-bar">
        <span style="width:${fill}%"></span>
      </div>
      <strong>${escapeHtml(component?.display || "-")}</strong>
    </section>
  `;
}

function renderChamber(model) {
  const pendingValue = activeState(model.pending?.state) ? model.pending.state : "0";
  const chamber = chamberOperation(model);
  const operation = chamber.name || "Idle";
  const active = isChamberActive(model);
  const stateLabel = active ? "Active" : model.recentOperation ? "Last" : "Idle";
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
      <strong>${escapeHtml(operation)}</strong>
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
  if (currentActive && activeState(currentName)) {
    return {
      active: true,
      name: currentName,
      startedAt: parseDate(currentAttrs.added || currentAttrs.date || currentAttrs.request_date || currentAttrs.added_date),
      expectedAt: parseDate(currentAttrs.expected_completion_time || currentAttrs.expected_completion || currentAttrs.estimated_completion_time),
    };
  }

  const pending = firstPendingOperation(model.pending);
  if (pending) {
    return pending;
  }

  const recentPress = model.lastPressed && Date.now() - model.lastPressed.time < recentPressWindow(model.lastPressed.name)
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

function firstPendingOperation(pendingSensor) {
  const pending = pendingSensor?.attributes?.pending;
  if (!Array.isArray(pending)) return undefined;
  const item = pending.find((row) => activeState(row?.name || row?.operation || row?.display_name));
  if (!item) return undefined;
  return {
    active: true,
    name: item.name || item.operation || item.display_name,
    startedAt: parseDate(item.added || item.date || item.request_date || item.added_date),
    expectedAt: parseDate(item.expected_completion_time || item.expected_completion || item.estimated_completion_time),
  };
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
  if (durationMinutes === undefined || progress === undefined || remainingMinutes === undefined) {
    return undefined;
  }
  if (model.currentTestProgress?.attributes?.active === false) {
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
    const name = entityName(state).toLowerCase();
    return terms.some((term) => name === term || name.endsWith(` ${term}`) || name.includes(term));
  });
  if (!sensor) return undefined;
  const display = sensor.attributes.display_value || `${sensor.state} ${sensor.attributes.unit_of_measurement || sensor.attributes.unit || ""}`.trim();
  const percentage = numberValue(sensor.attributes.fill_percentage) ?? percent(sensor.attributes.current_value ?? sensor.state, sensor.attributes.capacity);
  return {
    sensor,
    display,
    percentage,
    button: findButton(states, [`${key}:`, key]),
  };
}

function findOnline(states) {
  return states.find((state) => state.entity_id.startsWith("binary_sensor.") && entityName(state).toLowerCase().includes("online"));
}

function findByName(states, terms) {
  return states.find((state) => {
    const name = entityName(state).toLowerCase();
    return terms.some((term) => name.includes(term));
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
    const name = entityName(state).toLowerCase();
    return terms.some((term) => name.includes(term.toLowerCase()));
  });
}

function isReefBotEntity(state) {
  const name = entityName(state).toLowerCase();
  return state.entity_id.includes("reefbot")
    || state.entity_id.includes("reef_bot")
    || name.includes("reefbot")
    || name.includes("reef bot");
}

function findTestButton(states, searchTerms) {
  const keys = searchTerms.flatMap((term) => searchAliases(term)).map(normalize).filter(Boolean);
  return states.find((state) => {
    if (!state.entity_id.startsWith("button.")) return false;
    const name = normalize(entityName(state));
    return keys.some((key) => name.includes(key) || key.includes(name));
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

function recentOperationFromHistory(pendingSensor) {
  const history = pendingSensor?.attributes?.recent_history;
  if (!Array.isArray(history)) return undefined;
  const item = history.find((row) => activeState(row?.name || row?.operation || row?.display_name));
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

function sparkline(values = []) {
  if (!values.length) {
    return `<svg class="spark" viewBox="0 0 80 28"><path d="M2 21 L78 21"></path></svg>`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = 2 + (index / Math.max(values.length - 1, 1)) * 76;
    const y = 24 - ((value - min) / range) * 20;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="spark" viewBox="0 0 80 28"><polyline points="${points}"></polyline></svg>`;
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
  const text = String(name).toLowerCase();
  if (text.includes("kh") || text.includes("alk")) return "#d7bd76";
  if (text.includes("no3") || text.includes("nitrate")) return "#cf865a";
  if (text.includes("no2") || text.includes("nitrite")) return "#c77b52";
  if (text.includes("po4") || text.includes("phosphate")) return "#b87955";
  if (text.includes("calcium")) return "#c56f72";
  const palette = ["#d7bd76", "#cf865a", "#c77b52", "#c18a5e", "#b87955", "#d09a6b", "#c08359", "#d3a15d"];
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
    display: flex;
    gap: 10px;
  }
  .header-metrics div, .tests, .reservoir, .syringe, .chamber, .status-list {
    background: rgba(16, 25, 28, 0.78);
    border: 1px solid rgba(156, 198, 211, 0.16);
    border-radius: 8px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
  }
  .header-metrics div {
    min-width: 150px;
    padding: 13px 15px;
  }
  .header-metrics b, .status-list b { display: block; font-size: 16px; }
  .header-metrics span, .status-list span, .section-title span { color: #90a2aa; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
  .good { color: #70d58a; }
  .warn { color: #ffd16c; }

  .content-grid {
    display: grid;
    grid-template-columns: 210px minmax(600px, 1fr) 260px;
    gap: 18px;
    align-items: stretch;
  }
  .left-rail, .right-rail, .center-stack {
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
  .section-title button, .mini-reset {
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
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    gap: 8px 10px;
    align-items: center;
    min-height: 104px;
    padding: 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(255, 255, 255, 0.06);
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
  .test-main strong {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .test-main span {
    display: block;
    color: #b9c6cb;
    margin-top: 3px;
  }
  .spark {
    grid-column: 1 / -1;
    width: 100%;
    height: 28px;
  }
  .spark path, .spark polyline {
    fill: none;
    stroke: #4fd2f2;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.9;
  }

  .machine {
    min-height: 560px;
  }
  .machine-frame {
    position: relative;
    height: 560px;
    overflow: hidden;
    border-radius: 14px;
    background:
      linear-gradient(145deg, transparent 0 5%, #252d31 5% 10%, transparent 10% 90%, #252d31 90% 95%, transparent 95%),
      linear-gradient(180deg, #1b2226 0%, #0c1113 100%);
    border: 12px solid #30383d;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.08),
      inset 0 40px 80px rgba(0, 0, 0, 0.45),
      0 24px 54px rgba(0, 0, 0, 0.35);
  }
  .machine-frame::before {
    content: "";
    position: absolute;
    inset: 26px;
    border-radius: 8px;
    background: linear-gradient(180deg, rgba(255,255,255,0.05), transparent 30%);
    border: 1px solid rgba(255,255,255,0.07);
  }
  .top-rail {
    position: absolute;
    left: 8%;
    right: 8%;
    top: 56px;
    height: 34px;
    border-radius: 0 0 12px 12px;
    background: #30363a;
    box-shadow: inset 0 -12px 18px rgba(0,0,0,0.22);
  }
  .syringe-carriage {
    position: absolute;
    left: calc(4.5% + (91% / 16) - 40px);
    top: 58px;
    width: 64px;
    height: 190px;
    z-index: 2;
    opacity: 0.92;
    transform: translateX(0);
  }
  .active-test .syringe-carriage {
    animation: syringeTravel 8s ease-in-out infinite;
  }
  .syringe-carriage::before {
    content: "";
    position: absolute;
    left: 17px;
    top: 0;
    width: 30px;
    height: 26px;
    border-radius: 7px;
    background:
      linear-gradient(135deg, rgba(255,255,255,0.08), transparent 45%),
      #151b1f;
    border: 1px solid rgba(210, 225, 230, 0.22);
    box-shadow: 0 8px 18px rgba(0,0,0,0.34);
  }
  .syringe-carriage::after {
    content: "";
    position: absolute;
    left: 29px;
    top: 24px;
    width: 6px;
    height: 17px;
    border-radius: 4px;
    background: rgba(210, 225, 230, 0.72);
  }
  .syringe-body {
    position: absolute;
    left: 23px;
    top: 38px;
    width: 18px;
    height: 112px;
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
    bottom: 14px;
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.15)),
      rgba(108, 215, 241, 0.34);
  }
  .syringe-body span::before {
    content: "";
    position: absolute;
    left: -7px;
    top: 8px;
    width: 5px;
    height: 86px;
    background:
      repeating-linear-gradient(180deg, rgba(8, 12, 14, 0.86) 0 1px, transparent 1px 6px);
    opacity: 0.75;
  }
  .syringe-body::after {
    content: "";
    position: absolute;
    left: -16px;
    right: -16px;
    bottom: 22px;
    height: 7px;
    border-radius: 999px;
    background: rgba(210, 220, 222, 0.52);
    box-shadow: 0 0 0 1px rgba(210, 225, 230, 0.18), 0 3px 8px rgba(0,0,0,0.28);
  }
  .syringe-needle {
    position: absolute;
    left: 31px;
    top: 150px;
    width: 2px;
    height: 30px;
    background: rgba(200, 218, 222, 0.72);
    box-shadow: 0 0 8px rgba(108, 215, 241, 0.28);
  }
  .syringe-needle::after {
    content: "";
    position: absolute;
    left: -4px;
    bottom: -8px;
    border-top: 9px solid rgba(105, 215, 244, 0.8);
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    filter: drop-shadow(0 0 6px rgba(105, 215, 244, 0.5));
  }
  .gantry {
    position: absolute;
    left: 9%;
    right: 9%;
    bottom: 142px;
    height: 18px;
    background: #252b2f;
    border-radius: 9px;
    box-shadow: 0 -16px 0 rgba(255,255,255,0.06), 0 18px 32px rgba(0,0,0,0.35);
  }
  .led-strip {
    position: absolute;
    left: 9%;
    right: 9%;
    bottom: 174px;
    height: 3px;
    background: linear-gradient(90deg, #11b8e5, #e7b75f, #8ad37d, #11b8e5);
    box-shadow: 0 0 16px rgba(17, 184, 229, 0.6);
  }
  .vial-row {
    position: absolute;
    left: 4.5%;
    right: 4.5%;
    bottom: 26px;
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 9px;
    align-items: end;
  }
  .vial-card {
    text-align: center;
    min-width: 0;
  }
  .mini-reset {
    width: 32px;
    height: 28px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    margin-bottom: 9px;
  }
  .vial-cap {
    width: min(50px, 72%);
    height: 24px;
    margin: 0 auto -2px;
    border-radius: 8px 8px 4px 4px;
    background:
      linear-gradient(90deg, rgba(255,255,255,0.08), transparent 30%),
      linear-gradient(180deg, #22282c, #090d0f);
    border: 1px solid rgba(255,255,255,0.16);
    box-shadow: 0 5px 10px rgba(0,0,0,0.36);
    position: relative;
    z-index: 2;
  }
  .vial {
    position: relative;
    width: min(52px, 76%);
    height: 166px;
    margin: 0 auto 9px;
    border-radius: 8px 8px 18px 18px;
    background:
      linear-gradient(90deg, rgba(255,255,255,0.22), rgba(255,255,255,0.035) 32%, rgba(255,255,255,0.13)),
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
    top: -7px;
    width: 140%;
    height: 14px;
    border-radius: 50%;
    background: rgba(255,255,255,0.25);
    animation: wave 4s ease-in-out infinite;
  }
  .vial em {
    position: absolute;
    left: -8px;
    right: -8px;
    top: 10.5%;
    z-index: 2;
    height: 1px;
    font-style: normal;
    font-size: 9px;
    line-height: 1;
    color: rgba(230, 238, 238, 0.68);
    text-shadow: 0 1px 3px rgba(0,0,0,0.7);
    border-top: 1px solid rgba(230, 238, 238, 0.42);
    text-align: right;
    padding-right: 2px;
  }
  .vial span {
    position: absolute;
    inset: auto 2px 46%;
    z-index: 1;
    font-size: 11px;
    color: #fff;
    text-shadow: 0 1px 4px rgba(0,0,0,0.7);
  }
  .vial-card strong {
    display: block;
    font-size: 12px;
    color: #a9bac1;
  }
  .vial-card p {
    min-height: 32px;
    color: #edf7fa;
    font-size: 12px;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
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
  @keyframes syringeTravel {
    0%, 100% { transform: translateX(0); }
    18% { transform: translateX(0); }
    42% { transform: translateX(345%); }
    70% { transform: translateX(700%); }
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

  @media (max-width: 1350px) {
    .content-grid {
      grid-template-columns: 240px minmax(0, 1fr);
    }
    .right-rail {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .test-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 1100px) {
    .content-grid {
      grid-template-columns: 1fr;
    }
    .left-rail, .right-rail {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .active-test .syringe-carriage {
      animation: syringeTravelTablet 8s ease-in-out infinite;
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
    }
    .header-metrics div {
      min-width: 0;
      flex: 1;
    }
    .left-rail, .right-rail {
      grid-template-columns: 1fr;
    }
    .machine {
      min-height: 0;
      overflow-x: auto;
      padding-bottom: 10px;
      scrollbar-color: rgba(102, 215, 247, 0.35) rgba(255,255,255,0.08);
    }
    .machine-frame {
      width: 920px;
      max-width: none;
      height: 560px;
    }
    .syringe-carriage {
      top: 58px;
    }
    .test-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 480px) {
    .machine-frame {
      width: 860px;
      height: 540px;
      border-width: 8px;
    }
    .syringe-carriage {
      top: 56px;
    }
  }

  @keyframes syringeTravelTablet {
    0%, 100% { transform: translateX(0); }
    18% { transform: translateX(0); }
    42% { transform: translateX(345%); }
    70% { transform: translateX(700%); }
  }
`;
