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
