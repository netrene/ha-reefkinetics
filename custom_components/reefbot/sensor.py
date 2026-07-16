"""Sensor platform for Reef Kinetics ReefBot."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
import re
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.const import PERCENTAGE, UnitOfTime
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.event import async_track_time_interval
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
    known_configured_tests: set[str] = set()

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
        ReefBotAvailableChemicalsSensor(coordinator),
        ReefBotAvailableOperationsSensor(coordinator),
        ReefBotCurrentOperationSensor(coordinator),
        ReefBotPendingOperationsSensor(coordinator),
        ReefBotCurrentTestDurationSensor(coordinator),
        ReefBotCurrentTestElapsedSensor(coordinator),
        ReefBotCurrentTestRemainingSensor(coordinator),
        ReefBotCurrentTestProgressSensor(coordinator),
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
        ReefBotNotificationsSensor(coordinator),
        ReefBotSafeMarginsSensor(coordinator),
        ReefBotAlarmLogsSensor(coordinator),
        ReefBotCalibrationPendingSensor(coordinator),
        ReefBotLastUpdateSensor(coordinator),
        ReefBotLastSuccessfulTestSensor(coordinator),
        ReefBotMaintenanceComponentSensor(
            coordinator, "syringe", "Syringe", ("syringe",)
        ),
        ReefBotMaintenanceComponentSensor(
            coordinator, "waste", "Waste", ("waste",)
        ),
        ReefBotMaintenanceComponentSensor(
            coordinator, "rodi", "RODI", ("rodi", "rodi tank", "ro tank")
        ),
        *[
            ReefBotTubeSensor(coordinator, tube_number)
            for tube_number in range(1, (coordinator.data.vial_count if coordinator.data else 8) + 1)
        ],
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

    @callback
    def add_configured_test_entities() -> None:
        entities: list[SensorEntity] = []
        for operation in coordinator.data.configured_operations:
            operation_id = _first_present(
                operation, ("AvailableOperationId", "availableOperationId")
            )
            name = _first_present(operation, ("DisplayName", "displayName"))
            if operation_id is None or not name:
                continue
            operation_key = str(operation_id)
            if operation_key in known_configured_tests:
                continue
            known_configured_tests.add(operation_key)
            entities.append(ReefBotConfiguredTestSensor(coordinator, operation))
        if entities:
            async_add_entities(entities)

    add_configured_test_entities()
    remove_parameter_listener: CALLBACK_TYPE = coordinator.async_add_listener(
        add_parameter_entities
    )
    remove_test_listener: CALLBACK_TYPE = coordinator.async_add_listener(
        add_configured_test_entities
    )
    entry.async_on_unload(remove_parameter_listener)
    entry.async_on_unload(remove_test_listener)


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


class ReefBotCurrentOperationSensor(ReefBotEntity, SensorEntity):
    """Currently pending ReefBot operation request."""

    _attr_translation_key = "current_operation"
    _attr_icon = "mdi:progress-clock"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "current_operation")

    @property
    def native_value(self) -> str:
        """Return the current operation name or idle."""
        request = self.coordinator.data.current_operation_request
        name = _first_present(request, ("Name", "name"))
        return str(name) if name is not None else "idle"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return details about the current operation request."""
        request = self.coordinator.data.current_operation_request
        if not request:
            return {"pending": False}
        return {
            "pending": True,
            **_operation_request_summary(request, self.coordinator),
        }


class ReefBotPendingOperationsSensor(ReefBotEntity, SensorEntity):
    """Number of pending ReefBot operation requests."""

    _attr_translation_key = "pending_operations"
    _attr_icon = "mdi:playlist-clock"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "pending_operations")

    @property
    def native_value(self) -> int:
        """Return the number of currently pending requests."""
        return len(self.coordinator.data.pending_operation_requests)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return pending request details and recent request history."""
        return {
            "pending": [
                _operation_request_summary(request, self.coordinator)
                for request in self.coordinator.data.pending_operation_requests[:5]
                if isinstance(request, dict)
            ],
            "recent_history": [
                _operation_request_summary(request, self.coordinator)
                for request in self.coordinator.data.operation_request_history[:10]
                if isinstance(request, dict)
            ],
        }


class ReefBotCurrentTestTimingSensor(ReefBotEntity, SensorEntity):
    """Base sensor for calculated current test timing."""

    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator, suffix: str) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, suffix)

    async def async_added_to_hass(self) -> None:
        """Update calculated time values between cloud refreshes."""
        await super().async_added_to_hass()
        self.async_on_remove(
            async_track_time_interval(
                self.hass, self._async_tick, timedelta(minutes=1)
            )
        )

    @callback
    def _async_tick(self, now: datetime) -> None:
        """Write a new state without refreshing the cloud coordinator."""
        self.async_write_ha_state()

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return timing metadata."""
        timing = _current_test_timing(self.coordinator)
        if not timing:
            return {"active": False}
        return {
            "active": True,
            "test_name": timing["name"],
            "started_at": timing["started_at"],
            "expected_completion_time": timing["expected_at"],
            "duration_minutes": timing["duration_minutes"],
        }


