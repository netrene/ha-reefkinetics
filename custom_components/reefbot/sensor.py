"""Sensor platform for Reef Kinetics ReefBot."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.const import PERCENTAGE
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import slugify

from .const import DOMAIN, EXCLUDED_PARAMETER_NAMES, UNIT_MAP
from .coordinator import ReefBotCoordinator
from .entity import ReefBotEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up ReefBot sensor entities."""
    coordinator: ReefBotCoordinator = hass.data[DOMAIN][entry.entry_id]
    known_parameters: set[str] = set()

    static_entities: list[SensorEntity] = [
        ReefBotDeviceSensor(
            coordinator,
            "firmware_version",
            "firmware_version",
            _device_value("VersionNumber", "versionNumber", "firmware"),
        ),
        ReefBotDeviceSensor(
            coordinator,
            "serial_number",
            "serial_number",
            _device_value("SerialNumber", "serialNumber", "serial"),
        ),
        ReefBotDeviceSensor(
            coordinator,
            "vials_number",
            "vials_number",
            _device_value("VialsNumber", "vialsNumber"),
        ),
        ReefBotTankSensor(
            coordinator, "tank_name", "tank_name", _tank_value("Name", "name")
        ),
        ReefBotTankSensor(
            coordinator,
            "tank_volume",
            "tank_volume",
            _tank_value("Volume", "volume"),
        ),
        ReefBotConfiguredTestsSensor(coordinator),
        ReefBotLastUpdateSensor(coordinator),
        ReefBotLastSuccessfulTestSensor(coordinator),
        *[ReefBotTubeSensor(coordinator, tube_number) for tube_number in range(1, 9)],
    ]
    async_add_entities(static_entities)

    @callback
    def add_parameter_entities() -> None:
        entities: list[SensorEntity] = []
        for parameter in coordinator.data.parameters:
            name = _parameter_name(parameter)
            if not name:
                continue
            parameter_key = slugify(name)
            if parameter_key in EXCLUDED_PARAMETER_NAMES:
                continue
            if parameter_key in known_parameters:
                continue
            known_parameters.add(parameter_key)
            entities.append(ReefBotParameterSensor(coordinator, name, parameter_key))
        if entities:
            async_add_entities(entities)

    add_parameter_entities()
    remove_listener: CALLBACK_TYPE = coordinator.async_add_listener(
        add_parameter_entities
    )
    entry.async_on_unload(remove_listener)


class ReefBotDeviceSensor(ReefBotEntity, SensorEntity):
    """Device metadata sensor."""

    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(
        self,
        coordinator: ReefBotCoordinator,
        suffix: str,
        translation_key: str,
        value_fn: Callable[[ReefBotCoordinator], Any],
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, suffix)
        self._attr_translation_key = translation_key
        self._value_fn = value_fn

    @property
    def native_value(self) -> Any:
        """Return the sensor value."""
        return self._value_fn(self.coordinator)


class ReefBotTankSensor(ReefBotDeviceSensor):
    """Tank metadata sensor."""


class ReefBotLastUpdateSensor(ReefBotEntity, SensorEntity):
    """Timestamp of the last successful cloud update."""

    _attr_translation_key = "last_update"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "last_update")

    @property
    def native_value(self) -> datetime | None:
        """Return the last successful coordinator update time."""
        return self.coordinator.last_successful_refresh


class ReefBotLastSuccessfulTestSensor(ReefBotEntity, SensorEntity):
    """Timestamp of the latest test result across all parameters."""

    _attr_translation_key = "last_successful_test"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "last_successful_test")

    @property
    def native_value(self) -> datetime | None:
        """Return the latest operation timestamp."""
        dates = [
            parsed
            for parameter in self.coordinator.data.parameters
            if (
                parsed := _parse_datetime(
                    _history_value(
                        self.coordinator.data.history_for_parameter(parameter),
                        0,
                        "AddedDateString",
                        "addedDateString",
                        "Date",
                        "date",
                    )
                )
            )
        ]
        return max(dates) if dates else None


