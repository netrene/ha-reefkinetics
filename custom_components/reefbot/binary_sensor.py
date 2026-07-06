"""Binary sensor platform for Reef Kinetics ReefBot."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import ReefBotCoordinator
from .entity import ReefBotEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up ReefBot binary sensor entities."""
    coordinator: ReefBotCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([ReefBotOnlineBinarySensor(coordinator)])


class ReefBotOnlineBinarySensor(ReefBotEntity, BinarySensorEntity):
    """Representation of the ReefBot cloud connectivity status."""

    _attr_translation_key = "online"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the binary sensor."""
        super().__init__(coordinator, "online")

    @property
    def is_on(self) -> bool | None:
        """Return whether Reef Kinetics reports the device as connected."""
        device = self.coordinator.data.device
        if not device:
            return None
        value = _first_present(device, ("IsConnected", "isConnected", "connected"))
        if isinstance(value, bool):
            return value
        if isinstance(value, int):
            return value == 1
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "online"}
        return None


def _first_present(data: dict[str, Any], keys: tuple[str, ...]) -> Any:
    """Return the first present value from a dict."""
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None

