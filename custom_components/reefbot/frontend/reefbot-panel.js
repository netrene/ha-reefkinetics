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
    this._maintenance = false;
    this._maintenanceView = "carousel";
    this._configOpen = false;
    this._configState = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._configOpen) return; // Editor offen: kein Re-Render (würde Selects zurücksetzen)
    const now = Date.now();
    let refreshInterval = this._activeVial || this._maintenance ? 60000 : this._activeDialog || this._confirmAction ? 15000 : 3000;
    if (this._activeVial && isChamberActive(buildModel(hass, this._lastPressed))) {
      this._activeVial = undefined;
      refreshInterval = 0;
    }
    if (!this.shadowRoot.innerHTML || now - this._lastRender > refreshInterval) {
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
    this.teardownLabCarousel();
    this.teardownMaintenanceCarousel();
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
              ${renderLabDemoToggle(model)}
              ${renderMachine(model)}
              ${renderMaintenanceEntry(model)}
              ${renderConfigEntry(model)}
              ${renderMaintenance(model)}
            </section>
          </section>
        </section>
        ${renderMaintenanceOverlay(model, this._maintenance, this._maintenanceView)}
        ${renderConfigOverlay(model, this._configOpen, this._configState)}
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
    this.shadowRoot.querySelectorAll("[data-lab-demo]").forEach((button) => {
      button.addEventListener("click", () => {
        LAB_DEMO = !LAB_DEMO;
        this._labState = { cur: 0, tgt: 0 };
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-lab-demo-active]").forEach((button) => {
      button.addEventListener("click", () => {
        DEMO_ANIM = !DEMO_ANIM;
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-open-maintenance]").forEach((button) => {
      button.addEventListener("click", () => {
        this._activeVial = undefined;
        this._activeDialog = undefined;
        this._maintenance = true;
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-close-maintenance]").forEach((element) => {
      element.addEventListener("click", () => {
        this._maintenance = false;
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-maint-view]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._maintenanceView = button.dataset.maintView;
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-open-config]").forEach((button) => {
      button.addEventListener("click", () => {
        this._activeVial = undefined;
        this._activeDialog = undefined;
        this._maintenance = false;
        this._configState = buildTestConfig(model);
        this._configOpen = true;
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-close-config]").forEach((element) => {
      element.addEventListener("click", () => {
        this._configOpen = false;
        this._configState = null;
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-config-add]").forEach((button) => {
      button.addEventListener("click", () => {
        const kit = (this._configState?.catalog || []).find((k) => String(k.operationId) === button.dataset.configAdd);
        if (kit) this._configState = cfgWithKitAdded(this._configState, kit);
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-config-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        if (this._configState) this._configState = cfgWithKitRemoved(this._configState, button.dataset.configRemove);
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-config-save]").forEach((button) => {
      button.addEventListener("click", () => this.requestConfigSave());
    });
    if (model.labMode) this.mountLabCarousel(model);
    else this.teardownLabCarousel();
    if (this._maintenance && this._maintenanceView !== "list") this.mountMaintenanceCarousel(model);
    else this.teardownMaintenanceCarousel();
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
    if (action?.kind === "config") {
      this.saveConfig(action.positions);
      return;
    }
    this.executeButtonPress(action);
  }

  requestConfigSave() {
    if (!this._configState) return;
    const positions = cfgFlattenPositions(this._configState);
    this._confirmAction = { kind: "config", positions, name: "Test-Konfiguration" };
    this.render();
  }

  saveConfig(positions) {
    this._configOpen = false;
    this._configState = null;
    this._confirmAction = undefined;
    this.render();
    if (this._hass && Array.isArray(positions)) {
      this._hass.callService("reefbot", "set_chemical_positions", { positions });
      this.refreshReefBotEntities();
    }
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

  mountLabCarousel(model) {
    const canvas = this.shadowRoot.querySelector(".lab-canvas");
    const stage = this.shadowRoot.querySelector(".lab-stage");
    const labelsEl = this.shadowRoot.querySelector(".lab-labels");
    if (!canvas || !stage || !labelsEl) return;
    if (this._lab) {
      window.cancelAnimationFrame(this._lab.raf);
      this._lab.cleanup?.();
    }

    const tubes = model.tubes;
    const count = tubes.length;
    if (!this._labState || this._labCount !== count) {
      this._labState = { cur: 0, tgt: 0 };
      this._labCount = count;
    }
    const state = this._labState;

    const activeReal = isChamberActive(model);
    let lockFront = null;
    if (activeReal) {
      const activeTubes = activeTubeNumbers(model, chamberOperation(model).name, count);
      if (activeTubes.length) lockFront = activeTubes[0] - 1;
    } else if (model.demoAnimate) {
      lockFront = 0;
    }
    const active = activeReal || model.demoAnimate;
    if (lockFront != null) state.tgt = lockFront;

    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const width = canvas.clientWidth || stage.clientWidth || 600;
      canvas.width = width * dpr;
      canvas.height = 470 * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    this.shadowRoot.querySelectorAll("[data-lab-rotate]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (lockFront != null) return;
        state.tgt += Number(btn.dataset.labRotate) || 0;
      });
    });
    const tapEl = this.shadowRoot.querySelector("[data-lab-tap]");
    if (tapEl) {
      tapEl.addEventListener("click", () => {
        if (lockFront != null) return;
        const sel = ((Math.round(state.tgt) % count) + count) % count;
        this._activeDialog = undefined;
        this._activeVial = tubes[sel].number;
        this.render();
      });
    }

    let drag = false;
    let lastX = 0;
    const onDown = (event) => {
      if (lockFront != null) return;
      drag = true;
      lastX = event.clientX;
      stage.style.cursor = "grabbing";
    };
    const onMove = (event) => {
      if (!drag) return;
      const rx = Math.min(170, Math.max(140, (canvas.clientWidth || 600) * 0.37));
      state.cur -= (event.clientX - lastX) / (rx * 0.9);
      lastX = event.clientX;
    };
    const onUp = () => {
      if (!drag) return;
      drag = false;
      stage.style.cursor = "grab";
      state.tgt = Math.round(state.cur);
    };
    stage.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("resize", resize);
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("resize", resize);
    };

    const frame = (time) => {
      if (!canvas.isConnected) {
        cleanup();
        return;
      }
      if (!drag) state.cur += (state.tgt - state.cur) * 0.18;
      const sel = ((Math.round(state.tgt) % count) + count) % count;
      drawLabCarousel(ctx, canvas.width / dpr, 470, tubes, state.cur, sel, time, active);
      labelsEl.innerHTML = labNeighborLabels(tubes, sel);
      this._lab.raf = window.requestAnimationFrame(frame);
    };
    this._lab = { raf: window.requestAnimationFrame(frame), cleanup };
  }

  teardownLabCarousel() {
    if (this._lab) {
      window.cancelAnimationFrame(this._lab.raf);
      this._lab.cleanup?.();
      this._lab = undefined;
    }
  }

  mountMaintenanceCarousel(model) {
    const canvas = this.shadowRoot.querySelector(".maint-canvas");
    const stage = this.shadowRoot.querySelector(".maint-stage");
    if (!canvas || !stage) return;
    if (this._maint) {
      window.cancelAnimationFrame(this._maint.raf);
      this._maint.cleanup?.();
    }

    const tubes = model.tubes;
    const count = tubes.length;
    if (!this._maintState || this._maintCount !== count) {
      this._maintState = { cur: 0, tgt: 0 };
      this._maintCount = count;
    }
    const state = this._maintState;
    const selTube = () => tubes[((Math.round(state.tgt) % count) + count) % count];

    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const width = canvas.clientWidth || stage.clientWidth || 480;
      const height = canvas.clientHeight || 300;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const nameEl = this.shadowRoot.querySelector(".maint-front-name");
    const metaEl = this.shadowRoot.querySelector(".maint-front-meta");
    const refillBtn = this.shadowRoot.querySelector("[data-maint-refill]");
    const frontEl = this.shadowRoot.querySelector("[data-maint-vialtap]");

    this.shadowRoot.querySelectorAll("[data-maint-rotate]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        state.tgt += Number(btn.dataset.maintRotate) || 0;
      });
    });
    if (frontEl) {
      frontEl.addEventListener("click", (event) => {
        if (event.target?.closest?.("[data-maint-refill]")) return;
        const tube = selTube();
        this._activeDialog = undefined;
        this._activeVial = tube.number;
        this.render();
      });
    }
    if (refillBtn) {
      refillBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const tube = selTube();
        if (!tube.refillButton) return;
        this._activeVial = undefined;
        this._confirmAction = {
          entityId: tube.refillButton.entity_id,
          name: `Röhrchen ${tube.number} auffüllen: ${tube.shortName}`,
          kind: "refill",
        };
        this.render();
      });
    }

    let drag = false;
    let lastX = 0;
    const onDown = (event) => {
      drag = true;
      lastX = event.clientX;
      stage.style.cursor = "grabbing";
    };
    const onMove = (event) => {
      if (!drag) return;
      const rx = Math.min((canvas.clientWidth || 480) * 0.33, 150);
      state.cur -= (event.clientX - lastX) / (rx * 0.9);
      lastX = event.clientX;
    };
    const onUp = () => {
      if (!drag) return;
      drag = false;
      stage.style.cursor = "grab";
      state.tgt = Math.round(state.cur);
    };
    stage.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("resize", resize);
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("resize", resize);
    };

    const frame = () => {
      if (!canvas.isConnected) {
        cleanup();
        return;
      }
      if (!drag) state.cur += (state.tgt - state.cur) * 0.18;
      const sel = ((Math.round(state.tgt) % count) + count) % count;
      drawMaintenanceCarousel(ctx, canvas.width / dpr, canvas.height / dpr, tubes, state.cur, sel);
      const tube = tubes[sel];
      if (nameEl) nameEl.textContent = `${tube.number} · ${tube.shortName}`;
      if (metaEl) metaEl.textContent = `${formatNumber(tube.current)} / ${formatNumber(tube.capacity)} ${tube.unit} · ${maintFillPct(tube)}%`;
      if (refillBtn) refillBtn.disabled = !tube.refillButton;
      this._maint.raf = window.requestAnimationFrame(frame);
    };
    this._maint = { raf: window.requestAnimationFrame(frame), cleanup };
  }

  teardownMaintenanceCarousel() {
    if (this._maint) {
      window.cancelAnimationFrame(this._maint.raf);
      this._maint.cleanup?.();
      this._maint = undefined;
    }
  }
}

