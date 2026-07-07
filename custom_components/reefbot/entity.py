"""Entity helpers for Reef Kinetics ReefBot."""

from __future__ import annotations

from typing import Any

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import ReefBotCoordinator


class ReefBotEntity(CoordinatorEntity[ReefBotCoordinator]):
    """Base entity for ReefBot."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: ReefBotCoordinator, suffix: str) -> None:
        """Initialize the entity."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{suffix}"
        self._attr_suggested_object_id = f"reefbot_{suffix}"

    @property
    def device_info(self) -> DeviceInfo:
        """Return Home Assistant device registry info."""
        data = self.coordinator.data
        device = data.device if data else None
        device_id = _first_present(device, ("DeviceId", "deviceId", "id"))
        serial = _first_present(device, ("SerialNumber", "serialNumber", "serial"))
        firmware = _first_present(device, ("VersionNumber", "versionNumber", "firmware"))
        name = _first_present(device, ("Name", "name")) or "ReefBot"

        identifier = str(serial or device_id or self.coordinator.entry.entry_id)
        info: DeviceInfo = {
            "identifiers": {(DOMAIN, identifier)},
            "manufacturer": "Reef Kinetics",
            "model": "ReefBot V2",
            "name": str(name),
        }
        if serial is not None:
            info["serial_number"] = str(serial)
        if firmware is not None:
            info["sw_version"] = str(firmware)
        return info


def _first_present(data: dict[str, Any] | None, keys: tuple[str, ...]) -> Any:
    """Return the first present value from a dict."""
    if not data:
        return None
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None
