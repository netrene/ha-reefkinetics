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
        ReefBotLastUpdateSensor(coordinator),
        ReefBotLastSuccessfulTestSensor(coordinator),
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
                    _latest_history_value(
                        parameter, "AddedDateString", "addedDateString", "Date", "date"
                    )
                )
            )
        ]
        return max(dates) if dates else None


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
        self._attr_native_unit_of_measurement = self._unit()

    @property
    def native_value(self) -> float | str | None:
        """Return the latest parameter value."""
        parameter = self._parameter()
        if not parameter:
            return None
        value = _latest_history_value(parameter, "Value", "value")
        return _coerce_number(value)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return parameter metadata."""
        parameter = self._parameter()
        if not parameter:
            return {"parameter_name": self._parameter_name}
        return {
            "parameter_name": self._parameter_name,
            "last_test": _latest_history_value(
                parameter, "AddedDateString", "addedDateString", "Date", "date"
            ),
            "raw_unit": _first_present(
                parameter, ("Unit", "unit", "UnitName", "unitName")
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
        api_unit = _latest_history_value(
            parameter, "ValueSuffixSymbol", "valueSuffixSymbol"
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


def _latest_history_value(parameter: dict[str, Any], *keys: str) -> Any:
    """Return a value from the newest operation history item."""
    history = _first_present(parameter, ("OperationsHistory", "operationsHistory"))
    if not isinstance(history, list) or not history:
        return None
    latest = history[0]
    if not isinstance(latest, dict):
        return None
    return _first_present(latest, keys)


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
