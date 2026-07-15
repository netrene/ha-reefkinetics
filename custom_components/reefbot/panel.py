"""Frontend panel registration for Reef Kinetics ReefBot."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .coordinator import ReefBotCoordinator

PANEL_URL = "reefbot"
PANEL_COMPONENT_NAME = "reefbot-panel"
PANEL_TITLE = "ReefBot"
PANEL_ICON = "mdi:robot-industrial-outline"
PANEL_VERSION = "0.13.0"
PANEL_FILE = "frontend/reefbot-panel.js"
PANEL_MODULE_URL = f"/reefbot/panel-{PANEL_VERSION}.js"

PANEL_REGISTERED_VERSION = "__panel_registered_version"
STATIC_REGISTERED = "__static_registered"


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Register the ReefBot sidebar panel."""
    data = hass.data.setdefault(DOMAIN, {})

    if data.get(STATIC_REGISTERED) != PANEL_VERSION:
        static_path = Path(__file__).parent / PANEL_FILE
        await hass.http.async_register_static_paths(
            [StaticPathConfig(PANEL_MODULE_URL, str(static_path), False)]
        )
        data[STATIC_REGISTERED] = PANEL_VERSION

    frontend_panels = hass.data.get("frontend_panels", {})
    if (
        PANEL_URL in frontend_panels
        and data.get(PANEL_REGISTERED_VERSION) != PANEL_VERSION
    ):
        frontend.async_remove_panel(hass, PANEL_URL)

    if PANEL_URL not in hass.data.get("frontend_panels", {}):
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL,
            webcomponent_name=PANEL_COMPONENT_NAME,
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=PANEL_MODULE_URL,
            config={"domain": DOMAIN, "version": PANEL_VERSION},
            require_admin=False,
        )
    data[PANEL_REGISTERED_VERSION] = PANEL_VERSION


@callback
def async_unload_panel_if_unused(hass: HomeAssistant) -> None:
    """Remove the panel when no ReefBot entries are loaded."""
    data: dict[str, Any] = hass.data.get(DOMAIN, {})
    if any(isinstance(value, ReefBotCoordinator) for value in data.values()):
        return

    if PANEL_URL in hass.data.get("frontend_panels", {}):
        frontend.async_remove_panel(hass, PANEL_URL)
    data.pop(PANEL_REGISTERED_VERSION, None)
