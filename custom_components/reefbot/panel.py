"""Frontend panel registration for Reef Kinetics ReefBot."""

from __future__ import annotations

from inspect import isawaitable
from pathlib import Path
from typing import Any

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig, async_register_static_paths
from homeassistant.core import HomeAssistant

from .const import DOMAIN

PANEL_URL_PATH = "reefbot"
PANEL_TITLE = "ReefBot"
PANEL_ICON = "mdi:robot-industrial-outline"
STATIC_URL_PATH = f"/{DOMAIN}_static"
FRONTEND_VERSION = "0.12.0"


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Register the ReefBot sidebar panel."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("panel_registered"):
        return

    frontend_path = Path(__file__).parent / "frontend"
    await async_register_static_paths(
        hass,
        [
            StaticPathConfig(
                STATIC_URL_PATH,
                str(frontend_path),
                cache_headers=True,
            )
        ],
    )

    result = frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_URL_PATH,
        config={
            "_panel_custom": {
                "name": "reefbot-panel",
                "js_url": f"{STATIC_URL_PATH}/reefbot-panel.js?v={FRONTEND_VERSION}",
            }
        },
        require_admin=False,
    )
    if isawaitable(result):
        await result

    domain_data["panel_registered"] = True


async def async_unload_panel(hass: HomeAssistant) -> None:
    """Remove the ReefBot sidebar panel."""
    domain_data: dict[str, Any] = hass.data.get(DOMAIN, {})
    if not domain_data.get("panel_registered"):
        return

    result = frontend.async_remove_panel(hass, PANEL_URL_PATH)
    if isawaitable(result):
        await result

    domain_data["panel_registered"] = False