class ReefBotConfiguredTestsSensor(ReefBotEntity, SensorEntity):
    """Number of currently configured tests based on installed chemicals."""

    _attr_translation_key = "configured_tests"
    _attr_icon = "mdi:test-tube"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "configured_tests")

    @property
    def native_value(self) -> int:
        """Return the number of configured operations."""
        return len(self.coordinator.data.configured_operations)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return configured operation details."""
        tubes_by_chemical_id = _tubes_by_chemical_id(self.coordinator.data.tubes)
        return {
            "tests": [
                _configured_operation_summary(operation, tubes_by_chemical_id)
                for operation in self.coordinator.data.configured_operations
            ],
            "available_operations_count": len(
                self.coordinator.data.available_operations
            ),
            "latest_results": [
                _device_result_summary(result)
                for result in self.coordinator.data.device_results[:5]
                if isinstance(result, dict)
            ],
        }


class ReefBotTubeSensor(ReefBotEntity, SensorEntity):
    """Configured chemical and fill level for one ReefBot tube."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_icon = "mdi:test-tube"

    def __init__(self, coordinator: ReefBotCoordinator, tube_number: int) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, f"tube_{tube_number}")
        self._tube_number = tube_number
        self._attr_name = f"Tube {tube_number}"

    @property
    def native_value(self) -> int | None:
        """Return tube fill level percentage."""
        tube = self._tube()
        if not tube:
            return None
        current = _coerce_number(_first_present(tube, ("CurrentValue", "currentValue")))
        capacity = _coerce_number(
            _first_present(
                tube, ("SizeTypeValue", "sizeTypeValue", "CustomVolume", "customVolume")
            )
        )
        if not isinstance(current, int | float) or not isinstance(capacity, int | float):
            return None
        if capacity <= 0:
            return None
        return round(current / capacity * 100)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return tube chemical metadata."""
        tube = self._tube()
        if not tube:
            return {"tube_number": self._tube_number}

        current = _first_present(tube, ("CurrentValue", "currentValue"))
        capacity = _first_present(
            tube, ("SizeTypeValue", "sizeTypeValue", "CustomVolume", "customVolume")
        )
        return {
            "tube_number": self._tube_number,
            "position_index": _first_present(tube, ("PositionIndex", "positionIndex")),
            "chemical_id": _first_present(tube, ("ChemicalId", "chemicalId")),
            "chemical_display_name": _first_present(
                tube, ("ChemicalDisplayName", "chemicalDisplayName")
            ),
            "chemical_name": _first_present(tube, ("ChemicalName", "chemicalName")),
            "current_volume": current,
            "capacity": capacity,
            "unit": _first_present(tube, ("Unit", "unit")),
            "size_type": _first_present(tube, ("SizeTypeName", "sizeTypeName")),
        }

    def _tube(self) -> dict[str, Any] | None:
        """Return the chemical setting for this tube."""
        expected_position = self._tube_number - 1
        for tube in self.coordinator.data.tubes:
            position = _first_present(tube, ("PositionIndex", "positionIndex"))
            try:
                if int(position) == expected_position:
                    return tube
            except (TypeError, ValueError):
                continue
        return None


class ReefBotParameterSensor(ReefBotEntity, SensorEntity):
    """Dynamic ReefBot test result sensor."""

    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(
        self, coordinator: ReefBotCoordinator, parameter_name: str, parameter_key: str
    ) -> None:
        """Initialize the parameter sensor."""
        super().__init__(coordinator, f"parameter_{parameter_key}")
        self._parameter_name = parameter_name
        self._parameter_key = parameter_key
        self._attr_name = parameter_name
        self._attr_suggested_object_id = f"reefbot_{parameter_key}"
        self._attr_native_unit_of_measurement = self._unit()

    @property
    def native_value(self) -> float | str | None:
        """Return the latest parameter value."""
        parameter = self._parameter()
        if not parameter:
            return None
        value = _history_value(
            self.coordinator.data.history_for_parameter(parameter), 0, "Value", "value"
        )
        return _coerce_number(value)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return parameter metadata."""
        parameter = self._parameter()
        if not parameter:
            return {"parameter_name": self._parameter_name}
        history = self.coordinator.data.history_for_parameter(parameter)
        latest = history[0] if history else {}
        previous = history[1] if len(history) > 1 else {}
        return {
            "parameter_name": self._parameter_name,
            "last_test": _history_value(
                history, 0, "AddedDateString", "addedDateString", "Date", "date"
            ),
            "previous_value": _history_value(history, 1, "Value", "value"),
            "previous_test": _history_value(
                history, 1, "AddedDateString", "addedDateString", "Date", "date"
            ),
            "brand": _first_present(
                latest,
                ("OperationMethodName", "operationMethodName", "Brand", "brand"),
            ),
            "operation_name": _first_present(
                latest, ("OperationName", "operationName")
            ),
            "operation_method": _first_present(
                latest, ("OperationMethodName", "operationMethodName")
            ),
            "min_range": _first_present(latest, ("MinRange", "minRange")),
            "max_range": _first_present(latest, ("MaxRange", "maxRange")),
            "result_status_id": _first_present(
                latest, ("ResultStatusId", "resultStatusId")
            ),
            "history_count": len(history),
            "history": [
                _history_summary(item)
                for item in history[:5]
                if isinstance(item, dict)
            ],
            "raw_unit": _history_value(
                history, 0, "ValueSuffixSymbol", "valueSuffixSymbol"
            )
            or _first_present(
                latest,
                ("Unit", "unit", "UnitName", "unitName"),
            ),
            "tank_id": _first_present(
                self.coordinator.data.tank, ("TankId", "tankId", "id")
            ),
            "tank_name": _first_present(self.coordinator.data.tank, ("Name", "name")),
            "device_id": _first_present(
                self.coordinator.data.device, ("DeviceId", "deviceId", "id")
            ),
        }

    def _parameter(self) -> dict[str, Any] | None:
        """Return the latest matching parameter object."""
        for parameter in self.coordinator.data.parameters:
            name = _parameter_name(parameter)
            if name and slugify(name) == self._parameter_key:
                return parameter
        return None

    def _unit(self) -> str | None:
        """Return the unit for the parameter."""
        parameter = self._parameter()
        history = self.coordinator.data.history_for_parameter(parameter) if parameter else []
        api_unit = _history_value(
            history, 0, "ValueSuffixSymbol", "valueSuffixSymbol"
        ) or _first_present(parameter, ("Unit", "unit", "UnitName", "unitName"))
        if api_unit:
            return str(api_unit)
        return UNIT_MAP.get(self._parameter_key)