class ReefBotCurrentTestDurationSensor(ReefBotCurrentTestTimingSensor):
    """Configured duration of the current test."""

    _attr_translation_key = "current_test_duration"
    _attr_icon = "mdi:timer-outline"
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "current_test_duration")

    @property
    def native_value(self) -> int | None:
        """Return configured duration in minutes."""
        timing = _current_test_timing(self.coordinator)
        return timing["duration_minutes"] if timing else None


class ReefBotCurrentTestElapsedSensor(ReefBotCurrentTestTimingSensor):
    """Elapsed time of the current test."""

    _attr_translation_key = "current_test_elapsed_time"
    _attr_icon = "mdi:timer-sand"
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "current_test_elapsed_time")

    @property
    def native_value(self) -> int | None:
        """Return elapsed test time in minutes."""
        timing = _current_test_timing(self.coordinator)
        return timing["elapsed_minutes"] if timing else None


class ReefBotCurrentTestRemainingSensor(ReefBotCurrentTestTimingSensor):
    """Remaining time of the current test."""

    _attr_translation_key = "current_test_remaining_time"
    _attr_icon = "mdi:timer-sand-paused"
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "current_test_remaining_time")

    @property
    def native_value(self) -> int | None:
        """Return remaining test time in minutes."""
        timing = _current_test_timing(self.coordinator)
        return timing["remaining_minutes"] if timing else None


class ReefBotCurrentTestProgressSensor(ReefBotCurrentTestTimingSensor):
    """Progress of the current test."""

    _attr_translation_key = "current_test_progress"
    _attr_icon = "mdi:progress-clock"
    _attr_native_unit_of_measurement = PERCENTAGE

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "current_test_progress")

    @property
    def native_value(self) -> int | None:
        """Return current test progress as a percentage."""
        timing = _current_test_timing(self.coordinator)
        return timing["progress"] if timing else None


class ReefBotNotificationsSensor(ReefBotEntity, SensorEntity):
    """Recent Reef Kinetics notifications."""

    _attr_translation_key = "notifications"
    _attr_icon = "mdi:bell-outline"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "notifications")

    @property
    def native_value(self) -> int:
        """Return unread notification count, falling back to fetched items."""
        count = self.coordinator.data.unread_notifications_count
        return count if count is not None else len(self.coordinator.data.notifications)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return recent notification details."""
        return {
            "unread_count": self.coordinator.data.unread_notifications_count,
            "notifications": [
                _notification_summary(notification)
                for notification in self.coordinator.data.notifications[:10]
                if isinstance(notification, dict)
            ],
        }


class ReefBotSafeMarginsSensor(ReefBotEntity, SensorEntity):
    """Configured ReefBot tank safe margins."""

    _attr_translation_key = "safe_margins"
    _attr_icon = "mdi:alert-outline"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "safe_margins")

    @property
    def native_value(self) -> int:
        """Return configured safe margin count."""
        return len(self.coordinator.data.tank_alarms)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return safe margin details."""
        return {
            "safe_margins": [
                _alarm_summary(alarm)
                for alarm in self.coordinator.data.tank_alarms
                if isinstance(alarm, dict)
            ],
        }


