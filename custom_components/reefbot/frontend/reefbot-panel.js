class ReefBotPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = undefined;
    this._lastRender = 0;
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
  }

  render() {
    if (!this._hass) {
      this.shadowRoot.innerHTML = `<style>${styles}</style><main class="page"><div class="empty">Loading ReefBot...</div></main>`;
      return;
    }

    const model = buildModel(this._hass);
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
      button.addEventListener("click", () => this.pressButton(button.dataset.press));
    });
  }

  pressButton(entityId) {
    if (!entityId || !this._hass) return;
    this._hass.callService("button", "press", { entity_id: entityId });
  }
}

customElements.define("reefbot-panel", ReefBotPanel);

function buildModel(hass) {
  const states = Object.values(hass.states);
  const tubes = states
    .filter((state) => state.attributes?.tube_number)
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
      return {
        entityId: state.entity_id,
        name,
        value: state.state,
        unit: state.attributes.unit_of_measurement || "",
        history: extractHistory(state),
        button: findTestButton(states, name),
      };
    });

  const configuredTests = states
    .filter(isConfiguredTestSensor)
    .map((state) => ({
      name: state.attributes.display_name || state.attributes.friendly_name || state.entity_id,
      latest: state.attributes.latest_result,
    }));

  return {
    tubes,
    tests,
    configuredTests,
    rodi: componentModel(states, "rodi", ["rodi", "rodi tank", "ro tank"]),
    waste: componentModel(states, "waste", ["waste"]),
    syringe: componentModel(states, "syringe", ["syringe"]),
    online: findOnline(states),
    currentOperation: findByName(states, ["current operation"]),
    pending: findByName(states, ["pending operations"]),
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
        <button class="play" ${button ? `data-press="${button.entity_id}"` : "disabled"} ${disabled} title="Start test">
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
  return `
    <section class="machine">
      <div class="machine-frame">
        <div class="top-rail"></div>
        <div class="cable-chain">
          ${Array.from({ length: 15 }, (_, index) => `<i style="--i:${index}"></i>`).join("")}
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
  const height = clamp(tube.percentage, 4, 100);
  const label = `${formatNumber(tube.current)} ${tube.unit}`;
  return `
    <article class="vial-card">
      <button class="mini-reset" ${tube.refillButton ? `data-press="${tube.refillButton.entity_id}"` : "disabled"} title="Refill tube">
        <ha-icon icon="mdi:restore"></ha-icon>
      </button>
      <div class="vial" style="--fill:${height}%; --liquid:${tube.color}">
        <span>${escapeHtml(label)}</span>
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
        <button ${action ? `data-press="${action.entity_id}"` : "disabled"}>${actionLabel}</button>
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
        <button ${action ? `data-press="${action.entity_id}"` : "disabled"}>Replace</button>
      </div>
      <div class="usage-bar">
        <span style="width:${fill}%"></span>
      </div>
      <strong>${escapeHtml(component?.display || "-")}</strong>
    </section>
  `;
}

function renderChamber(model) {
  const current = model.currentOperation;
  const pending = model.pending;
  const operation = current?.state && current.state !== "unknown" && current.state !== "unavailable" ? current.state : "Idle";
  const pendingValue = pending?.state && pending.state !== "unknown" ? pending.state : "0";
  const active = operation !== "Idle" || pendingValue !== "0";
  return `
    <section class="chamber">
      <div class="section-title small">
        <h2>Test chamber</h2>
        <span class="${active ? "warn" : "good"}">${active ? "Active" : "Idle"}</span>
      </div>
      <div class="chamber-art ${active ? "active" : ""}">
        <div class="cuvette"><i></i></div>
        <div class="progress-ring"><span></span></div>
      </div>
      <strong>${escapeHtml(operation)}</strong>
      <p>${escapeHtml(pendingValue)} pending operation${pendingValue === "1" ? "" : "s"}</p>
    </section>
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

function findButton(states, terms) {
  return states.find((state) => {
    if (!state.entity_id.startsWith("button.")) return false;
    const name = entityName(state).toLowerCase();
    return terms.some((term) => name.includes(term.toLowerCase()));
  });
}

function findTestButton(states, testName) {
  const key = normalize(testName);
  return states.find((state) => {
    if (!state.entity_id.startsWith("button.")) return false;
    const name = normalize(entityName(state));
    return name.includes(key) || key.includes(name);
  });
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
  return state.attributes?.friendly_name || state.entity_id;
}

function formatReading(value, unit) {
  if (value === undefined || value === null || value === "unknown" || value === "unavailable") return "-";
  return `${formatNumber(value)} ${unit || ""}`.trim();
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

function shortenChemical(name) {
  return String(name || "")
    .replace(/^Tube\s+\d+:\s*/i, "")
    .replace(/\s*\((ppm|dkh|mg\/l)\)\s*$/i, "")
    .trim();
}

function chemicalColor(name, index) {
  const text = String(name).toLowerCase();
  if (text.includes("kh") || text.includes("alk")) return "#d9b35f";
  if (text.includes("no3") || text.includes("nitrate")) return "#d7895b";
  if (text.includes("no2") || text.includes("nitrite")) return "#b889df";
  if (text.includes("po4") || text.includes("phosphate")) return "#5eb7c7";
  if (text.includes("calcium")) return "#d96f8f";
  const palette = ["#d9a85f", "#67b7dc", "#8ecf80", "#d68adf", "#dd756c", "#75c7a8", "#c7b05e", "#8fa7e8"];
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
    grid-template-columns: auto 1fr auto;
    gap: 18px;
    align-items: center;
    margin-bottom: 18px;
  }
  .brand-mark {
    width: 74px;
    height: 74px;
    border-radius: 18px;
    background: #1289a6;
    position: relative;
    overflow: hidden;
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.35);
  }
  .brand-mark span, .brand-mark i {
    position: absolute;
    top: 31px;
    height: 18px;
    border-radius: 12px;
    background: #fff;
    transform: rotate(-15deg);
  }
  .brand-mark span:nth-child(1) { left: 13px; width: 13px; }
  .brand-mark span:nth-child(2) { left: 30px; width: 19px; }
  .brand-mark span:nth-child(3) { left: 53px; width: 27px; }
  .brand-mark i { right: 9px; top: 25px; width: 12px; height: 12px; border-radius: 50%; }
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
  .cable-chain {
    position: absolute;
    width: 210px;
    height: 66px;
    left: 44%;
    top: 132px;
    border-radius: 60px;
    border: 12px solid rgba(70, 78, 84, 0.72);
    border-left-color: transparent;
    animation: drift 6s ease-in-out infinite;
  }
  .cable-chain i {
    position: absolute;
    width: 7px;
    height: 24px;
    left: calc(var(--i) * 12px);
    top: -7px;
    background: rgba(0,0,0,0.25);
    border-radius: 5px;
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
    margin-bottom: 8px;
  }
  .vial {
    position: relative;
    width: min(54px, 78%);
    height: 172px;
    margin: 0 auto 9px;
    border-radius: 11px 11px 18px 18px;
    background: linear-gradient(90deg, rgba(255,255,255,0.22), rgba(255,255,255,0.04) 30%, rgba(255,255,255,0.16));
    border: 2px solid rgba(255,255,255,0.28);
    overflow: hidden;
    box-shadow: inset 0 0 18px rgba(0,0,0,0.32), 0 10px 22px rgba(0,0,0,0.3);
  }
  .vial i {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: var(--fill);
    min-height: 8px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--liquid), white 20%), var(--liquid));
    opacity: 0.86;
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
  }
  .cuvette i {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 48%;
    background: linear-gradient(180deg, #81d6e9, #1289a6);
    animation: wave 4s ease-in-out infinite;
  }
  .progress-ring {
    position: absolute;
    width: 154px;
    height: 154px;
    border-radius: 50%;
    border: 5px solid rgba(255,255,255,0.08);
    border-top-color: #60d6f7;
    border-right-color: #60d6f7;
    animation: spin 3.8s linear infinite;
    opacity: 0.35;
  }
  .chamber-art.active .progress-ring {
    opacity: 1;
  }
  .chamber p {
    margin-top: 5px;
    color: #9daeb5;
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
  @keyframes drift {
    0%, 100% { transform: translateX(-8px); }
    50% { transform: translateX(8px); }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 1100px) {
    .content-grid {
      grid-template-columns: 1fr;
    }
    .left-rail, .right-rail {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .test-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
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
    .machine-frame {
      height: 760px;
    }
    .vial-row {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .test-grid {
      grid-template-columns: 1fr;
    }
  }
`;
