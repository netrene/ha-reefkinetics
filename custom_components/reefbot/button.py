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
    known_refill_buttons: set[int] = set()
    known_component_buttons: set[str] = set()

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

    @callback
    def add_refill_buttons() -> None:
        entities: list[ButtonEntity] = []
        for tube in coordinator.data.tubes:
            tube_number = _tube_number(tube)
            if tube_number is None or tube_number in known_refill_buttons:
                continue
            known_refill_buttons.add(tube_number)
            entities.append(ReefBotRefillChemicalButton(coordinator, tube_number))
        if entities:
            async_add_entities(entities)

    @callback
    def add_component_buttons() -> None:
        entities: list[ButtonEntity] = []
        for component in coordinator.data.component_settings:
            component_id = _device_component_id(component)
            if component_id is None or not _is_resettable_component(component):
                continue
            component_key = str(component_id)
            if component_key in known_component_buttons:
                continue
            known_component_buttons.add(component_key)
            entities.append(ReefBotResetComponentButton(coordinator, component_id))
        if entities:
            async_add_entities(entities)

    add_start_buttons()
    add_refill_buttons()
    add_component_buttons()
    remove_start_listener: CALLBACK_TYPE = coordinator.async_add_listener(
        add_start_buttons
    )
    remove_refill_listener: CALLBACK_TYPE = coordinator.async_add_listener(
        add_refill_buttons
    )
    remove_component_listener: CALLBACK_TYPE = coordinator.async_add_listener(
        add_component_buttons
    )
    entry.async_on_unload(remove_start_listener)
    entry.async_on_unload(remove_refill_listener)
    entry.async_on_unload(remove_component_listener)


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
        self._attr_name = str(display_name)
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


class ReefBotRefillChemicalButton(ReefBotEntity, ButtonEntity):
    """Button that resets one ReefBot chemical to its configured full volume."""

    _attr_icon = "mdi:bottle-tonic-plus-outline"

    def __init__(self, coordinator: ReefBotCoordinator, tube_number: int) -> None:
        """Initialize the button."""
        super().__init__(coordinator, f"refill_tube_{tube_number}")
        self._tube_number = tube_number
        self._attr_suggested_object_id = f"reefbot_refill_tube_{tube_number}"

    @property
    def name(self) -> str:
        """Return a refill button name that includes the configured chemical."""
        tube = self._tube()
        chemical = _chemical_display_name(tube)
        if chemical:
            return f"Refill Tube {self._tube_number}: {chemical}"
        return f"Refill Tube {self._tube_number}"

    @property
    def available(self) -> bool:
        """Return whether the chemical can be refilled."""
        return (
            super().available
            and self._tube() is not None
            and _device_id(self.coordinator) is not None
        )

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return details about the chemical this button refills."""
        tube = self._tube()
        if not tube:
            return {"tube_number": self._tube_number}

        current_value = _first_present(tube, ("CurrentValue", "currentValue"))
        capacity = _chemical_capacity(tube)
        return {
            "tube_number": self._tube_number,
            "position_index": self._position_index,
            "chemical_id": _first_present(tube, ("ChemicalId", "chemicalId")),
            "chemical_display_name": _chemical_display_name(tube),
            "current_value": current_value,
            "full_value": capacity,
            "unit": _first_present(tube, ("Unit", "unit")),
        }

    async def async_press(self) -> None:
        """Reset one chemical to the configured full volume."""
        await self.coordinator.async_request_refresh()

        tube = self._tube()
        device_id = _device_id(self.coordinator)
        if tube is None:
            raise HomeAssistantError("ReefBot chemical is no longer configured")
        if device_id is None:
            raise HomeAssistantError("ReefBot device ID is missing")
        if _chemical_capacity(tube) is None:
            raise HomeAssistantError("ReefBot chemical has no configured volume")

        try:
            await self.coordinator.client.refill_device_chemical(
                device_id, self._position_index
            )
        except ReefBotApiError as err:
            raise HomeAssistantError("Unable to refill ReefBot chemical") from err

        await self.coordinator.async_request_refresh()

    @property
    def _position_index(self) -> int:
        """Return the zero-based chemical position index."""
        return self._tube_number - 1

    def _tube(self) -> dict[str, Any] | None:
        """Return the current tube data for this button."""
        for tube in self.coordinator.data.tubes:
            position = _first_present(tube, ("PositionIndex", "positionIndex"))
            try:
                if int(position) == self._position_index:
                    return tube
            except (TypeError, ValueError):
                continue
        return None


class ReefBotResetComponentButton(ReefBotEntity, ButtonEntity):
    """Button that resets a ReefBot maintenance component."""

    _attr_icon = "mdi:restore"

    def __init__(
        self, coordinator: ReefBotCoordinator, device_component_id: Any
    ) -> None:
        """Initialize the button."""
        super().__init__(coordinator, f"reset_component_{device_component_id}")
        self._device_component_id = str(device_component_id)
        component = self._component()
        component_name = _component_name(component) or self._device_component_id
        reset_title = _component_reset_title(component)
        self._attr_suggested_object_id = (
            f"reefbot_{slugify(reset_title)}_{slugify(str(component_name))}"
        )

    @property
    def name(self) -> str:
        """Return the component reset button name."""
        component = self._component()
        component_name = _component_name(component) or self._device_component_id
        reset_title = _component_reset_title(component)
        return f"{reset_title} {component_name}"

    @property
    def available(self) -> bool:
        """Return whether the component can be reset."""
        return (
            super().available
            and self._component() is not None
            and _device_id(self.coordinator) is not None
        )

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return details about the component this button resets."""
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
            "reset_value": _component_reset_value(component),
            "original_value": _first_present(
                component, ("OriginalValue", "originalValue")
            ),
            "unit": _first_present(component, ("Unit", "unit")),
            "reset_title": _component_reset_title(component),
        }

    async def async_press(self) -> None:
        """Reset one ReefBot maintenance component."""
        await self.coordinator.async_request_refresh()

        component = self._component()
        device_id = _device_id(self.coordinator)
        if component is None:
            raise HomeAssistantError("ReefBot component is no longer configured")
        if device_id is None:
            raise HomeAssistantError("ReefBot device ID is missing")
        if _component_reset_value(component) is None:
            raise HomeAssistantError("ReefBot component has no reset value")

        try:
            await self.coordinator.client.reset_device_component(
                device_id, self._device_component_id
            )
        except ReefBotApiError as err:
            raise HomeAssistantError("Unable to reset ReefBot component") from err

        await self.coordinator.async_request_refresh()

    def _component(self) -> dict[str, Any] | None:
        """Return the current component data for this button."""
        for component in self.coordinator.data.component_settings:
            component_id = _device_component_id(component)
            if component_id is not None and str(component_id) == self._device_component_id:
                return component
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