class ReefBotAlarmLogsSensor(ReefBotEntity, SensorEntity):
    """Recent ReefBot alarm logs."""

    _attr_translation_key = "alarm_logs"
    _attr_icon = "mdi:alert-clock-outline"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "alarm_logs")

    @property
    def native_value(self) -> int:
        """Return alarm log count."""
        return len(self.coordinator.data.alarm_logs)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return alarm log details."""
        return {
            "logs": [
                _alarm_log_summary(log)
                for log in self.coordinator.data.alarm_logs[:10]
                if isinstance(log, dict)
            ],
        }


class ReefBotCalibrationPendingSensor(ReefBotEntity, SensorEntity):
    """Pending calibration request count."""

    _attr_translation_key = "pending_calibrations"
    _attr_icon = "mdi:tune-variant"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "pending_calibrations")

    @property
    def native_value(self) -> int:
        """Return pending calibration request count."""
        return len(self.coordinator.data.pending_calibration_requests)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return pending calibration request details."""
        return {
            "pending_calibrations": [
                _calibration_request_summary(request)
                for request in self.coordinator.data.pending_calibration_requests
                if isinstance(request, dict)
            ],
            "size_types_count": len(self.coordinator.data.size_types),
            "components_count": len(self.coordinator.data.components),
        }


class ReefBotMaintenanceComponentSensor(ReefBotEntity, SensorEntity):
    """Maintenance state for one ReefBot component."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:counter"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(
        self,
        coordinator: ReefBotCoordinator,
        component_key: str,
        display_name: str,
        match_terms: tuple[str, ...],
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, f"maintenance_{component_key}")
        self._display_name = display_name
        self._match_terms = match_terms
        self._attr_name = display_name

    @property
    def native_value(self) -> float | str | None:
        """Return current component value."""
        component = self._component()
        if not component:
            return None
        return _coerce_number(
            _first_present(
                component,
                (
                    "CurrentValue",
                    "currentValue",
                    "Current",
                    "current",
                    "CurrentVolume",
                    "currentVolume",
                    "Value",
                    "value",
                ),
            )
        )

    @property
    def native_unit_of_measurement(self) -> str | None:
        """Return component unit."""
        component = self._component()
        if not component:
            return None
        unit = _first_present(
            component, ("Unit", "unit", "UnitName", "unitName", "ValueUnit", "valueUnit")
        )
        return str(unit) if unit is not None else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return component details."""
        component = self._component()
        if not component:
            return {"component_name": self._display_name}

        current = _first_present(
            component,
            (
                "CurrentValue",
                "currentValue",
                "Current",
                "current",
                "CurrentVolume",
                "currentVolume",
                "Value",
                "value",
            ),
        )
        capacity = _first_present(
            component,
            (
                "SizeTypeValue",
                "sizeTypeValue",
                "Capacity",
                "capacity",
                "MaxValue",
                "maxValue",
                "TotalValue",
                "totalValue",
                "OriginalValue",
                "originalValue",
            ),
        )
        unit = self.native_unit_of_measurement
        return {
            "component_name": _component_name(component),
            "component_id": _first_present(
                component,
                ("ComponentId", "componentId", "DeviceComponentId", "deviceComponentId"),
            ),
            "current_value": current,
            "capacity": capacity,
            "fill_percentage": _fill_percentage(current, capacity),
            "display_value": _component_display_value(current, capacity, unit),
            "unit": unit,
            "size_type": _first_present(
                component, ("SizeTypeName", "sizeTypeName", "SizeType", "sizeType")
            ),
        }

    def _component(self) -> dict[str, Any] | None:
        """Return matching component setting."""
        for component in self.coordinator.data.component_settings:
            name = _component_name(component)
            if not name:
                continue
            normalized = slugify(name).replace("_", " ")
            if any(term in normalized for term in self._match_terms):
                return component
        return None


