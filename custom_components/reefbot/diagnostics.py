"""Diagnostics support for Reef Kinetics ReefBot."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, SENSITIVE_KEYS
from .coordinator import ReefBotCoordinator


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """Return diagnostics for a config entry."""
    coordinator: ReefBotCoordinator | None = hass.data.get(DOMAIN, {}).get(
        entry.entry_id
    )
    data = coordinator.data if coordinator else None

    return {
        "entry": {
            "title": entry.title,
            "data": _redact(entry.data),
            "options": _redact(entry.options),
        },
        "device": _redact(data.device if data else None),
        "tank": _redact(data.tank if data else None),
        "parameters": [
            {
                "name": parameter.get(
                    "OperationParameterName",
                    parameter.get("operationParameterName", parameter.get("name")),
                ),
                "history_count": len(
                    parameter.get(
                        "OperationsHistory",
                        parameter.get("operationsHistory", []),
                    )
                    or []
                ),
            }
            for parameter in (data.parameters if data else [])
        ],
        "tubes": [
            {
                "tube_number": _tube_number(tube),
                "chemical_display_name": tube.get("ChemicalDisplayName"),
                "current_value": tube.get("CurrentValue"),
                "capacity": tube.get("SizeTypeValue") or tube.get("CustomVolume"),
                "unit": tube.get("Unit"),
            }
            for tube in (data.tubes if data else [])
        ],
        "configured_tests": [
            {
                "display_name": operation.get("DisplayName"),
                "operation_parameter_name": operation.get("OperationParameterName"),
                "related_chemicals_count": len(
                    operation.get("RelatedChemicals") or []
                ),
            }
            for operation in (data.configured_operations if data else [])
        ],
        "available_operations_count": (
            len(data.available_operations) if data else 0
        ),
        "pending_operation_requests": [
            _operation_request_summary(request)
            for request in (data.pending_operation_requests if data else [])
        ],
        "operation_request_history": [
            _operation_request_summary(request)
            for request in (data.operation_request_history[:10] if data else [])
        ],
        "component_settings": [
            _component_summary(component)
            for component in (data.component_settings if data else [])
        ],
        "pending_calibration_requests": [
            _calibration_request_summary(request)
            for request in (data.pending_calibration_requests if data else [])
        ],
        "size_types_count": len(data.size_types) if data else 0,
        "components_count": len(data.components) if data else 0,
        "tank_alarms": [
            _alarm_summary(alarm)
            for alarm in (data.tank_alarms if data else [])
        ],
        "alarm_logs": [
            _alarm_log_summary(log)
            for log in (data.alarm_logs[:10] if data else [])
        ],
        "notifications": [
            _notification_summary(notification)
            for notification in (data.notifications[:10] if data else [])
        ],
        "unread_notifications_count": (
            data.unread_notifications_count if data else None
        ),
        "operation_types": _redact(data.operation_types if data else []),
        "last_update_success": coordinator.last_update_success if coordinator else None,
        "last_update_success_time": (
            coordinator.last_successful_refresh.isoformat()
            if coordinator and coordinator.last_successful_refresh
            else None
        ),
    }


def _redact(value: Any) -> Any:
    """Recursively redact sensitive diagnostic fields."""
    if isinstance(value, dict):
        return {
            key: "**REDACTED**" if str(key) in SENSITIVE_KEYS else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def _tube_number(tube: dict[str, Any]) -> int | None:
    """Return the one-based tube number from a chemical setting."""
    try:
        return int(tube.get("PositionIndex")) + 1
    except (TypeError, ValueError):
        return None


def _operation_request_summary(request: dict[str, Any]) -> dict[str, Any]:
    """Return a compact operation request diagnostic row."""
    return {
        "operation_request_id": request.get("OperationRequestId"),
        "name": request.get("Name"),
        "device_name": request.get("DeviceName"),
        "added": request.get("AddedDateString"),
        "expected_completion_time": request.get("ExpectedCompletionTime"),
        "request_status": request.get("RequestStatus"),
        "request_status_message": request.get("RequestStatusMessage"),
        "value": request.get("Value"),
        "display_value": request.get("ValueDisplayString"),
        "type": request.get("Type"),
    }


def _component_summary(component: dict[str, Any]) -> dict[str, Any]:
    """Return a compact maintenance component diagnostic row."""
    return {
        "component_id": _first_present(
            component,
            ("ComponentId", "componentId", "DeviceComponentId", "deviceComponentId"),
        ),
        "name": _component_name(component),
        "current_value": _first_present(
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
        ),
        "capacity": _first_present(
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
            ),
        ),
        "unit": _first_present(
            component, ("Unit", "unit", "UnitName", "unitName", "ValueUnit", "valueUnit")
        ),
    }


def _calibration_request_summary(request: dict[str, Any]) -> dict[str, Any]:
    """Return a compact calibration request diagnostic row."""
    return {
        "id": _first_present(
            request,
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
            request,
            (
                "ComponentName",
                "componentName",
                "DeviceComponentName",
                "deviceComponentName",
                "Name",
                "name",
            ),
        ),
        "device_name": _first_present(request, ("DeviceName", "deviceName")),
        "added": _first_present(request, ("AddedDateString", "addedDateString")),
        "status": _first_present(
            request, ("RequestStatus", "requestStatus", "Status", "status")
        ),
        "message": _first_present(
            request,
            ("RequestStatusMessage", "requestStatusMessage", "Message", "message"),
        ),
    }


def _alarm_summary(alarm: dict[str, Any]) -> dict[str, Any]:
    """Return a compact tank alarm diagnostic row."""
    return {
        "id": _first_present(alarm, ("AlarmId", "alarmId", "Id", "id")),
        "parameter": _first_present(
            alarm,
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
            alarm, ("MinValue", "minValue", "Minimum", "minimum", "Min", "min")
        ),
        "maximum": _first_present(
            alarm, ("MaxValue", "maxValue", "Maximum", "maximum", "Max", "max")
        ),
        "enabled": _first_present(
            alarm,
            ("IsEnabled", "isEnabled", "Enabled", "enabled", "IsActive", "isActive"),
        ),
    }


def _alarm_log_summary(log: dict[str, Any]) -> dict[str, Any]:
    """Return a compact alarm log diagnostic row."""
    return {
        "id": _first_present(log, ("AlarmLogId", "alarmLogId", "Id", "id")),
        "parameter": _first_present(
            log,
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
            log, ("Message", "message", "Description", "description", "Text", "text")
        ),
        "date": _first_present(log, ("AddedDateString", "addedDateString", "Date", "date")),
        "value": _first_present(log, ("Value", "value")),
        "status": _first_present(log, ("Status", "status")),
    }


def _notification_summary(notification: dict[str, Any]) -> dict[str, Any]:
    """Return a compact notification diagnostic row."""
    return {
        "id": _first_present(
            notification, ("NotificationId", "notificationId", "Id", "id")
        ),
        "title": _first_present(notification, ("Title", "title", "Subject", "subject")),
        "message": _first_present(
            notification,
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
        ),
        "date": _first_present(
            notification,
            (
                "AddedDateString",
                "addedDateString",
                "CreatedDate",
                "createdDate",
                "Date",
                "date",
            ),
        ),
        "read": _first_present(notification, ("IsRead", "isRead", "Read", "read")),
        "type": _first_present(
            notification, ("NotificationType", "notificationType", "Type", "type")
        ),
    }


def _component_name(component: dict[str, Any]) -> str | None:
    """Return a component display name."""
    value = _first_present(
        component,
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

    nested = _first_present(component, ("Component", "component"))
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


def _first_present(data: dict[str, Any] | None, keys: tuple[str, ...]) -> Any:
    """Return the first present value from a dict."""
    if not data:
        return None
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None
