const MODULE_ID = "gusi-fast-weather-dock";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let dock = null;
let toggleBtn = null;

// Weather Dock Application
class WeatherDock extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "gusi-weather-dock",
    classes: ["gusi-fwd"],
    window: {
      title: `${MODULE_ID}.dock.title`,
      icon: "fa-solid fa-cloud-sun-rain",
      minimizable: false,
      resizable: true,
    },
    position: { width: 260, height: 145 },
  };

  static PARTS = {
    dock: {
      template: `modules/${MODULE_ID}/templates/dock.hbs`,
    },
  };

  async _prepareContext(options) {
    const scene = canvas.scene;
    const current = scene?.weather ?? "";
    const effects = [];

    for (const [id, cfg] of Object.entries(CONFIG.weatherEffects ?? {})) {
      const rawLabel = cfg.label ?? id;
      effects.push({
        id,
        label: game.i18n.has(rawLabel) ? game.i18n.localize(rawLabel) : rawLabel,
        selected: id === current,
      });
    }
    effects.sort((a, b) => a.label.localeCompare(b.label));

    return {
      sceneName: scene?.name ?? "—",
      effects,
      noneLabel: game.i18n.localize(`${MODULE_ID}.dock.none`),
    };
  }

  _onFirstRender(context, options) {
    const saved = game.settings.get(MODULE_ID, "dockGeometry");
    if (saved && (saved.top != null || saved.left != null || saved.width != null || saved.height != null)) {
      this.setPosition({
        top: saved.top,
        left: saved.left,
        width: saved.width,
        height: saved.height,
      });
    }

    // Save position after dragging the window header
    const header = this.element.querySelector(".window-header");
    header?.addEventListener("pointerup", () => {
      clearTimeout(this._posSaveTimer);
      this._posSaveTimer = setTimeout(() => this.#saveGeometry(), 150);
    });

    // Persist dimensions after manual resize.
    this._sizeObserver = new ResizeObserver(() => {
      clearTimeout(this._sizeSaveTimer);
      this._sizeSaveTimer = setTimeout(() => this.#saveGeometry(), 150);
    });
    this._sizeObserver.observe(this.element);
  }

  _onRender(context, options) {
    const select = this.element.querySelector("select[name='weather']");
    select?.addEventListener("change", this.#onWeatherChange.bind(this));
  }

  #saveGeometry() {
    const pos = this.position;
    game.settings.set(MODULE_ID, "dockGeometry", {
      top: pos.top,
      left: pos.left,
      width: pos.width,
      height: pos.height,
    });
  }

  async #onWeatherChange(event) {
    if (!game.user.isGM) return;
    const value = event.target.value;
    if (canvas.scene) await canvas.scene.update({ weather: value });
  }

  async close(options = {}) {
    this._sizeObserver?.disconnect();
    this._sizeObserver = null;
    if (!options._destroy) {
      this.#saveGeometry();
      await game.settings.set(MODULE_ID, "dockCollapsed", true);
      _showToggle(true);
    }
    dock = null;
    return super.close(options);
  }
}

// Toggle Button (floating, draggable)

function _createToggleButton() {
  if (!game.user.isGM) return;
  if (toggleBtn) return;

  toggleBtn = document.createElement("button");
  toggleBtn.id = "gusi-fwd-toggle";
  toggleBtn.innerHTML = '<i class="fa-solid fa-cloud-sun-rain"></i>';
  toggleBtn.title = game.i18n.localize(`${MODULE_ID}.dock.title`);

  // Drag handling
  let wasDragged = false;
  let startX, startY, origX, origY;

  toggleBtn.addEventListener("mousedown", (e) => {
    wasDragged = false;
    startX = e.clientX;
    startY = e.clientY;
    const r = toggleBtn.getBoundingClientRect();
    origX = r.left;
    origY = r.top;

    const onMove = (e2) => {
      if (Math.abs(e2.clientX - startX) > 3 || Math.abs(e2.clientY - startY) > 3) wasDragged = true;
      if (!wasDragged) return;
      toggleBtn.style.left = `${origX + e2.clientX - startX}px`;
      toggleBtn.style.top = `${origY + e2.clientY - startY}px`;
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (wasDragged) {
        game.settings.set(MODULE_ID, "togglePosition", {
          top: parseInt(toggleBtn.style.top),
          left: parseInt(toggleBtn.style.left),
        });
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  toggleBtn.addEventListener("click", (e) => {
    if (wasDragged) { wasDragged = false; return; }
    _openDock();
  });

  // Initial position
  const pos = game.settings.get(MODULE_ID, "togglePosition");
  toggleBtn.style.top = `${pos.top}px`;
  toggleBtn.style.left = `${pos.left}px`;

  document.body.appendChild(toggleBtn);
}

function _showToggle(visible) {
  if (toggleBtn) toggleBtn.style.display = visible ? "" : "none";
}

function _openDock() {
  if (!game.user.isGM) return;
  if (dock?.rendered) { dock.bringToTop(); return; }
  dock = new WeatherDock();
  dock.render(true);
  _showToggle(false);
  game.settings.set(MODULE_ID, "dockCollapsed", false);
}

function _destroyAll() {
  if (dock?.rendered) dock.close({ _destroy: true });
  dock = null;
  toggleBtn?.remove();
  toggleBtn = null;
}

// Initialization and Hooks

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "dockCollapsed", {
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "dockGeometry", {
    scope: "client",
    config: false,
    type: Object,
    default: { width: 260, height: 145 },
  });

  game.settings.register(MODULE_ID, "togglePosition", {
    scope: "client",
    config: false,
    type: Object,
    default: { top: 80, left: 15 },
  });
});

Hooks.on("canvasReady", () => {
  if (!game.user.isGM) return;

  _createToggleButton();

  if (game.settings.get(MODULE_ID, "dockCollapsed")) {
    _showToggle(true);
  } else {
    _openDock();
  }
});

Hooks.on("canvasTearDown", () => _destroyAll());

Hooks.on("updateScene", (scene, changes) => {
  if (dock?.rendered && scene.id === canvas.scene?.id && ("weather" in changes)) {
    const select = dock.element.querySelector("select[name='weather']");
    if (select) select.value = changes.weather ?? "";
  }
});
