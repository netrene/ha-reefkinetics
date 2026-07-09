"""Number platform for Reef Kinetics ReefBot."""

from __future__ import annotations

from typing import Any

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import slugify

from .api import ReefBotApiError
from .const import DOMAIN
from .coordinator import ReefBotCoordinator
from .entity import ReefBotEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up ReefBot number entities."""
    coordinator: ReefBotCoordinator = hass.data[DOMAIN][entry.entry_id]
    known_capacity_numbers: set[str] = set()

    @callback
    def add_capacity_numbers() -> None:
        entities: list[NumberEntity] = []
        for component in coordinator.data.component_settings:
            component_id = _device_component_id(component)
            if component_id is None or not _component_allows_capacity_change(component):
                continue

            component_key = str(component_id)
            if component_key in known_capacity_numbers:
                continue

            known_capacity_numbers.add(component_key)
            entities.append(ReefBotComponentCapacityNumber(coordinator, component_id))

        if entities:
            async_add_entities(entities)

    add_capacity_numbers()
    remove_listener: CALLBACK_TYPE = coordinator.async_add_listener(
        add_capacity_numbers
    )
    entry.async_on_unload(remove_listener)


class ReefBotComponentCapacityNumber(ReefBotEntity, NumberEntity):
    """Number entity that updates a ReefBot maintenance component capacity."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_icon = "mdi:counter"
    _attr_mode = NumberMode.BOX
    _attr_native_min_value = 0.0

    def __init__(
        self, coordinator: ReefBotCoordinator, device_component_id: Any
    ) -> None:
        """Initialize the number entity."""
        super().__init__(coordinator, f"component_capacity_{device_component_id}")
        self._device_component_id = str(device_component_id)
        component = self._component()
        component_name = _component_name(component) or self._device_component_id
        self._attr_suggested_object_id = (
            f"reefbot_{slugify(str(component_name))}_capacity"
        )

    @property
    def name(self) -> str:
        """Return the capacity number name."""
        component = self._component()
        component_name = _component_name(component) or self._device_component_id
        return f"{component_name} capacity"

    @property
    def available(self) -> bool:
        """Return whether the component capacity can be changed."""
        component = self._component()
        return (
            super().available
            and component is not None
            and _component_allows_capacity_change(component)
            and _device_id(self.coordinator) is not None
        )

    @property
    def native_value(self) -> float | None:
        """Return the configured component capacity."""
        value = _component_original_value(self._component())
        return _as_float(value)

    @property
    def native_unit_of_measurement(self) -> str | None:
        """Return the component unit."""
        component = self._component()
        unit = _first_present(component, ("Unit", "unit"))
        return str(unit) if unit is not None else None

    @property
    def native_step(self) -> float:
        """Return a useful step size for component capacity changes."""
        unit = (self.native_unit_of_measurement or "").strip().lower()
        if unit in {"usage", "usages"}:
            return 1.0
        return 0.01

    @property
    def native_max_value(self) -> float:
        """Return a generous maximum capacity."""
        unit = (self.native_unit_of_measurement or "").strip().lower()
        if unit in {"usage", "usages"}:
            return 10000.0
        return 100.0

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return details about the component capacity."""
        component = self._component()
        if not component:
            return {"device_component_id": self._device_component_id}

        return {
            "device_component_id": self._device_component_id,
            "component_id": _first_present(
                component, ("ComponentId", "componentId")
            ),
            "component_name": _component_name(component),
            "current_value": _first_present(
                component, ("CurrentValue", "currentValue")
            ),
            "original_value": _component_original_value(component),
            "unit": _first_present(component, ("Unit", "unit")),
        }

    async def async_set_native_value(self, value: float) -> None:
        """Update the component capacity in the Reef Kinetics cloud."""
        await self.coordinator.async_request_refresh()

        component = self._component()
        device_id = _device_id(self.coordinator)
        if component is None:
            raise HomeAssistantError("ReefBot component is no longer configured")
        if not _component_allows_capacity_change(component):
            raise HomeAssistantError("ReefBot component capacity cannot be changed")
        if device_id is None:
            raise HomeAssistantError("ReefBot device ID is missing")

        try:
            await self.coordinator.client.update_device_component_capacity(
                device_id,
                self._device_component_id,
                value,
            )
        except ReefBotApiError as err:
            raise HomeAssistantError(
                "Unable to update ReefBot component capacity"
            ) from err

        await self.coordinator.async_request_refresh()

    def _component(self) -> dict[str, Any] | None:
        """Return the current component data for this number entity."""
        for component in self.coordinator.data.component_settings:
            component_id = _device_component_id(component)
            if component_id is not None and str(component_id) == self._device_component_id:
                return component
        return None


def _component_allows_capacity_change(component: dict[str, Any]) -> bool:
    """Return whether the dashboard enables manual capacity changes."""
    value = _first_present(component, ("AllowChange", "allowChange"))
    if isinstance(value, bool):
        return value
    try:
        return int(value) == 1
    except (TypeError, ValueError):
        return False


def _device_component_id(component: dict[str, Any]) -> Any:
    """Return the device component ID."""
    return _first_present(component, ("DeviceComponentId", "deviceComponentId"))


def _component_name(component: dict[str, Any] | None) -> str | None:
    """Return the maintenance component display name."""
    value = _first_present(component, ("ComponentName", "componentName"))
    return str(value) if value is not None else None


def _component_original_value(component: dict[str, Any] | None) -> Any:
    """Return the configured component capacity."""
    return _first_present(component, ("OriginalValue", "originalValue"))


def _device_id(coordinator: ReefBotCoordinator) -> Any:
    """Return the current ReefBot device ID."""
    return _first_present(coordinator.data.device, ("DeviceId", "deviceId", "id"))


def _as_float(value: Any) -> float | None:
    """Return a value as a float when possible."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_present(data: dict[str, Any] | None, keys: tuple[str, ...]) -> Any:
    """Return the first present value from a dict."""
    if not data:
        return None
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None
