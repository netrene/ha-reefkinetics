"""Button platform for Reef Kinetics ReefBot."""

from __future__ import annotations

from typing import Any

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
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
    """Set up ReefBot button entities."""
    coordinator: ReefBotCoordinator = hass.data[DOMAIN][entry.entry_id]
    known_start_buttons: set[str] = set()

    @callback
    def add_start_buttons() -> None:
        entities: list[ButtonEntity] = []
        for operation in coordinator.data.configured_operations:
            operation_id = _operation_id(operation)
            if operation_id is None or not _is_test_operation(operation):
                continue
            operation_key = str(operation_id)
            if operation_key in known_start_buttons:
                continue
            known_start_buttons.add(operation_key)
            entities.append(ReefBotStartTestButton(coordinator, operation))
        if entities:
            async_add_entities(entities)

    add_start_buttons()
    remove_listener: CALLBACK_TYPE = coordinator.async_add_listener(add_start_buttons)
    entry.async_on_unload(remove_listener)


class ReefBotStartTestButton(ReefBotEntity, ButtonEntity):
    """Button that requests a one-time ReefBot test."""

    _attr_icon = "mdi:play-circle-outline"

    def __init__(
        self, coordinator: ReefBotCoordinator, operation: dict[str, Any]
    ) -> None:
        """Initialize the button."""
        operation_id = _operation_id(operation)
        super().__init__(coordinator, f"start_test_{operation_id}")
        self._operation_id = str(operation_id)
        display_name = _operation_display_name(operation) or self._operation_id
        self._attr_name = f"Start test: {display_name}"
        self._attr_suggested_object_id = (
            f"reefbot_start_test_{slugify(str(display_name))}"
        )

    @property
    def available(self) -> bool:
        """Return whether the test can be started now."""
        return (
            super().available
            and self._operation() is not None
            and not self.coordinator.data.pending_operation_requests
            and _device_id(self.coordinator) is not None
            and _tank_id(self.coordinator) is not None
        )

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return details about the test this button starts."""
        operation = self._operation()
        if not operation:
            return {"available_operation_id": self._operation_id}
        return {
            "available_operation_id": self._operation_id,
            "display_name": _operation_display_name(operation),
            "operation_name": _first_present(
                operation, ("AvailableOperationName", "availableOperationName")
            ),
            "parameter": _first_present(
                operation, ("OperationParameterName", "operationParameterName")
            ),
            "pending_operation_count": len(
                self.coordinator.data.pending_operation_requests
            ),
        }

    async def async_press(self) -> None:
        """Request a one-time test."""
        await self.coordinator.async_request_refresh()

        operation = self._operation()
        device_id = _device_id(self.coordinator)
        tank_id = _tank_id(self.coordinator)

        if operation is None:
            raise HomeAssistantError("ReefBot test is no longer configured")
        if self.coordinator.data.pending_operation_requests:
            raise HomeAssistantError("ReefBot already has a pending operation")
        if device_id is None or tank_id is None:
            raise HomeAssistantError("ReefBot device or tank ID is missing")

        try:
            await self.coordinator.client.request_one_time_operation(
                device_id, tank_id, self._operation_id
            )
        except ReefBotApiError as err:
            raise HomeAssistantError("Unable to start ReefBot test") from err

        await self.coordinator.async_request_refresh()

    def _operation(self) -> dict[str, Any] | None:
        """Return the current operation data for this button."""
        for operation in self.coordinator.data.configured_operations:
            operation_id = _operation_id(operation)
            if str(operation_id) == self._operation_id:
                return operation
        return None


def _is_test_operation(operation: dict[str, Any]) -> bool:
    """Return whether an operation looks like a water test."""
    return _first_present(
        operation, ("OperationParameterId", "operationParameterId")
    ) is not None or _first_present(
        operation, ("OperationParameterName", "operationParameterName")
    ) is not None


def _operation_id(operation: dict[str, Any]) -> Any:
    """Return the available operation ID."""
    return _first_present(operation, ("AvailableOperationId", "availableOperationId"))


def _operation_display_name(operation: dict[str, Any]) -> str | None:
    """Return the operation display name."""
    value = _first_present(operation, ("DisplayName", "displayName"))
    return str(value) if value is not None else None


def _device_id(coordinator: ReefBotCoordinator) -> Any:
    """Return the current ReefBot device ID."""
    return _first_present(coordinator.data.device, ("DeviceId", "deviceId", "id"))


def _tank_id(coordinator: ReefBotCoordinator) -> Any:
    """Return the current tank ID."""
    return _first_present(coordinator.data.tank, ("TankId", "tankId", "id"))


def _first_present(data: dict[str, Any] | None, keys: tuple[str, ...]) -> Any:
    """Return the first present value from a dict."""
    if not data:
        return None
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None