def _tube_number(tube: dict[str, Any]) -> int | None:
    """Return the one-based tube number from a chemical setting."""
    position = _first_present(tube, ("PositionIndex", "positionIndex"))
    try:
        return int(position) + 1
    except (TypeError, ValueError):
        return None


def _chemical_display_name(tube: dict[str, Any] | None) -> str | None:
    """Return a display name for a chemical setting."""
    value = _first_present(tube, ("ChemicalDisplayName", "chemicalDisplayName"))
    return str(value) if value is not None else None


def _chemical_capacity(tube: dict[str, Any]) -> Any:
    """Return the configured full chemical volume."""
    return _first_present(
        tube,
        (
            "CustomVolume",
            "customVolume",
            "SizeTypeValue",
            "sizeTypeValue",
            "CurrentValue",
            "currentValue",
        ),
    )


def _is_resettable_component(component: dict[str, Any]) -> bool:
    """Return whether a maintenance component should get a reset button."""
    name = (_component_name(component) or "").strip().lower()
    return name in {"syringe", "waste", "rodi"}


def _device_component_id(component: dict[str, Any]) -> Any:
    """Return the device component ID."""
    return _first_present(component, ("DeviceComponentId", "deviceComponentId"))


def _component_name(component: dict[str, Any] | None) -> str | None:
    """Return the maintenance component display name."""
    value = _first_present(component, ("ComponentName", "componentName"))
    return str(value) if value is not None else None


def _component_reset_title(component: dict[str, Any] | None) -> str:
    """Return the dashboard reset action label."""
    value = _first_present(component, ("ResetTitle", "resetTitle"))
    return str(value) if value is not None else "Reset"


def _component_reset_value(component: dict[str, Any]) -> Any:
    """Return the value after resetting a maintenance component."""
    change_operation = _first_present(
        component, ("ChangeOperation", "changeOperation")
    )
    try:
        operation = int(change_operation)
    except (TypeError, ValueError):
        operation = None

    original_value = _first_present(component, ("OriginalValue", "originalValue"))
    if operation == 0:
        return original_value
    if operation == 1:
        return 0

    reset_title = _component_reset_title(component).strip().lower()
    if reset_title == "refill":
        return original_value
    if reset_title in {"empty", "replace", "reset"}:
        return 0
    return None


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