customElements.define("reefbot-panel", ReefBotPanel);

// 1:1 aus TestDurations.kt (App-Repo, data/TestDurations.kt). Matching
// case-insensitiv "Name enthält Alias". Beim Ändern beide Dateien synchron
// halten — siehe docs/ha-parity.md (Gap 3).
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

  // --- ReefBot Lab: zusätzliche Testkits (Quelle: "ReefbotLab reagents"-Sheet
  //     von Reef Kinetics, Stand 2026-07). Der Lab unterstützt deutlich mehr
  //     Kits als der V2. Dauer = Spalte "Test Duration(min)".
  { names: ["API pH Wide Range", "API pH WIDE RANGE"], minutes: 25 },
  { names: ["Elos KH Wateranalysis", "Elos KH", "Elos Alkalinity"], minutes: 24 },
  { names: ["Elos Cu Wateranalysis", "Elos Copper", "Elos Cu"], minutes: 37 },
  { names: ["Elos Phosphate", "Elos PO4"], minutes: 35 },
  { names: ["Elos Ammonium", "Elos Ammonia"], minutes: 52 },
  { names: ["Elos pH"], minutes: 20 },
  { names: ["Elos GH"], minutes: 20 },
  { names: ["Elos Iron"], minutes: 40 },
  { names: ["Elos NO2 Wateranalysis", "Elos NO2", "Elos Nitrite"], minutes: 24 },
  { names: ["Giesemann Ammonia", "Giesmann Ammonia"], minutes: 59 },
  { names: ["Giesemann Ammonium", "Giesmann Ammonium"], minutes: 60 },
  { names: ["Giesemann Nitrite", "Giesmann Nitrite"], minutes: 20 },
  { names: ["Giesemann Iron", "Giesmann Iron"], minutes: 40 },
  { names: ["Giesemann Aquaristic Iodine", "Giesemann Iodine"], minutes: 45 },
  { names: ["Colombo Iodine"], minutes: 45 },
  { names: ["Monitor Chlorine"], minutes: 24 },
  { names: ["Monitor Nitrite"], minutes: 24 },
  { names: ["Monitor Calcium Saltwater"], minutes: 37 },
  { names: ["Monitor Calcium Freshwater"], minutes: 37 },
  { names: ["Monitor Alkalinity Reef"], minutes: 35 },
  { names: ["Monitor Total Alkalinity"], minutes: 35 },
  { names: ["Monitor pH saltwater"], minutes: 24 },
  { names: ["Monitor pH Freshwater"], minutes: 24 },
  { names: ["Monitor Ammonia"], minutes: 37 },
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
  { names: ["NTLABS General Hardness", "NTLABS GH"], minutes: 37 },
  { names: ["Pentair Pool Alkalinity"], minutes: 48 },
  { names: ["Poolmaster Chlorine"], minutes: 29 },
  { names: ["Poolmaster Bromine"], minutes: 30 },
  { names: ["Aquaforest Alkalinity"], minutes: 41 },
  { names: ["JBL Alkalinity"], minutes: 37 },
  { names: ["JBL General Hardness", "JBL GH"], minutes: 20 },
  { names: ["JBL Silicate"], minutes: 45 },
  { names: ["JBL Carbon dioxide", "JBL CO2"], minutes: 37 },
  { names: ["JBL Iron"], minutes: 37 },
  { names: ["JBL pH"], minutes: 37 },
  { names: ["H2Ocean Magnesium"], minutes: 59 },
  { names: ["H2Ocean Alkalinity"], minutes: 27 },
  { names: ["Sera Chlorine"], minutes: 29 },
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
    }))
    .filter((test) => test.button);

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
        chemicalId: state.attributes.chemical_id != null ? String(state.attributes.chemical_id) : null,
        current: numberValue(state.attributes.current_volume ?? state.state),
        capacity: numberValue(state.attributes.capacity) ?? 20,
        percentage: clamp(numberValue(state.attributes.fill_percentage) ?? percent(state.attributes.current_volume ?? state.state, state.attributes.capacity ?? 20), 0, 100),
        unit: state.attributes.unit || state.attributes.unit_of_measurement || "mL",
        color: chemicalColor(state.attributes.chemical_display_name || state.attributes.friendly_name || "", number),
        refillButton: findTubeRefillButton(states, number),
      };
    });

  const parameterSensors = states
    .filter(isParameterSensor)
    .sort((a, b) => (a.attributes.parameter_name || a.attributes.friendly_name || "").localeCompare(b.attributes.parameter_name || b.attributes.friendly_name || ""));

  const tests = configuredTests.length
    ? configuredTests.map((configured) => {
      const state = findParameterSensorForConfiguredTest(parameterSensors, configured);
      const latestValue = configured.latest?.value;
      const latestUnit = configured.latest?.unit;
      const fallbackHistory = [numberValue(latestValue)].filter((value) => typeof value === "number");
      return {
        entityId: state?.entity_id || configured.entityId,
        name: configured.name,
        value: state?.state ?? latestValue,
        unit: state?.attributes.unit_of_measurement || latestUnit || "",
        history: state ? extractHistory(state, configured.operationName || configured.name) : fallbackHistory,
        operationName: configured.name,
        button: configured.button,
      };
    })
    : parameterSensors.slice(0, 6).map((state) => {
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

  const vialsNumberSensor = findReefBotByName(states, ["vials number", "anzahl vials", "vials"]);
  const vialsNumber = numberValue(vialsNumberSensor?.state);
  const realVialCount = Math.max(Number.isFinite(vialsNumber) ? vialsNumber : 0, tubes.length || 0);
  const labTubes = LAB_DEMO ? LAB_DEMO_TUBES : tubes;
  const vialCount = LAB_DEMO ? LAB_DEMO_TUBES.length : realVialCount;
  return {
    tubes: labTubes,
    vialCount,
    labMode: vialCount >= 9,
    labDemo: LAB_DEMO,
    demoAnimate: DEMO_ANIM,
    availableChemicals: findAvailableChemicals(states),
    availableOperations: findAvailableOperations(states),
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
        <img class="brand-img" src="/reefbot/logo.png" alt="ReefBot" />
      </div>
      <div>
        <h1>ReefBot</h1>
        <p>Reagenzien, Tests und Wartung</p>
      </div>
      <div class="header-metrics">
        ${headerChip("Status", onlineText, online?.entity_id, onlineClass)}
        ${headerChip("Aktueller Vorgang", pendingOperationLabel(model), model.currentOperation?.entity_id)}
        ${headerChip("Letzter Vorgang", lastOperationLabel(model), model.currentOperation?.entity_id)}
        ${headerChip("Alarme & Status", alarmSummary(model), model.alarmLogs?.entity_id || model.notifications?.entity_id, alarmClass(model), "alarms")}
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
  if (count && count > 0) return count === 1 ? "1 wartend" : `${count} wartend`;
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
  if (action.kind === "config") {
    const count = Array.isArray(action.positions) ? action.positions.length : 0;
    return `
      <div class="dialog-backdrop" data-dialog-close>
        <section class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="confirm-action-title" data-dialog-card>
          <h2 id="confirm-action-title">Konfiguration speichern?</h2>
          <p>ReefBot überschreibt die komplette Reagenzien-Belegung des Geräts (<strong>${count} belegte${count === 1 ? "s" : ""} Röhrchen</strong>). Nicht zugeordnete Röhrchen werden geleert. Bitte nur bestätigen, wenn die physische Belegung wirklich stimmt.</p>
          <div class="dialog-actions">
            <button class="ghost" data-dialog-close>Abbrechen</button>
            <button class="primary danger" data-confirm-start>Speichern bestätigen</button>
          </div>
        </section>
      </div>
    `;
  }
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
    const title = testStartLocked ? "ReefBot ist beschäftigt" : "Test starten";
    const trend = testTrendSummary(test.history, test.unit);
    return `
      <article class="test-card" ${test.entityId ? `data-more-info="${test.entityId}"` : ""} title="Verlauf öffnen">
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
        <span>${model.pending?.state && model.pending.state !== "0" ? `${escapeHtml(model.pending.state)} wartend` : "Bereit"}</span>
      </div>
      <div class="test-grid">${cards || `<div class="empty compact">Noch keine Test-Entitäten gefunden.</div>`}</div>
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

// ==== ReefBot Lab: 3D-Vial-Karussell (1:1-Port aus der App LabCarouselGraphic.kt) ====
// Canvas-2.5D-Projektion: 12 Vials auf einer perspektivischen Ellipse, Oktagon-Turm
// mit LED-Ring, versetzte Testkammer, Spritzen-Choreografie bei aktivem Test.
// Aktiv ab model.labMode (vialCount >= 9 oder Demo-Vorschau).

function labRR(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function labOct(ctx, cx, cy, r, ryv) {
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + k * Math.PI / 4;
    const px = cx + r * Math.cos(a);
    const py = cy + ryv * Math.sin(a);
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function labKF(t, pts) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const a = pts[i - 1], b = pts[i];
      const f = (t - a[0]) / ((b[0] - a[0]) || 1);
      return a[1] + (b[1] - a[1]) * f;
    }
  }
  return pts[pts.length - 1][1];
}

function labVial(ctx, cx, baseY, s, tube, selected) {
  const w = 28 * s, h = 66 * s, capH = 13 * s;
  const left = cx - w / 2, top = baseY - h;
  const al = Math.min(1, Math.max(0.5, 0.5 + 0.5 * s));
  const r = 6 * s;
  ctx.globalAlpha = al;
  ctx.fillStyle = "#0B0D0E";
  labRR(ctx, left, top, w, h, r); ctx.fill();
  const fill = Math.min(0.92, Math.max(0.05, (Number(tube.percentage) || 0) / 100));
  const lh = (h - capH) * fill;
  ctx.fillStyle = tube.color || "#5c6470";
  labRR(ctx, left + 3 * s, baseY - lh - 3 * s, w - 6 * s, lh, 5 * s); ctx.fill();
  ctx.fillStyle = "#0E1416";
  labRR(ctx, left, top, w, capH, r); ctx.fill();
  ctx.strokeStyle = selected ? "#5FD7F7" : "#3A4A50";
  ctx.lineWidth = selected ? 2.5 : 1.5;
  labRR(ctx, left, top, w, h, r); ctx.stroke();
  ctx.globalAlpha = 1;
}

function labBadge(ctx, cx, cy, num, s, selected, alpha) {
  const r = Math.max(8, 11 * s);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#0D252F";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.strokeStyle = selected ? "#5FD7F7" : "#2F5866";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
  ctx.fillStyle = "#DFF7FF";
  ctx.font = "500 " + Math.max(9, 11 * s) + "px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(String(num), cx, cy + 0.5);
  ctx.globalAlpha = 1;
}

function labSyringe(ctx, cx, top, s, plunger) {
  const blockW = 26 * s, blockH = 18 * s;
  ctx.fillStyle = "#1D262B";
  labRR(ctx, cx - blockW / 2, top, blockW, blockH, 5); ctx.fill();
  const barW = 12 * s, barH = 52 * s, bt = top + blockH;
  ctx.globalAlpha = 0.5; ctx.fillStyle = "#C5D8DC";
  labRR(ctx, cx - barW / 2, bt, barW, barH, 6); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#8FB6C0"; ctx.lineWidth = 1.5;
  labRR(ctx, cx - barW / 2, bt, barW, barH, 6); ctx.stroke();
  const fh = (barH - 8) * plunger;
  ctx.globalAlpha = 0.55; ctx.fillStyle = "#6CD7F1";
  labRR(ctx, cx - barW / 2 + 2, bt + barH - fh - 4, barW - 4, fh, 5); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#C8DADE"; ctx.lineWidth = 2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(cx, bt + barH); ctx.lineTo(cx, bt + barH + 26 * s); ctx.stroke();
}

function drawLabCarousel(ctx, W, H, tubes, rotation, selectedIndex, now, active) {
  const count = tubes.length;
  const cx = W / 2, ringCy = 262;
  const rx = Math.min(170, Math.max(140, W * 0.37));
  const ry = 74, sMin = 0.42, sMax = 1, step = 2 * Math.PI / count;
  ctx.clearRect(0, 0, W, H);

  const octR = rx + 18, octRyTop = 30, octRyBot = 34, capCy = 100;
  const baseCy = ringCy + ry + 18, edgeX = octR * Math.cos(Math.PI / 8);
  labOct(ctx, cx, baseCy, octR, octRyBot);
  ctx.fillStyle = "#0C1113"; ctx.fill();
  ctx.strokeStyle = "#2B3439"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#141B1E";
  labRR(ctx, cx - edgeX - 6, capCy, 12, baseCy - capCy, 3); ctx.fill();
  labRR(ctx, cx + edgeX - 6, capCy, 12, baseCy - capCy, 3); ctx.fill();
  labOct(ctx, cx, capCy, octR, octRyTop);
  ctx.fillStyle = "#12191C"; ctx.fill();
  ctx.strokeStyle = "#30383D"; ctx.lineWidth = 2; ctx.stroke();
  labOct(ctx, cx, capCy, octR, octRyTop);
  ctx.strokeStyle = "rgba(47,135,199,.28)"; ctx.lineWidth = 12; ctx.stroke();
  const lg = ctx.createLinearGradient(cx - octR, 0, cx + octR, 0);
  lg.addColorStop(0, "#1F6DD0"); lg.addColorStop(0.5, "#4AA8FF"); lg.addColorStop(1, "#1F6DD0");
  labOct(ctx, cx, capCy, octR * 0.97, octRyTop * 0.97);
  ctx.strokeStyle = lg; ctx.lineWidth = 5; ctx.stroke();
  ctx.fillStyle = "#0B1418";
  ctx.beginPath(); ctx.ellipse(cx, capCy, octR * 0.62, 20, 0, 0, 7); ctx.fill();

  const placed = tubes.map((t, i) => {
    const th = (i - rotation) * step;
    const fr = Math.cos(th);
    return { i, x: cx + rx * Math.sin(th), by: ringCy + ry * fr, s: sMin + (sMax - sMin) * (fr + 1) / 2, fr };
  }).sort((a, b) => a.fr - b.fr);
  const alphaFor = (fr) => Math.min(1, Math.max(0.4, 0.45 + 0.55 * (fr + 1) / 2));

  placed.filter((p) => p.fr < 0).forEach((p) => {
    labVial(ctx, p.x, p.by, p.s, tubes[p.i], p.i === selectedIndex);
    labBadge(ctx, p.x, p.by + 11 * p.s, tubes[p.i].number, p.s, p.i === selectedIndex, alphaFor(p.fr));
  });

  const chCx = cx + rx * (Math.sin(step) / 2);
  const chW = 30, chH = 50, chLeft = chCx - chW / 2, chTop = 252, chBottom = chTop + chH;
  const railY = 208, colTop = capCy + 36;
  ctx.fillStyle = "#1A2226";
  labRR(ctx, cx - 7, colTop, 14, railY - colTop + 16, 4); ctx.fill();
  ctx.fillStyle = "#232B30";
  labRR(ctx, cx - 6, railY - 5, (chCx + 4) - (cx - 6), 10, 3); ctx.fill();
  ctx.fillStyle = "#10171A";
  labRR(ctx, chLeft - 6, chTop - 10, chW + 12, chH + 16, 10); ctx.fill();
  ctx.fillStyle = "#0B0D0E";
  labRR(ctx, chLeft, chTop, chW, chH, 10); ctx.fill();
  const liquidH = chH * 0.48, liquidTopY = chBottom - liquidH - 4;
  const vg = ctx.createLinearGradient(0, liquidTopY, 0, liquidTopY + liquidH);
  vg.addColorStop(0, "#87DEF1"); vg.addColorStop(1, "#1289A6");
  ctx.fillStyle = vg;
  labRR(ctx, chLeft + 4, liquidTopY, chW - 8, liquidH, 7); ctx.fill();
  if (active) {
    const stir = (now % 700) / 700 * 2 * Math.PI;
    const sw = 18 * (0.25 + 0.75 * Math.abs(Math.cos(stir)));
    ctx.fillStyle = "rgba(230,238,238,.78)";
    labRR(ctx, chCx - sw / 2, chBottom - 12, sw, 3.5, 2); ctx.fill();
  }
  ctx.strokeStyle = "rgba(95,215,247,.5)"; ctx.lineWidth = 1.5;
  labRR(ctx, chLeft, chTop, chW, chH, 10); ctx.stroke();

  placed.filter((p) => p.fr >= 0).forEach((p) => {
    labVial(ctx, p.x, p.by, p.s, tubes[p.i], p.i === selectedIndex);
    labBadge(ctx, p.x, p.by + 11 * p.s, tubes[p.i].number, p.s, p.i === selectedIndex, alphaFor(p.fr));
  });

  if (active) {
    const ph = now % 9000;
    const armX = labKF(ph, [[0, 0], [3600, 0], [4400, 1], [8200, 1], [9000, 0]]);
    const armDown = labKF(ph, [[0, 0], [900, 1], [3400, 1], [3900, 0], [4400, 0], [5000, 1], [8000, 1], [8400, 0], [9000, 0]]);
    const plunger = labKF(ph, [[0, 0.15], [2000, 1], [5200, 1], [7200, 0.15], [9000, 0.15]]);
    const drop = labKF(ph, [[0, 0], [5200, 0], [5650, 1], [5660, 0], [6150, 1], [6160, 0], [6650, 1], [6660, 0], [9000, 0]]);
    const syS = 0.82, armCx = cx + armX * (chCx - cx), frontBaseY = ringCy + ry;
    const vialInnerBottom = frontBaseY - 3;
    const vialInnerTop = (frontBaseY - 66 * sMax) + 13 * sMax;
    const vialInnerH = vialInnerBottom - vialInnerTop;
    const vialTip = vialInnerBottom - 0.05 * vialInnerH;
    const chamberTip = chTop + 10, restTip = railY + 34;
    const targetDown = vialTip + (chamberTip - vialTip) * armX;
    const tipY = restTip + (targetDown - restTip) * armDown;
    ctx.fillStyle = "#2A343A";
    labRR(ctx, armCx - 14, railY - 8, 28, 14, 4); ctx.fill();
    const blockH = 18 * syS, barrelH = 52 * syS, needleH = 24 * syS;
    const syTop = tipY - (blockH + barrelH + needleH);
    ctx.strokeStyle = "#8FB6C0"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(armCx, railY); ctx.lineTo(armCx, syTop + 4); ctx.stroke();
    labSyringe(ctx, armCx, syTop, syS, plunger);
    if (drop > 0.01) {
      const da = drop < 0.75 ? 1 : Math.max(0, (1 - drop) / 0.25);
      ctx.globalAlpha = da; ctx.fillStyle = "#7EE2F9";
      ctx.beginPath(); ctx.arc(armCx, tipY + 2 + drop * 15, 3.5, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

function labNeighborChip(tube, big) {
  const slotSize = big ? "34px" : "24px";
  const border = big ? "2.5px solid #66D7F7" : "1.5px solid #2F5866";
  const numColor = big ? "#DFF7FF" : "#CFE6EE";
  const textColor = big ? "#EDF7FA" : "#8FA3AB";
  const weight = big ? "700" : "500";
  const nameSize = big ? "13px" : "10px";
  const numSize = big ? "16px" : "11px";
  const maxW = big ? "160px" : "96px";
  return `
    <div class="lab-chip" style="max-width:${maxW};">
      <div class="lab-chip-num" style="width:${slotSize};height:${slotSize};border:${border};color:${numColor};font-size:${numSize};font-weight:${weight};">${escapeHtml(tube.number)}</div>
      <div class="lab-chip-name" style="color:${textColor};font-size:${nameSize};font-weight:${weight};">${escapeHtml(tube.shortName)}</div>
    </div>`;
}

function labNeighborLabels(tubes, selectedIndex) {
  const count = tubes.length;
  const l = ((selectedIndex - 1) % count + count) % count;
  const r = (selectedIndex + 1) % count;
  return labNeighborChip(tubes[l], false) + labNeighborChip(tubes[selectedIndex], true) + labNeighborChip(tubes[r], false);
}

function renderMachineLab(model) {
  return `
    <section class="machine lab-machine">
      <div class="lab-frame">
        <div class="lab-stage">
          <span class="lab-badge">REEFBOT LAB · ${model.tubes.length} VIALS</span>
          <canvas class="lab-canvas"></canvas>
          <button class="lab-arrow left" data-lab-rotate="-1" aria-label="Vorheriges Vial">&lsaquo;</button>
          <button class="lab-arrow right" data-lab-rotate="1" aria-label="Nächstes Vial">&rsaquo;</button>
          <div class="lab-tap" data-lab-tap title="Röhrchen öffnen"></div>
          <div class="lab-labels"></div>
        </div>
      </div>
    </section>
  `;
}

// ==== TEMP: Lab-Vorschau (Demo) — nur zum Testen ohne echtes Lab-Gerät.
// Komplett entfernbar: dieser Block, renderLabDemoToggle(), die [data-lab-demo*]-
// Listener in render() und die Demo-Zweige in buildModel(). Siehe ha-parity.md Gap 4.
let LAB_DEMO = false;
let DEMO_ANIM = false;
const LAB_DEMO_TUBES = [
  ["RedSea Alk Pro", 16.4, 82], ["NO2/NO3 A", 12.8, 64], ["NO2/NO3 B", 12.8, 64],
  ["NO2/NO3 C", 12.2, 61], ["RedSea Ca A", 14.6, 73], ["RedSea Ca B", 14.2, 71],
  ["Colombo PO4-1", 9.6, 48], ["Colombo PO4-2", 9.0, 45], ["Magnesium", 18.0, 90],
  ["Eisen", 7.0, 35], ["Jod", 11.6, 58], ["Kalium", 13.2, 66],
].map((row, idx) => {
  const number = idx + 1;
  return {
    number, name: row[0], shortName: row[0], current: row[1], capacity: 20,
    percentage: row[2], unit: "mL", color: chemicalColor("", number),
  };
});

function renderLabDemoToggle(model) {
  const on = model.labDemo;
  const anim = model.demoAnimate;
  const mode = on ? "Lab" : "V2";
  return `
    <div class="lab-demo-toggle">
      <button data-lab-demo class="${on ? "on" : ""}">${on ? "Lab-Vorschau: AN" : "Lab-Vorschau (Demo)"}</button>
      <button data-lab-demo-active class="${anim ? "on" : ""}">${anim ? `Test-Animation (${mode}): AN` : `Test-Animation (${mode})`}</button>
      ${on || anim ? `<span class="lab-demo-hint">Demo — kein echtes Gerät</span>` : ""}
    </div>
  `;
}
// ==== /TEMP ====

// ==== Reagenzien-Wartungsmodus: vereinfachtes Karussell + Listenansicht ====
// Overlay, das per Tap aufs Gerät geöffnet wird (nur wenn kein Test läuft).
// Zeigt nur die Fläschchen mit Name/Füllstand/Kapazität. Refill direkt im
// Karussell (über den bestehenden Confirm-Dialog) oder Tap → bestehendes
// Vial-Popup. Funktioniert für V2 (8) und Lab (12) gleich.

function maintFillPct(tube) {
  return Math.round(Math.min(100, Math.max(0, Number(tube.percentage) || 0)));
}

function renderMaintenanceEntry(model) {
  if (isChamberActive(model)) return "";
  return `
    <div class="maint-entry">
      <button data-open-maintenance>
        <ha-icon icon="mdi:flask-outline"></ha-icon>
        <span>Reagenzien-Wartung</span>
      </button>
    </div>
  `;
}

function renderMaintenanceList(tubes) {
  return `
    <div class="maint-list">
      ${tubes.map((tube) => {
        const pct = maintFillPct(tube);
        const refillLabel = `Röhrchen ${tube.number} auffüllen: ${tube.shortName}`;
        return `
        <div class="maint-row ${pct <= 20 ? "low" : ""}" data-vial-open="${tube.number}">
          <span class="maint-row-num">${escapeHtml(tube.number)}</span>
          <div class="maint-row-main">
            <div class="maint-row-name">${escapeHtml(tube.shortName)}</div>
            <div class="maint-bar"><span style="width:${pct}%; background:${tube.color};"></span></div>
          </div>
          <div class="maint-row-vals">
            <b>${formatNumber(tube.current)}/${formatNumber(tube.capacity)} ${escapeHtml(tube.unit)}</b>
            <small>${pct}%</small>
          </div>
          ${tube.refillButton
            ? `<button class="maint-row-refill" data-press="${tube.refillButton.entity_id}" data-kind="refill" data-label="${escapeHtml(refillLabel)}">Auffüllen</button>`
            : `<button class="maint-row-refill" disabled>—</button>`}
        </div>`;
      }).join("")}
    </div>
  `;
}

function renderMaintenanceOverlay(model, open, view) {
  if (!open) return "";
  const tubes = model.tubes;
  const isList = view === "list";
  const title = model.labMode ? "Reagenzien · Lab" : "Reagenzien";
  return `
    <div class="dialog-backdrop maint-backdrop" data-close-maintenance>
      <section class="dialog-card maint-dialog" role="dialog" aria-modal="true" aria-label="Reagenzien-Wartung" data-dialog-card>
        <div class="maint-toolbar">
          <h2>${escapeHtml(title)}</h2>
          <div class="maint-views">
            <button data-maint-view="carousel" class="${!isList ? "on" : ""}">Karussell</button>
            <button data-maint-view="list" class="${isList ? "on" : ""}">Liste</button>
          </div>
          <button class="icon-close" data-close-maintenance title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button>
        </div>
        ${isList ? renderMaintenanceList(tubes) : `
          <div class="maint-stage">
            <canvas class="maint-canvas"></canvas>
            <button class="maint-arrow left" data-maint-rotate="-1" aria-label="Vorheriges Röhrchen">&lsaquo;</button>
            <button class="maint-arrow right" data-maint-rotate="1" aria-label="Nächstes Röhrchen">&rsaquo;</button>
          </div>
          <div class="maint-front" data-maint-vialtap title="Details öffnen">
            <div class="maint-front-info">
              <div class="maint-front-name">—</div>
              <div class="maint-front-meta">—</div>
            </div>
            <button class="maint-refill" data-maint-refill>Auffüllen</button>
          </div>
          <p class="maint-hint">Drehen mit ‹ › oder Wischen · Tippen für Details</p>
        `}
      </section>
    </div>
  `;
}

function drawMaintenanceCarousel(ctx, W, H, tubes, rotation, selectedIndex) {
  const count = tubes.length;
  const cx = W / 2, ringCy = H * 0.5;
  const rx = Math.min(W * 0.33, 150), ry = 48, sMin = 0.5, sMax = 1.18;
  const step = 2 * Math.PI / count;
  ctx.clearRect(0, 0, W, H);
  const placed = tubes.map((t, i) => {
    const th = (i - rotation) * step;
    const fr = Math.cos(th);
    return { i, x: cx + rx * Math.sin(th), by: ringCy + ry * fr, s: sMin + (sMax - sMin) * (fr + 1) / 2, fr };
  }).sort((a, b) => a.fr - b.fr);
  placed.forEach((p) => {
    labVial(ctx, p.x, p.by, p.s, tubes[p.i], p.i === selectedIndex);
    labBadge(ctx, p.x, p.by + 11 * p.s, tubes[p.i].number, p.s, p.i === selectedIndex, Math.min(1, Math.max(0.45, 0.5 + 0.5 * (p.fr + 1) / 2)));
  });
}

// ==== Gap 1: Test-Konfiguration bearbeiten (Kit-basiert, wie App) ====
// Kit-Karten + "Test hinzufügen". Kits = Cluster von Reagenzien, die sich Tests
// teilen (Kombi-Kits bleiben zusammen). Hinzufügbar sind nur Tests, deren
// Reagenzien/Parameter frei sind und die in die freien Tubes passen. "Speichern"
// postet die komplette Belegung via reefbot.set_chemical_positions (nur bei Klick,
// mit Bestätigung). Logik 1:1 aus der App (data/TestConfig.kt + buildTestConfig).

const KIT_COLOR_PALETTE = ["#5FD7F7", "#7F77DD", "#1D9E75", "#EF9F27", "#D4537E", "#97C459", "#378ADD", "#D85A30"];

function findAvailableChemicals(states) {
  for (const state of states) {
    if (!state.entity_id.startsWith("sensor.")) continue;
    const chems = state.attributes?.chemicals;
    if (Array.isArray(chems) && chems.length && chems[0] && chems[0].id != null) {
      return chems.map((c) => ({ id: String(c.id), name: String(c.name ?? c.id) }));
    }
  }
  return [];
}

function findAvailableOperations(states) {
  for (const state of states) {
    if (!state.entity_id.startsWith("sensor.")) continue;
    const ops = state.attributes?.operations;
    if (Array.isArray(ops) && ops.length && ops[0] && Array.isArray(ops[0].reagents)) {
      return ops;
    }
  }
  return [];
}

function cfgCleanKitName(name) {
  return String(name || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}
function cfgLcp(strings) {
  if (!strings.length) return "";
  let prefix = strings[0];
  for (const s of strings.slice(1)) {
    let i = 0;
    const max = Math.min(prefix.length, s.length);
    while (i < max && prefix[i] === s[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}
function cfgLcs(strings) {
  const rev = strings.map((s) => [...s].reverse().join(""));
  return [...cfgLcp(rev)].reverse().join("");
}
function cfgTrimEnds(s) {
  return String(s || "").replace(/^[\s\-/_.:·]+|[\s\-/_.:·]+$/g, "");
}
function cfgFallbackSingle(name) {
  const token = (String(name || "").trim().split(/[ \-/_]/).pop() || "").trim();
  return token.length >= 1 && token.length <= 3 ? token : "";
}
function cfgShortLabels(names) {
  if (!names.length) return [];
  if (names.length === 1) return [cfgFallbackSingle(names[0])];
  const prefix = cfgLcp(names);
  const suffix = cfgLcs(names);
  return names.map((name) => {
    let rest = name.length > prefix.length ? name.slice(prefix.length) : name;
    if (suffix && rest.length > suffix.length && rest.endsWith(suffix)) {
      rest = rest.slice(0, rest.length - suffix.length);
    }
    rest = cfgTrimEnds(rest);
    if (!rest) return cfgFallbackSingle(name);
    return rest.length <= 4 ? rest : rest.slice(0, 4);
  });
}
function cfgCommonBrandName(names) {
  if (!names.length) return "";
  if (names.length === 1) return cfgCleanKitName(names[0]);
  const brand = cfgTrimEnds(cfgLcp(names));
  if (brand.length >= 3) return brand;
  return cfgCleanKitName(names.reduce((a, b) => (b.length > a.length ? b : a), names[0]));
}
// Parameter-Labels auf Deutsch (nur Anzeige, wie in der App). Fallback = Original.
const CFG_PARAM_DE = {
  alkalinity: "Alkalinität", kh: "KH", "carbonate hardness": "Karbonathärte",
  nitrate: "Nitrat", nitrite: "Nitrit", phosphate: "Phosphat", calcium: "Calcium",
  magnesium: "Magnesium", copper: "Kupfer", iodine: "Jod", ammonia: "Ammoniak",
  ammonium: "Ammonium", ph: "pH", potassium: "Kalium", iron: "Eisen",
  silicate: "Silikat", chlorine: "Chlor", bromine: "Brom", gh: "GH",
  "general hardness": "Gesamthärte", oxygen: "Sauerstoff", salinity: "Salinität",
  "carbon dioxide": "CO₂", co2: "CO₂", strontium: "Strontium", boron: "Bor",
  fluoride: "Fluorid", nickel: "Nickel", manganese: "Mangan",
};
function cfgParamDe(name) {
  const key = String(name || "").trim().toLowerCase();
  return CFG_PARAM_DE[key] || String(name || "");
}
// Gap 7: Kit-Farbe SEQUENZIELL nach Index vergeben (nicht per Parameter-Hash),
// sonst bekommen zwei Kits mit gleichem Parameter dieselbe Farbe und Hash-
// Kollisionen färben "fast alles gleich". Max. 8 Kits (= 8 Tubes) → kollisionsfrei.
function cfgKitColor(index) {
  const n = KIT_COLOR_PALETTE.length;
  return KIT_COLOR_PALETTE[((index % n) + n) % n];
}
// Erste noch nicht belegte Palettenfarbe (stabile Farbe beim Hinzufügen).
function cfgFirstFreeKitColor(state) {
  const used = new Set(state.kits.map((k) => k.colorHex));
  return KIT_COLOR_PALETTE.find((c) => !used.has(c)) || cfgKitColor(state.kits.length);
}

// Rohdaten → editierbarer Konfig-Zustand { vialCount, kits, catalog }.
function buildTestConfig(model) {
  const vialCount = Math.max(model.vialCount || 0, (model.tubes || []).length || 0) || 8;
  const installed = (model.tubes || [])
    .filter((t) => t.chemicalId)
    .map((t) => ({ id: t.chemicalId, name: t.shortName || t.chemicalId, slot: t.number }));
  const installedById = new Map(installed.map((r) => [r.id, r]));

  const catalog = [];
  const seenOps = new Set();
  (model.availableOperations || []).forEach((op) => {
    const reagents = Array.isArray(op.reagents) ? op.reagents : [];
    const ids = reagents.map((r) => String(r.id)).filter(Boolean);
    const opId = op.id != null ? String(op.id) : "";
    if (!ids.length || !opId || seenOps.has(opId)) return;
    seenOps.add(opId);
    catalog.push({
      operationId: opId,
      displayName: String(op.name || opId),
      parameterName: op.parameter || null,
      reagentChemicalIds: ids,
      reagentNames: reagents.map((r) => String(r.name != null ? r.name : r.id)),
    });
  });

  const activeOps = catalog.filter((op) => op.reagentChemicalIds.every((id) => installedById.has(id)));

  const clusters = [];
  activeOps.forEach((op) => {
    const opIds = new Set(op.reagentChemicalIds);
    const overlap = clusters.filter((c) => [...c.ids].some((id) => opIds.has(id)));
    if (!overlap.length) {
      clusters.push({ ops: [op], ids: opIds });
    } else {
      const target = overlap[0];
      target.ops.push(op);
      opIds.forEach((id) => target.ids.add(id));
      overlap.slice(1).forEach((o) => {
        o.ops.forEach((x) => target.ops.push(x));
        o.ids.forEach((id) => target.ids.add(id));
        const i = clusters.indexOf(o);
        if (i >= 0) clusters.splice(i, 1);
      });
    }
  });

  const kitFromReagents = (opId, name, param, params, ids) => {
    const reagents = [...ids].map((id) => installedById.get(id)).filter(Boolean).sort((a, b) => a.slot - b.slot);
    if (!reagents.length) return null;
    const labels = cfgShortLabels(reagents.map((r) => r.name));
    return {
      operationId: opId,
      displayName: cfgCleanKitName(name),
      parameterName: param || null,
      parameters: params || [],
      colorHex: "",
      reagents: reagents.map((r, i) => ({ chemicalId: r.id, chemicalName: r.name, shortLabel: labels[i] || "", slot: r.slot })),
    };
  };

  const clusterKits = clusters.map((c) => {
    const rep = c.ops.reduce((a, b) => (b.reagentChemicalIds.length > a.reagentChemicalIds.length ? b : a), c.ops[0]);
    const brand = cfgCommonBrandName(c.ops.map((o) => o.displayName));
    const params = [...new Set(c.ops.map((o) => (o.parameterName || "").trim()).filter(Boolean))];
    return kitFromReagents(rep.operationId, brand, rep.parameterName, params, c.ids);
  }).filter(Boolean);

  const coveredIds = new Set(clusters.flatMap((c) => [...c.ids]));
  const orphanKits = installed
    .filter((r) => !coveredIds.has(r.id))
    .map((r) => kitFromReagents("orphan:" + r.slot, r.name, null, [], [r.id]))
    .filter(Boolean);

  const kits = [...clusterKits, ...orphanKits]
    .sort((a, b) => (a.reagents[0] ? a.reagents[0].slot : 1e9) - (b.reagents[0] ? b.reagents[0].slot : 1e9))
    .map((kit, i) => ({ ...kit, colorHex: cfgKitColor(i) }));

  return { vialCount, kits, catalog };
}

function cfgUsedSlots(state) {
  const used = new Set();
  state.kits.forEach((k) => k.reagents.forEach((r) => used.add(r.slot)));
  return used;
}
function cfgFreeSlots(state) {
  const used = cfgUsedSlots(state);
  const free = [];
  for (let n = 1; n <= state.vialCount; n++) if (!used.has(n)) free.push(n);
  return free;
}
function cfgAddable(state) {
  const installedReagentIds = new Set(state.kits.flatMap((k) => k.reagents.map((r) => r.chemicalId)));
  const installedOps = new Set(state.kits.map((k) => k.operationId));
  const installedParams = new Set(state.kits.map((k) => (k.parameterName || "").trim().toLowerCase()).filter(Boolean));
  const freeCount = cfgFreeSlots(state).length;
  return state.catalog.filter((kit) =>
    !installedOps.has(kit.operationId) &&
    !kit.reagentChemicalIds.some((id) => installedReagentIds.has(id)) &&
    (!kit.parameterName || !installedParams.has(kit.parameterName.trim().toLowerCase())) &&
    kit.reagentChemicalIds.length >= 1 &&
    kit.reagentChemicalIds.length <= freeCount
  );
}
function cfgWithKitAdded(state, kit) {
  if (!kit) return state;
  const free = cfgFreeSlots(state);
  if (kit.reagentChemicalIds.length > free.length) return state;
  const names = kit.reagentNames || [];
  const labels = cfgShortLabels(kit.reagentChemicalIds.map((id, i) => names[i] || id));
  const reagents = kit.reagentChemicalIds
    .map((id, i) => ({ chemicalId: id, chemicalName: names[i] || id, shortLabel: labels[i] || "", slot: free[i] }))
    .sort((a, b) => a.slot - b.slot);
  const newKit = {
    operationId: kit.operationId,
    displayName: cfgCleanKitName(kit.displayName),
    parameterName: kit.parameterName || null,
    parameters: kit.parameterName ? [kit.parameterName] : [],
    colorHex: cfgFirstFreeKitColor(state),
    reagents,
  };
  return { ...state, kits: [...state.kits, newKit] };
}
function cfgWithKitRemoved(state, operationId) {
  return { ...state, kits: state.kits.filter((k) => String(k.operationId) !== String(operationId)) };
}
function cfgFlattenPositions(state) {
  const positions = [];
  state.kits.forEach((k) => k.reagents.forEach((r) => positions.push({
    chemical_id: r.chemicalId, position_index: r.slot - 1, chemical_name: r.chemicalName,
  })));
  return positions;
}

function renderConfigEntry(model) {
  if (isChamberActive(model)) return "";
  return `
    <div class="cfg-entry">
      <button data-open-config>
        <ha-icon icon="mdi:tune-variant"></ha-icon>
        <span>Test-Konfiguration bearbeiten</span>
      </button>
    </div>
  `;
}

function renderConfigOverlay(model, open, state) {
  if (!open || !state) return "";
  const free = cfgFreeSlots(state);
  const used = state.vialCount - free.length;
  const full = free.length === 0;
  const addable = cfgAddable(state);
  const kitGroups = state.kits.length
    ? state.kits.map((k) => {
        const params = (k.parameters && k.parameters.length ? k.parameters : (k.parameterName ? [k.parameterName] : []))
          .map((p) => escapeHtml(cfgParamDe(p))).join(" · ");
        const vials = k.reagents.map((r) => `
          <div class="cfg-vialcol" title="Tube ${escapeHtml(r.slot)} · ${escapeHtml(r.chemicalName)}">
            <div class="cfg-vial"><span class="cfg-vial-fill" style="background:${k.colorHex};"></span><span class="cfg-vial-label">${escapeHtml(r.shortLabel || r.slot)}</span></div>
            <span class="cfg-vial-num" style="border-color:${k.colorHex}; color:${k.colorHex};">${escapeHtml(r.slot)}</span>
          </div>`).join("");
        return `
          <div class="cfg-kitgroup">
            <div class="cfg-kitcard" style="border-color:${k.colorHex};">
              <span class="cfg-dot" style="background:${k.colorHex};"></span>
              <div class="cfg-kitmeta">
                <div class="cfg-kitname">${escapeHtml(k.displayName)}</div>
                ${params ? `<div class="cfg-kitparam" style="color:${k.colorHex};">${params}</div>` : ""}
              </div>
              <button class="cfg-kitremove" data-config-remove="${escapeHtml(k.operationId)}" title="Entfernen">✕</button>
            </div>
            <div class="cfg-bracket" style="background:${k.colorHex};"></div>
            <div class="cfg-vialrow">${vials}</div>
          </div>`;
      }).join("")
    : `<p class="cfg-empty">Noch keine Tests konfiguriert.</p>`;
  const freeRow = free.length
    ? `<div class="cfg-freerow">${free.map((s) => `<div class="cfg-vialcol"><div class="cfg-vial empty"></div><span class="cfg-vial-num free">${s}</span></div>`).join("")}</div>`
    : "";
  const addList = addable.length
    ? addable.map((kit) => `
      <button class="cfg-add-kit" data-config-add="${escapeHtml(kit.operationId)}">
        <span class="cfg-add-name">${escapeHtml(cfgCleanKitName(kit.displayName))}</span>
        <span class="cfg-add-meta">${kit.parameterName ? escapeHtml(cfgParamDe(kit.parameterName)) + " · " : ""}${kit.reagentChemicalIds.length} Tube${kit.reagentChemicalIds.length === 1 ? "" : "s"}</span>
      </button>`).join("")
    : `<p class="cfg-empty">${state.catalog.length ? "Keine passenden Tests (Tubes voll oder Parameter belegt)." : "Test-Katalog nicht verfügbar (Gerät offline?)."}</p>`;
  return `
    <div class="dialog-backdrop cfg-backdrop" data-close-config>
      <section class="dialog-card cfg-dialog" role="dialog" aria-modal="true" aria-label="Test-Konfiguration" data-dialog-card>
        <div class="cfg-toolbar">
          <h2>Test-Konfiguration</h2>
          <span class="cfg-free ${full ? "full" : ""}">${used}/${state.vialCount}</span>
          <button class="icon-close" data-close-config title="Schließen"><ha-icon icon="mdi:close"></ha-icon></button>
        </div>
        <div class="cfg-section-title">Konfigurierte Tests</div>
        <div class="cfg-machine">
          <div class="cfg-kitflow">${kitGroups}</div>
          ${freeRow}
        </div>
        <div class="cfg-section-title">Test hinzufügen</div>
        <div class="cfg-addlist">${addList}</div>
        <p class="cfg-hint">Kürzel im Fläschchen, Tube-Nr. darunter. Reagenzien bleiben als Kit zusammen. Beim Speichern wird die komplette Belegung ans Gerät geschrieben.</p>
        <div class="dialog-actions">
          <button class="ghost" data-close-config>Abbrechen</button>
          <button class="primary" data-config-save>Speichern</button>
        </div>
      </section>
    </div>
  `;
}

function renderMachine(model) {
  if (model.labMode) return renderMachineLab(model);
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
  const prefix = active ? "Live: " : model.recentOperation ? "Letzter: " : "";
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
      <strong class="chamber-label">Testkammer</strong>
      <div class="chamber-operation ${active ? "live" : "last"}">
        <span>${escapeHtml(prefix.replace(":", ""))}</span>
        <b>${escapeHtml(operation)}</b>
      </div>
      ${progress ? renderChamberProgress(progress) : `<small>${escapeHtml(pendingValue)} wartend</small>`}
    </article>
  `;
}

function renderVial(tube, locked = false) {
  const fillRatio = vialFillRatio(tube.percentage);
  const label = `${formatNumber(tube.current)} ${tube.unit}`;
  const capacity = `${formatNumber(tube.capacity)} ${tube.unit}`;
  return `
    <article class="vial-card ${locked ? "locked" : "clickable"}" ${locked ? "" : `data-vial-open="${tube.number}"`}>
      <div class="vial-cap"></div>
      <div class="vial" style="--fill-ratio:${fillRatio}; --liquid:${tube.color}">
        <span>${escapeHtml(label)}</span>
        <em></em>
        <i></i>
      </div>
      <small class="vial-capacity-label">${escapeHtml(capacity)}</small>
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
  const fillRatio = vialFillRatio(tube.percentage);
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
            <div class="vial" style="--fill-ratio:${fillRatio}; --liquid:${tube.color}">
              <span>${escapeHtml(current)}</span>
              <em><b>${escapeHtml(capacity)}</b></em>
              <i></i>
            </div>
            <strong>${escapeHtml(percentage)}</strong>
          </div>
          ${tube.entityId ? `<button class="secondary wide vial-history-button" data-more-info="${tube.entityId}">HA-Verlauf</button>` : ""}
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

function vialFillRatio(percentage) {
  return Math.round(clamp(percentage ?? 0, 0, 100) * 100) / 10000;
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
  if (model && model.demoAnimate) return true; // TEMP: Test-Animation-Demo
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
    <div class="chamber-progress" title="${progress.durationMinutes} min geplante Dauer">
      <span style="width:${progress.percent}%"></span>
    </div>
    <p>${formatRemaining(progress.remainingMs)} verbleibend · ${Math.round(progress.percent)}% · ${progress.durationMinutes} min Test</p>
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

function findParameterSensorForConfiguredTest(parameterSensors, configuredTest) {
  const operationKeys = [
    configuredTest.operationName,
    configuredTest.latest?.operation,
    configuredTest.method,
    configuredTest.name,
  ].map(normalize).filter(Boolean);

  const exactOperation = parameterSensors.find((state) => {
    const sensorOperationKeys = [
      state.attributes?.operation_name,
      state.attributes?.operation_method,
    ].map(normalize).filter(Boolean);
    return sensorOperationKeys.some((operation) => operationKeys.includes(operation));
  });
  return exactOperation;
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

function extractHistory(state, operationName = "") {
  const history = state.attributes.history;
  if (!Array.isArray(history)) return [];
  const operationKey = normalize(operationName);
  return history
    .filter((item) => {
      if (!operationKey) return true;
      const itemOperation = item.operation || item.OperationName || item.operationName;
      if (!activeState(itemOperation)) return true;
      return normalize(itemOperation) === operationKey;
    })
    .map((item) => numberValue(item.value ?? item.Value ?? item.display_value))
    .filter((value) => typeof value === "number")
    .reverse();
}

function testTrendSummary(values = [], unit = "") {
  const recent = values.filter((value) => typeof value === "number").slice(-2);
  if (recent.length < 2) {
    return {
      label: "Letztes Ergebnis",
      delta: "",
      deltaClass: "",
    };
  }
  const delta = recent[recent.length - 1] - recent[recent.length - 2];
  const sign = delta > 0 ? "+" : "";
  return {
    label: "Letzte Änderung",
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
  .vial-history-button {
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
    grid-template-columns: 1fr;
    gap: 18px;
    align-items: center;
    justify-items: center;
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
    --calibration-top: 14px;
    width: 92px;
    height: 248px;
    border-radius: 6px 6px 24px 24px;
    overflow: visible;
  }
  .vial-dialog-visual .vial span {
    inset: auto 7px 45%;
    font-size: 22px;
    line-height: 1.1;
  }
  .vial-dialog-visual .vial em {
    top: 14px;
    left: 0;
    right: 0;
    height: 1px;
    padding: 0;
    border-top-color: rgba(230, 238, 238, 0.62);
  }
  .vial-dialog-visual .vial em b {
    position: absolute;
    left: calc(100% + 14px);
    top: -8px;
    width: max-content;
    color: rgba(230, 238, 238, 0.86);
    font-size: 15px;
    font-weight: 700;
    line-height: 1;
    text-shadow: 0 1px 4px rgba(0,0,0,0.85);
  }
  .vial-dialog-visual .vial i::before {
    left: 0;
    width: 100%;
  }
  .vial-dialog-visual strong {
    margin-top: 12px;
    color: #edf7fa;
    font-size: 28px;
  }
  .vial-history-button {
    width: 100%;
    max-width: 420px;
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
    min-width: 78px;
    aspect-ratio: 1 / 1;
    flex: 0 0 auto;
    border-radius: 20px;
    background: #1289a6;
    position: relative;
    overflow: hidden;
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.35);
  }
  .brand-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
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

  .lab-machine {
    min-height: 0;
    overflow: visible;
  }
  .lab-demo-toggle {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin: 0 0 8px;
  }
  .lab-demo-toggle button {
    background: #132027;
    color: #8fb6c0;
    border: 1px solid #2f4a54;
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .lab-demo-toggle button.on {
    background: #0c2c1a;
    color: #79e3a6;
    border-color: #2f7a52;
  }
  .lab-demo-hint {
    color: #7f9299;
    font-size: 11px;
  }
  .lab-frame {
    position: relative;
    width: min(100%, 640px);
    height: 470px;
    margin: 0 auto;
    border-radius: 14px;
    background: #0c1113;
    border: 10px solid #30383d;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06), 0 24px 54px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }
  .lab-stage {
    position: absolute;
    inset: 0;
  }
  .lab-badge {
    position: absolute;
    top: 10px;
    left: 16px;
    color: #5fd7f7;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.04em;
    z-index: 4;
    pointer-events: none;
  }
  .lab-canvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    cursor: grab;
  }
  .lab-arrow {
    position: absolute;
    top: 176px;
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background: #0c1c22;
    border: 1.5px solid #3a5560;
    color: #5fd7f7;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    z-index: 4;
  }
  .lab-arrow.left { left: 8px; }
  .lab-arrow.right { right: 8px; }
  .lab-tap {
    position: absolute;
    left: 50%;
    top: 258px;
    transform: translateX(-50%);
    width: 48px;
    height: 84px;
    cursor: pointer;
    z-index: 3;
  }
  .lab-labels {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 8px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 0 16px;
    pointer-events: none;
  }
  .lab-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .lab-chip-num {
    border-radius: 50%;
    background: #0d252f;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .lab-chip-name {
    text-align: center;
    line-height: 1.15;
  }
  .maint-entry {
    display: flex;
    justify-content: center;
    margin: 10px 0 2px;
  }
  .maint-entry button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #132027;
    color: #9edff0;
    border: 1px solid #2f4a54;
    border-radius: 999px;
    padding: 9px 18px;
    font-size: 14px;
    cursor: pointer;
  }
  .maint-entry button:hover { background: #17313b; }
  .maint-entry ha-icon { --mdc-icon-size: 20px; }
  .maint-dialog {
    width: min(600px, 100%);
    max-height: min(88vh, 760px);
  }
  .maint-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .maint-toolbar h2 { margin: 0; font-size: 20px; flex: 0 0 auto; }
  .maint-views {
    display: inline-flex;
    margin-left: auto;
    background: #0e181c;
    border: 1px solid #2a3a41;
    border-radius: 999px;
    padding: 3px;
  }
  .maint-views button {
    border: none;
    background: transparent;
    color: #9db4bc;
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  .maint-views button.on { background: #14384a; color: #cdeefb; }
  .maint-stage {
    position: relative;
    height: 300px;
    cursor: grab;
    touch-action: none;
  }
  .maint-canvas { width: 100%; height: 100%; display: block; }
  .maint-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: #0c1c22;
    border: 1.5px solid #3a5560;
    color: #5fd7f7;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
  }
  .maint-arrow.left { left: 4px; }
  .maint-arrow.right { right: 4px; }
  .maint-front {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 6px;
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(8, 18, 21, 0.7);
    border: 1px solid rgba(102, 215, 247, 0.16);
    cursor: pointer;
  }
  .maint-front-info { min-width: 0; flex: 1; }
  .maint-front-name {
    font-size: 15px;
    font-weight: 500;
    color: #edf7fa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .maint-front-meta { font-size: 13px; color: #9db4bc; margin-top: 2px; }
  .maint-refill {
    flex: 0 0 auto;
    background: #132027;
    color: #ffd7c8;
    border: 1px solid rgba(255, 150, 120, 0.4);
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
  }
  .maint-refill:disabled { opacity: 0.4; cursor: default; }
  .maint-hint { margin: 8px 0 0; text-align: center; color: #7f9299; font-size: 12px; }
  .maint-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
  }
  .maint-row {
    display: grid;
    grid-template-columns: 30px 1fr auto auto;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(8, 18, 21, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.05);
    cursor: pointer;
  }
  .maint-row:hover { border-color: rgba(102, 215, 247, 0.28); }
  .maint-row.low { border-color: rgba(255, 170, 120, 0.4); }
  .maint-row-num {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #0d252f;
    border: 1px solid #2f5866;
    color: #cfe6ee;
    display: grid;
    place-items: center;
    font-size: 12px;
  }
  .maint-row-main { min-width: 0; }
  .maint-row-name {
    font-size: 14px;
    color: #edf7fa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .maint-bar {
    margin-top: 6px;
    height: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .maint-bar span { display: block; height: 100%; border-radius: 999px; }
  .maint-row-vals { text-align: right; white-space: nowrap; }
  .maint-row-vals b { display: block; font-size: 13px; color: #edf7fa; font-weight: 500; }
  .maint-row-vals small { color: #9db4bc; font-size: 11px; }
  .maint-row-refill {
    background: #132027;
    color: #ffd7c8;
    border: 1px solid rgba(255, 150, 120, 0.34);
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .maint-row-refill:disabled { opacity: 0.35; cursor: default; border-color: rgba(255,255,255,0.1); color: #7f9299; }
  .cfg-entry {
    display: flex;
    justify-content: center;
    margin: 8px 0 2px;
  }
  .cfg-entry button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #132027;
    color: #9edff0;
    border: 1px solid #2f4a54;
    border-radius: 999px;
    padding: 9px 18px;
    font-size: 14px;
    cursor: pointer;
  }
  .cfg-entry button:hover { background: #17313b; }
  .cfg-entry ha-icon { --mdc-icon-size: 20px; }
  .cfg-dialog {
    width: min(560px, 100%);
    max-height: min(88vh, 760px);
  }
  .cfg-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .cfg-toolbar h2 { margin: 0; font-size: 20px; }
  .cfg-hint {
    margin: 0 0 12px;
    color: #9db4bc;
    font-size: 12px;
    line-height: 1.4;
  }
  .cfg-empty { color: #9db4bc; font-size: 13px; margin: 2px 0 4px; }
  .cfg-free {
    margin-left: auto;
    font-size: 12px;
    white-space: nowrap;
    padding: 3px 10px;
    border-radius: 11px;
    background: #0d252f;
    border: 1px solid #2f5866;
    color: #cfe6ee;
  }
  .cfg-free.full { background: #2a1315; border-color: #7a2d2d; color: #f0a0a0; }
  .cfg-section-title {
    color: #90a2aa;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 12px 0 6px;
  }
  .cfg-machine {
    background: #0c1416;
    border: 1px solid #243138;
    border-radius: 14px;
    padding: 14px 10px;
  }
  .cfg-kitflow {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 14px;
    align-items: flex-start;
  }
  .cfg-kitgroup { display: flex; flex-direction: column; align-items: center; }
  .cfg-kitcard {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    background: #101619;
    border: 1px solid #5fd7f7;
    border-radius: 8px;
    padding: 5px 6px 5px 8px;
  }
  .cfg-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex: 0 0 auto; }
  .cfg-kitmeta { min-width: 0; max-width: 150px; min-height: 42px; }
  .cfg-kitname {
    color: #ddeaee;
    font-size: 12px;
    line-height: 1.15;
    font-weight: 500;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 28px;
  }
  .cfg-kitparam { font-size: 10px; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cfg-kitremove {
    background: transparent;
    border: none;
    color: #7a8b92;
    font-size: 12px;
    cursor: pointer;
    padding: 0 2px;
    flex: 0 0 auto;
    line-height: 1;
  }
  .cfg-kitremove:hover { color: #e28; }
  .cfg-bracket { width: 2px; height: 8px; opacity: 0.6; }
  .cfg-vialrow { display: flex; gap: 6px; }
  .cfg-freerow { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .cfg-vialcol { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .cfg-vial {
    position: relative;
    width: 30px;
    height: 58px;
    background: #0b0d0e;
    border: 1px solid #2a363b;
    border-radius: 5px;
    overflow: hidden;
  }
  .cfg-vial.empty { border-style: dashed; border-color: #33424a; }
  .cfg-vial-fill { position: absolute; left: 4px; right: 4px; bottom: 4px; height: 30px; border-radius: 3px; }
  .cfg-vial-label {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 8px;
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    color: #08111a;
  }
  .cfg-vial-num {
    min-width: 21px;
    height: 21px;
    padding: 0 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    border: 1.5px solid #2f5866;
    background: rgba(11, 20, 24, 0.65);
    color: #cfe6ee;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
  }
  .cfg-vial-num.free { border-color: #33424a; color: #7f9299; }
  .cfg-addlist { display: flex; flex-direction: column; gap: 6px; }
  .cfg-add-kit {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    text-align: left;
    background: #101c22;
    border: 1px solid #24343b;
    border-radius: 8px;
    padding: 9px 12px;
    color: #edf7fa;
    cursor: pointer;
  }
  .cfg-add-kit:hover { border-color: rgba(102, 215, 247, 0.4); background: #13252c; }
  .cfg-add-name { font-size: 14px; }
  .cfg-add-meta { color: #8fb6c0; font-size: 12px; white-space: nowrap; }
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
    grid-template-rows: 310px;
    gap: 6px;
    align-items: start;
    z-index: 3;
  }
  .vial-card {
    position: relative;
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
    --calibration-top: 9px;
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
    height: calc(100% - var(--calibration-top));
    transform: scaleY(var(--fill-ratio));
    transform-origin: bottom;
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
  .vial-capacity-label {
    position: absolute;
    top: 29px;
    left: calc(50% + 33px);
    z-index: 4;
    width: max-content;
    max-width: 42px;
    color: rgba(230, 238, 238, 0.72);
    font-size: 8px;
    font-weight: 700;
    line-height: 1;
    text-align: left;
    text-shadow: 0 1px 4px rgba(0,0,0,0.85);
    pointer-events: none;
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
    min-height: 52px;
    padding: 12px 7px 7px;
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
  .chamber-slot p {
    margin: 4px 0 0;
    font-size: 10px;
    line-height: 1.2;
    color: #9daeb5;
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
    margin-top: 5px;
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
    0%, 21%, 34%, 70%, 83%, 100% {
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
    33%, 82% {
      opacity: 0;
      transform: translate(-50%, 50px) scale(0.6);
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
