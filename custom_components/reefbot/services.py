"""Services for the Reef Kinetics ReefBot integration."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError
import homeassistant.helpers.config_validation as cv

from .const import DOMAIN
from .coordinator import ReefBotCoordinator

SERVICE_SET_CHEMICAL_POSITIONS = "set_chemical_positions"

POSITION_SCHEMA = vol.Schema(
    {
        vol.Required("position_index"): vol.All(vol.Coerce(int), vol.Range(min=0)),
        vol.Required("chemical_id"): vol.Any(cv.string, vol.Coerce(int)),
        vol.Optional("chemical_name", default=""): cv.string,
    }
)

SET_CHEMICAL_POSITIONS_SCHEMA = vol.Schema(
    {
        vol.Optional("device_id"): vol.Any(cv.string, vol.Coerce(int)),
        vol.Required("positions"): vol.All(cv.ensure_list, [POSITION_SCHEMA]),
    }
)


def _coordinators(hass: HomeAssistant) -> list[ReefBotCoordinator]:
    """Return all loaded ReefBot coordinators."""
    return [
        value
        for value in hass.data.get(DOMAIN, {}).values()
        if isinstance(value, ReefBotCoordinator)
    ]


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Register ReefBot services once."""
    if hass.services.has_service(DOMAIN, SERVICE_SET_CHEMICAL_POSITIONS):
        return

    async def _handle_set_chemical_positions(call: ServiceCall) -> None:
        coordinators = _coordinators(hass)
        if not coordinators:
            raise HomeAssistantError("No ReefBot device is set up")

        target = call.data.get("device_id")
        if target is not None:
            coordinator = next(
                (
                    candidate
                    for candidate in coordinators
                    if str(candidate._resolve_device_id()) == str(target)
                ),
                None,
            )
            if coordinator is None:
                raise HomeAssistantError(f"No ReefBot device with id {target}")
        elif len(coordinators) > 1:
            raise HomeAssistantError(
                "Multiple ReefBot devices are set up; specify device_id"
            )
        else:
            coordinator = coordinators[0]

        await coordinator.async_set_chemical_positions(list(call.data["positions"]))

    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_CHEMICAL_POSITIONS,
        _handle_set_chemical_positions,
        schema=SET_CHEMICAL_POSITIONS_SCHEMA,
    )


@callback
def async_unload_services(hass: HomeAssistant) -> None:
    """Remove ReefBot services when the last entry is unloaded."""
    if _coordinators(hass):
        return
    hass.services.async_remove(DOMAIN, SERVICE_SET_CHEMICAL_POSITIONS)