class ReefBotTubeSensor(ReefBotEntity, SensorEntity):
    """Configured chemical and fill level for one ReefBot tube."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:test-tube"

    def __init__(self, coordinator: ReefBotCoordinator, tube_number: int) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, f"tube_{tube_number}")
        self._tube_number = tube_number

    @property
    def name(self) -> str:
        """Return a tube name that includes the configured chemical."""
        tube = self._tube()
        chemical = _first_present(
            tube, ("ChemicalDisplayName", "chemicalDisplayName")
        )
        if chemical:
            return f"Tube {self._tube_number}: {chemical}"
        return f"Tube {self._tube_number}"

    @property
    def native_value(self) -> float | str | None:
        """Return current tube volume."""
        tube = self._tube()
        if not tube:
            return None
        return _coerce_number(_first_present(tube, ("CurrentValue", "currentValue")))

    @property
    def native_unit_of_measurement(self) -> str | None:
        """Return the tube volume unit."""
        tube = self._tube()
        if not tube:
            return None
        unit = _first_present(tube, ("Unit", "unit"))
        return str(unit) if unit is not None else None

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
        fill_percentage = _fill_percentage(current, capacity)
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
            "fill_percentage": fill_percentage,
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


class ReefBotAvailableChemicalsSensor(ReefBotEntity, SensorEntity):
    """Diagnostic catalog of assignable chemicals (for the config editor)."""

    _attr_icon = "mdi:format-list-bulleted"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the catalog sensor."""
        super().__init__(coordinator, "available_chemicals")
        self._attr_name = "Available chemicals"

    @property
    def native_value(self) -> int:
        """Return the number of assignable chemicals."""
        return len(self._catalog())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the chemical catalog as id/name pairs."""
        return {"chemicals": self._catalog()}

    def _catalog(self) -> list[dict[str, str]]:
        items: list[dict[str, str]] = []
        seen: set[str] = set()
        for chemical in self.coordinator.data.available_chemicals or []:
            chemical_id = _first_present(
                chemical,
                (
                    "ChemicalId",
                    "chemicalId",
                    "AvailableChemicalId",
                    "availableChemicalId",
                    "Id",
                    "id",
                ),
            )
            name = _first_present(
                chemical,
                (
                    "ChemicalName",
                    "chemicalName",
                    "AvailableChemicalName",
                    "availableChemicalName",
                    "ChemicalDisplayName",
                    "chemicalDisplayName",
                    "Name",
                    "name",
                    "DisplayName",
                    "displayName",
                ),
            )
            if chemical_id is None or name is None:
                continue
            key = str(chemical_id)
            if key in seen:
                continue
            seen.add(key)
            items.append({"id": key, "name": str(name)})
        return items


class ReefBotAvailableOperationsSensor(ReefBotEntity, SensorEntity):
    """Diagnostic catalog of available tests + their reagents (config editor).

    Feeds the panel's kit-based "Configure tests" editor: each entry carries the
    operation id, name, parameter and the reagents (id + name) it needs.
    """

    _attr_icon = "mdi:beaker-check-outline"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ReefBotCoordinator) -> None:
        """Initialize the operations catalog sensor."""
        super().__init__(coordinator, "available_operations")
        self._attr_name = "Available operations"

    @property
    def native_value(self) -> int:
        """Return the number of available operations with reagents."""
        return len(self._operations())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the operations catalog for the config editor."""
        return {"operations": self._operations()}

    def _operations(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for operation in self.coordinator.data.available_operations or []:
            related = _first_present(
                operation, ("RelatedChemicals", "relatedChemicals")
            )
            if not isinstance(related, list):
                continue
            reagents: list[dict[str, str]] = []
            for chemical in related:
                if not isinstance(chemical, dict):
                    continue
                reagent_id = _first_present(
                    chemical,
                    (
                        "AvailableChemicalId",
                        "availableChemicalId",
                        "ChemicalId",
                        "chemicalId",
                    ),
                )
                if reagent_id is None:
                    continue
                reagent_name = _first_present(
                    chemical,
                    (
                        "ChemicalName",
                        "chemicalName",
                        "AvailableChemicalName",
                        "availableChemicalName",
                        "ChemicalDisplayName",
                        "chemicalDisplayName",
                        "Name",
                        "name",
                        "DisplayName",
                        "displayName",
                    ),
                )
                reagents.append(
                    {
                        "id": str(reagent_id),
                        "name": str(reagent_name)
                        if reagent_name is not None
                        else str(reagent_id),
                    }
                )
            if not reagents:
                continue
            operation_id = _first_present(
                operation,
                ("AvailableOperationId", "availableOperationId", "Id", "id"),
            )
            name = _first_present(
                operation, ("DisplayName", "displayName", "Name", "name")
            )
            if operation_id is None or name is None:
                continue
            out.append(
                {
                    "id": str(operation_id),
                    "name": str(name),
                    "parameter": _first_present(
                        operation,
                        (
                            "OperationParameterName",
                            "operationParameterName",
                            "ParameterName",
                            "parameterName",
                        ),
                    ),
                    "reagents": reagents,
                }
            )
        return out


class ReefBotConfiguredTestSensor(ReefBotEntity, SensorEntity):
    """A single configured ReefBot test based on installed chemicals."""

    _attr_icon = "mdi:flask-outline"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(
        self, coordinator: ReefBotCoordinator, operation: dict[str, Any]
    ) -> None:
        """Initialize the sensor."""
        operation_id = _first_present(
            operation, ("AvailableOperationId", "availableOperationId")
        )
        super().__init__(coordinator, f"configured_test_{operation_id}")
        self._operation_id = str(operation_id)
        display_name = _first_present(operation, ("DisplayName", "displayName"))
        self._attr_suggested_object_id = (
            f"reefbot_test_{slugify(str(display_name or operation_id))}"
        )

    @property
    def name(self) -> str:
        """Return the configured test display name."""
        operation = self._operation()
        return str(
            _first_present(operation, ("DisplayName", "displayName"))
            or f"Configured test {self._operation_id}"
        )

    @property
    def native_value(self) -> str | None:
        """Return the parameter measured by the configured test."""
        operation = self._operation()
        value = _first_present(
            operation, ("OperationParameterName", "operationParameterName")
        )
        return str(value) if value is not None else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return configured test details."""
        operation = self._operation()
        if not operation:
            return {"available_operation_id": self._operation_id}

        tubes_by_chemical_id = _tubes_by_chemical_id(self.coordinator.data.tubes)
        summary = _configured_operation_summary(operation, tubes_by_chemical_id)
        latest = _latest_device_result_for_operation(
            self.coordinator.data.device_results,
            _first_present(operation, ("AvailableOperationName", "availableOperationName")),
        )
        if latest:
            summary["latest_result"] = _device_result_summary(latest)
        return summary

    def _operation(self) -> dict[str, Any] | None:
        """Return the current operation data for this test."""
        for operation in self.coordinator.data.configured_operations:
            operation_id = _first_present(
                operation, ("AvailableOperationId", "availableOperationId")
            )
            if str(operation_id) == self._operation_id:
                return operation
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


def _operation_request_summary(
    item: dict[str, Any], coordinator: ReefBotCoordinator
) -> dict[str, Any]:
    """Return a compact operation request summary."""
    type_id = _first_present(item, ("Type", "type", "TypeId", "typeId"))
    return {
        "operation_request_id": _first_present(
            item, ("OperationRequestId", "operationRequestId")
        ),
        "name": _first_present(item, ("Name", "name")),
        "device_name": _first_present(item, ("DeviceName", "deviceName")),
        "added": _first_present(item, ("AddedDateString", "addedDateString")),
        "expected_completion_time": _first_present(
            item, ("ExpectedCompletionTime", "expectedCompletionTime")
        ),
        "request_status": _first_present(item, ("RequestStatus", "requestStatus")),
        "request_status_message": _first_present(
            item, ("RequestStatusMessage", "requestStatusMessage")
        ),
        "value": _first_present(item, ("Value", "value")),
        "display_value": _first_present(
            item, ("ValueDisplayString", "valueDisplayString")
        ),
        "solution_name": _first_present(item, ("SolutionName", "solutionName")),
        "volume": _first_present(item, ("Volume", "volume")),
        "type": type_id,
        "type_name": coordinator.data.operation_type_name(type_id),
    }


TEST_DURATIONS_MINUTES: tuple[tuple[tuple[str, ...], int], ...] = (
    (("RedSea Alkalinity", "RedSea Alkalinity Pro", "Red Sea Alkalinity Pro"), 26),
    (("RedSea Phosphate Pro Low Range", "RedSea PO4 Pro Low Range", "RedSea PO4 Pro Low Range 13 drops"), 57),
    (("RedSea Phosphate Pro High Range", "RedSea PO4 Pro High Range"), 57),
    (("RedSea Calcium",), 37),
    (("RedSea Magnesium",), 59),
    (("Fauna Marin AquaHome Nitrate", "Fauna Marin NO3", "FaunaMarin NO3"), 50),
    (("Fauna Marin AquaHome Nitrite", "Fauna Marin AquaHome NO2", "FaunaMarin NO2"), 50),
    (("Fauna Marin Aquahome Phospate", "Fauna Marin AquaHome Phosphate"), 45),
    (("Fauna Marin KH",), 37),
    (("Colombo phosphate", "Colombo PO4", "Colombo PO4 Saltwater"), 55),
    (("Colombo KH Aquatest",), 37),
    (("Colombo Magnesium",), 59),
    (("Colombo Ammonia",), 59),
    (("Colombo pH fresh",), 20),
    (("Colombo GH",), 15),
    (("Colombo Iron",), 60),
    (("Colombo Silicate",), 45),
    (("Colombo Nitrite",), 59),
    (("API Alkalinity",), 24),
    (("API Calcium",), 36),
    (("API Nitrate",), 49),
    (("API Nitrite",), 32),
    (("API Phosphate",), 45),
    (("API Ammonia",), 38),
    (("API GH",), 21),
    (("API Copper",), 40),
    (("API pH Fresh",), 22),
    (("API High Range pH",), 24),
    (("Tropic Marin Nitrate Pro",), 59),
    (("Tropic Marin Nitrite Pro",), 59),
    (("Tropic Marin Phosphate Pro",), 41),
    (("Tropic Marin KH",), 45),
    (("Tropic Marin KH Pro",), 37),
    (("Tropic Marin GH",), 45),
    (("Tropic Marin pH fresh",), 24),
    (("Tropic Marin pH salt",), 24),
    (("Salifert alkalinity",), 35),
    (("Salifert Calcium",), 59),
    (("Salifert Ammonia",), 48),
    (("Salifert GH",), 24),
    (("Salifert pH",), 24),
    (("Giesemann Phosphate",), 49),
    (("Giesemann Magnesium",), 59),
    (("Giesemann Alkalinity",), 48),
    (("Giesemann Ammonia",), 59),
    (("Giesmann Nitrite",), 20),
    (("Giesmann Iron",), 40),
    (("Giesmann Ammonium",), 60),
    (("Giesemann Aquaristic Iodine", "Giesemann Aquaristic lodine"), 45),
    (("Elos KH Wateranalysis",), 24),
    (("Elos Cu Wateranalysis",), 37),
    (("Elos Phosphate",), 35),
    (("Elos Ammonium",), 52),
    (("Elos pH",), 20),
    (("Elos GH",), 20),
    (("Elos Iron",), 40),
    (("Elos NO2 wateranalysis",), 24),
    (("NTLABS Phosphate Fresh",), 24),
    (("NTLABS Phosphate Marine",), 59),
    (("NTLABS Nitrate",), 48),
    (("NTLABS Calcium",), 48),
    (("NTLABS Ammonia",), 50),
    (("NTLABS Nitrite",), 25),
    (("NTLABS Marine Alkalinity",), 24),
    (("NTLABS Alkalinity",), 36),
    (("NTLABS pH Marine",), 24),
    (("NTLABS pH Freshwater",), 24),
    (("NTLABS General Hardness",), 37),
    (("Aquaforest Alkalinity",), 41),
    (("JBL Alkalinity",), 37),
    (("JBL General Hardness",), 20),
    (("JBL Silicate",), 45),
    (("JBL Carbon dioxide",), 37),
    (("JBL Iron",), 37),
    (("JBL pH",), 37),
    (("H2Ocean Magnesium",), 59),
    (("H2Ocean Alkalinity",), 27),
    (("Monitor Calcium Saltwater",), 37),
    (("Monitor Calcium Freshwater",), 37),
    (("Monitor Alkalinity Reef",), 35),
    (("Monitor Total Alkalinity",), 35),
    (("Monitor Ammonia",), 37),
)


def _current_test_timing(coordinator: ReefBotCoordinator) -> dict[str, Any] | None:
    """Return calculated timing information for the current test operation."""
    request = coordinator.data.current_operation_request
    if not request:
        return None

    name = _first_present(request, ("Name", "name"))
    if not name:
        return None
    duration_minutes = _duration_for_test(str(name))
    if duration_minutes is None:
        return None

    started_at = _parse_datetime(
        _first_present(
            request,
            (
                "AddedDateString",
                "addedDateString",
                "Added",
                "added",
                "Date",
                "date",
            ),
        )
    )
    expected_at = _parse_datetime(
        _first_present(
            request,
            (
                "ExpectedCompletionTime",
                "expectedCompletionTime",
                "ExpectedCompletionDateString",
                "expectedCompletionDateString",
            ),
        )
    )
    if started_at is None and expected_at is not None:
        started_at = expected_at - timedelta(minutes=duration_minutes)
    if started_at is None:
        return None

    now = datetime.now(UTC)
    duration = timedelta(minutes=duration_minutes)
    elapsed = max(timedelta(), now - started_at)
    remaining = max(timedelta(), duration - elapsed)
    progress = min(100, round(elapsed / duration * 100))
    return {
        "name": str(name),
        "started_at": started_at.isoformat(),
        "expected_at": expected_at.isoformat()
        if expected_at
        else (started_at + duration).isoformat(),
        "duration_minutes": duration_minutes,
        "elapsed_minutes": min(duration_minutes, int(elapsed.total_seconds() // 60)),
        "remaining_minutes": int((remaining.total_seconds() + 59) // 60),
        "progress": progress,
    }


def _duration_for_test(name: str) -> int | None:
    """Return configured test duration in minutes."""
    keys = [_normalize(value) for value in _search_aliases(name)]
    best_score = 0
    best_duration: int | None = None
    for names, duration in TEST_DURATIONS_MINUTES:
        score = max(_match_score(keys, candidate) for candidate in names)
        if score > best_score:
            best_score = score
            best_duration = duration
    return best_duration if best_score > 0 else None


def _match_score(keys: list[str], candidate: str) -> int:
    """Score a candidate duration name against operation aliases."""
    values = [_normalize(value) for value in _search_aliases(candidate)]
    score = 0
    for key in keys:
        for value in values:
            if not key or not value:
                continue
            if key == value:
                score = max(score, 1000 + len(value))
            if value in key:
                score = max(score, 500 + len(value))
            if key in value:
                score = max(score, 250 + len(key))
    return score


def _search_aliases(value: str) -> list[str]:
    """Return common aliases used by the ReefBot dashboard."""
    text = str(value or "").lower()
    aliases = [text]
    if "nitrate" in text or "no3" in text:
        aliases.extend(("no3", "nitrate"))
    if "nitrite" in text or "no2" in text:
        aliases.extend(("no2", "nitrite"))
    if "phosphate" in text or "po4" in text:
        aliases.extend(("po4", "phosphate"))
    if "alkalinity" in text or "alk" in text or "kh" in text:
        aliases.extend(("alkalinity", "kh"))
    if "calcium" in text or " ca " in f" {text} ":
        aliases.extend(("calcium", "ca"))
    return aliases


def _normalize(value: str) -> str:
    """Normalize names for duration matching."""
    return slugify(str(value or "")).replace("_", "")


def _notification_summary(item: dict[str, Any]) -> dict[str, Any]:
    """Return a compact notification row."""
    message = _first_present(
        item,
        (
            "Message",
            "message",
            "Body",
            "body",
            "Text",
            "text",
            "Description",
            "description",
            "NotificationMessage",
            "notificationMessage",
        ),
    ) or _compact_string_values(item)
    date = _first_present(
        item,
        (
            "AddedDateString",
            "addedDateString",
            "CreatedDate",
            "createdDate",
            "Date",
            "date",
        ),
    ) or _extract_iso_datetime(message)
    return {
        "id": _first_present(item, ("NotificationId", "notificationId", "Id", "id")),
        "title": _first_present(item, ("Title", "title", "Subject", "subject")),
        "message": message,
        "date": date,
        "read": _first_present(item, ("IsRead", "isRead", "Read", "read")),
        "type": _first_present(
            item, ("NotificationType", "notificationType", "Type", "type")
        ),
    }


def _alarm_summary(item: dict[str, Any]) -> dict[str, Any]:
    """Return a compact safe margin row."""
    return {
        "id": _first_present(item, ("AlarmId", "alarmId", "Id", "id")),
        "parameter": _first_present(
            item,
            (
                "OperationParameterName",
                "operationParameterName",
                "ParameterName",
                "parameterName",
                "Name",
                "name",
            ),
        ),
        "minimum": _first_present(
            item, ("MinValue", "minValue", "Minimum", "minimum", "Min", "min")
        ),
        "maximum": _first_present(
            item, ("MaxValue", "maxValue", "Maximum", "maximum", "Max", "max")
        ),
        "unit": _first_present(
            item, ("ValueSuffixSymbol", "valueSuffixSymbol", "Unit", "unit")
        ),
        "enabled": _first_present(
            item, ("IsEnabled", "isEnabled", "Enabled", "enabled", "IsActive", "isActive")
        ),
    }


def _alarm_log_summary(item: dict[str, Any]) -> dict[str, Any]:
    """Return a compact alarm log row."""
    return {
        "id": _first_present(item, ("AlarmLogId", "alarmLogId", "Id", "id")),
        "parameter": _first_present(
            item,
            (
                "OperationParameterName",
                "operationParameterName",
                "ParameterName",
                "parameterName",
                "Name",
                "name",
            ),
        ),
        "message": _first_present(
            item, ("Message", "message", "Description", "description", "Text", "text")
        )
        or _compact_string_values(item),
        "date": _first_present(
            item, ("AddedDateString", "addedDateString", "Date", "date")
        ),
        "value": _first_present(item, ("Value", "value")),
        "status": _first_present(item, ("Status", "status")),
    }


def _calibration_request_summary(item: dict[str, Any]) -> dict[str, Any]:
    """Return a compact calibration request row."""
    return {
        "id": _first_present(
            item,
            (
                "CalibrationRequestId",
                "calibrationRequestId",
                "OperationRequestId",
                "operationRequestId",
                "Id",
                "id",
            ),
        ),
        "component": _first_present(
            item,
            (
                "ComponentName",
                "componentName",
                "Name",
                "name",
                "DeviceComponentName",
                "deviceComponentName",
            ),
        ),
        "device_name": _first_present(item, ("DeviceName", "deviceName")),
        "added": _first_present(item, ("AddedDateString", "addedDateString")),
        "status": _first_present(
            item, ("RequestStatus", "requestStatus", "Status", "status")
        ),
        "message": _first_present(
            item, ("RequestStatusMessage", "requestStatusMessage", "Message", "message")
        ),
    }


def _component_name(item: dict[str, Any]) -> str | None:
    """Return a component display name from a maintenance setting."""
    value = _first_present(
        item,
        (
            "ComponentName",
            "componentName",
            "DeviceComponentName",
            "deviceComponentName",
            "DisplayName",
            "displayName",
            "Name",
            "name",
        ),
    )
    if value:
        return str(value)

    nested = _first_present(item, ("Component", "component"))
    if isinstance(nested, dict):
        nested_value = _first_present(
            nested,
            (
                "ComponentName",
                "componentName",
                "DisplayName",
                "displayName",
                "Name",
                "name",
            ),
        )
        if nested_value:
            return str(nested_value)
    return None


def _compact_string_values(item: dict[str, Any], limit: int = 4) -> str | None:
    """Return a short fallback text from string values in an API row."""
    values: list[str] = []
    for value in item.values():
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text or len(text) > 240:
            continue
        if text not in values:
            values.append(text)
        if len(values) >= limit:
            break
    return " | ".join(values) if values else None


def _extract_iso_datetime(value: Any) -> str | None:
    """Extract an ISO timestamp embedded in Reef Kinetics notification text."""
    if not isinstance(value, str):
        return None
    match = re.search(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?",
        value,
    )
    return match.group(0) if match else None


def _latest_device_result_for_operation(
    results: list[dict[str, Any]], operation_name: Any
) -> dict[str, Any] | None:
    """Return the latest device result matching an operation name."""
    if not operation_name:
        return None
    operation_text = str(operation_name).strip().lower()
    for result in results:
        result_name = _first_present(result, ("OperationName", "operationName"))
        if result_name and str(result_name).strip().lower() == operation_text:
            return result
    return None


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


def _fill_percentage(current: Any, capacity: Any) -> int | None:
    """Return current volume as percentage of capacity."""
    current_number = _coerce_number(current)
    capacity_number = _coerce_number(capacity)
    if not isinstance(current_number, int | float) or not isinstance(
        capacity_number, int | float
    ):
        return None
    if capacity_number <= 0:
        return None
    return round(current_number / capacity_number * 100)


def _component_display_value(current: Any, capacity: Any, unit: str | None) -> str | None:
    """Return a compact current/capacity display string."""
    if current in (None, ""):
        return None
    current_text = _format_number(current)
    capacity_text = _format_number(capacity)
    unit_text = unit or ""
    if capacity_text is None:
        return f"{current_text} {unit_text}".strip()
    return f"{current_text}/{capacity_text} {unit_text}".strip()


def _format_number(value: Any) -> str | None:
    """Return a number without unnecessary trailing zeroes."""
    number = _coerce_number(value)
    if number is None:
        return None
    if not isinstance(number, int | float):
        return str(number)
    if float(number).is_integer():
        return str(int(number))
    return str(number).rstrip("0").rstrip(".")


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
        lambda raw: datetime.strptime(raw, "%b %d, %Y %I:%M %p"),
        lambda raw: datetime.strptime(raw, "%b %d, %I:%M %p").replace(
            year=datetime.now(UTC).year
        ),
        lambda raw: datetime.strptime(raw, "%Y-%m-%d %H:%M"),
        lambda raw: datetime.strptime(raw, "%Y-%m-%d %H:%M:%S"),
    ):
        try:
            parsed = parser(text)
        except ValueError:
            continue
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None