def _device_value(*keys: str) -> Callable[[ReefBotCoordinator], Any]:
    """Return a getter for device fields."""

    def getter(coordinator: ReefBotCoordinator) -> Any:
        return _first_present(coordinator.data.device, keys)

    return getter


def _tank_value(*keys: str) -> Callable[[ReefBotCoordinator], Any]:
    """Return a getter for tank fields."""

    def getter(coordinator: ReefBotCoordinator) -> Any:
        return _first_present(coordinator.data.tank, keys)

    return getter


def _parameter_name(parameter: dict[str, Any]) -> str | None:
    """Return the display name for a parameter."""
    value = _first_present(
        parameter,
        ("OperationParameterName", "operationParameterName", "ParameterName", "name"),
    )
    return str(value) if value else None


def _history_value(history: list[dict[str, Any]], index: int, *keys: str) -> Any:
    """Return a value from an operation history item."""
    if len(history) <= index:
        return None
    item = history[index]
    if not isinstance(item, dict):
        return None
    return _first_present(item, keys)


def _history_summary(item: dict[str, Any]) -> dict[str, Any]:
    """Return a compact history row safe for entity attributes."""
    return {
        "date": _first_present(item, ("AddedDateString", "addedDateString")),
        "value": _first_present(item, ("Value", "value")),
        "display_value": _first_present(
            item, ("ValueDisplayString", "valueDisplayString")
        ),
        "brand": _first_present(
            item, ("OperationMethodName", "operationMethodName", "Brand", "brand")
        ),
        "operation": _first_present(item, ("OperationName", "operationName")),
        "device": _first_present(item, ("DeviceName", "deviceName")),
    }


def _device_result_summary(item: dict[str, Any]) -> dict[str, Any]:
    """Return a compact latest device result summary."""
    return {
        "operation": _first_present(item, ("OperationName", "operationName")),
        "value": _first_present(item, ("Value", "value")),
        "unit": _first_present(item, ("ValueSuffixSymbol", "valueSuffixSymbol")),
        "date": _first_present(item, ("AddedDateString", "addedDateString")),
    }


def _tubes_by_chemical_id(tubes: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Return installed tubes keyed by chemical ID."""
    result: dict[str, dict[str, Any]] = {}
    for tube in tubes:
        chemical_id = _first_present(tube, ("ChemicalId", "chemicalId"))
        if chemical_id is not None:
            result[str(chemical_id)] = tube
    return result


def _configured_operation_summary(
    operation: dict[str, Any], tubes_by_chemical_id: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """Return a compact configured operation summary."""
    related = _first_present(operation, ("RelatedChemicals", "relatedChemicals"))
    chemicals = [
        _related_chemical_summary(chemical, tubes_by_chemical_id)
        for chemical in related
        if isinstance(chemical, dict)
    ] if isinstance(related, list) else []
    return {
        "available_operation_id": _first_present(
            operation, ("AvailableOperationId", "availableOperationId")
        ),
        "display_name": _first_present(operation, ("DisplayName", "displayName")),
        "operation_name": _first_present(
            operation, ("AvailableOperationName", "availableOperationName")
        ),
        "method": _first_present(operation, ("OperationMethodName", "operationMethodName")),
        "parameter": _first_present(
            operation, ("OperationParameterName", "operationParameterName")
        ),
        "parameter_id": _first_present(
            operation, ("OperationParameterId", "operationParameterId")
        ),
        "chemicals": chemicals,
    }


def _related_chemical_summary(
    chemical: dict[str, Any], tubes_by_chemical_id: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """Return a compact related chemical summary with tube mapping."""
    chemical_id = _first_present(
        chemical, ("AvailableChemicalId", "availableChemicalId", "ChemicalId", "chemicalId")
    )
    tube = tubes_by_chemical_id.get(str(chemical_id)) if chemical_id is not None else None
    position = _first_present(tube, ("PositionIndex", "positionIndex")) if tube else None
    tube_number: int | None = None
    try:
        tube_number = int(position) + 1 if position is not None else None
    except (TypeError, ValueError):
        tube_number = None

    return {
        "chemical_id": chemical_id,
        "display_name": _first_present(chemical, ("DisplayName", "displayName")),
        "name": _first_present(chemical, ("Name", "name")),
        "tube": tube_number,
        "current_volume": _first_present(tube, ("CurrentValue", "currentValue"))
        if tube
        else None,
        "capacity": _first_present(tube, ("SizeTypeValue", "sizeTypeValue"))
        if tube
        else None,
        "unit": _first_present(tube, ("Unit", "unit")) if tube else None,
        "stop_at_percentage": _first_present(
            chemical, ("StopAtPercentage", "stopAtPercentage")
        ),
    }


def _first_present(data: dict[str, Any] | None, keys: tuple[str, ...]) -> Any:
    """Return the first present value from a dict."""
    if not data:
        return None
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None


def _coerce_number(value: Any) -> float | str | None:
    """Coerce numeric strings to numbers while preserving unknown values."""
    if value in (None, ""):
        return None
    if isinstance(value, int | float):
        return value
    if isinstance(value, str):
        text = value.strip().replace(",", ".")
        try:
            return float(text)
        except ValueError:
            return value
    return str(value)


def _parse_datetime(value: Any) -> datetime | None:
    """Parse Reef Kinetics timestamp strings as UTC when timezone is omitted."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if not isinstance(value, str):
        return None

    text = value.strip().replace("Z", "+00:00")
    for parser in (
        datetime.fromisoformat,
        lambda raw: datetime.strptime(raw, "%Y-%m-%d %H:%M"),
        lambda raw: datetime.strptime(raw, "%Y-%m-%d %H:%M:%S"),
    ):
        try:
            parsed = parser(text)
        except ValueError:
            continue
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None
