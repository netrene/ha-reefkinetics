"""Data coordinator for Reef Kinetics ReefBot."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import slugify

from .api import ReefBotApiClient, ReefBotApiError, ReefBotAuthError
from .const import (
    CONF_DEVICE_ID,
    CONF_TOKEN_EXPIRY,
    CONF_TANK_ID,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    EXCLUDED_PARAMETER_NAMES,
)

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class ReefBotData:
    """Latest ReefBot cloud data."""

    devices: list[dict[str, Any]]
    tanks: list[dict[str, Any]]
    results: dict[str, Any]
    parameter_results: dict[str, list[dict[str, Any]]]
    chemicals: list[dict[str, Any]]
    available_chemicals: list[dict[str, Any]]
    available_operations: list[dict[str, Any]]
    source_settings: list[dict[str, Any]]
    device_results: list[dict[str, Any]]
    pending_operation_requests: list[dict[str, Any]]
    operation_request_history: list[dict[str, Any]]
    operation_types: list[dict[str, Any]]
    component_settings: list[dict[str, Any]]
    pending_calibration_requests: list[dict[str, Any]]
    size_types: list[dict[str, Any]]
    components: list[dict[str, Any]]
    tank_alarms: list[dict[str, Any]]
    alarm_logs: list[dict[str, Any]]
    notifications: list[dict[str, Any]]
    unread_notifications_count: int | None

    @property
    def device(self) -> dict[str, Any] | None:
        """Return the configured device, or the first device."""
        return self.devices[0] if self.devices else None

    @property
    def vial_count(self) -> int:
        """Number of reagent vials/tubes (8 = ReefBot V2, 12 = ReefBot Lab).

        Read from the device payload's ``VialsNumber`` (confirmed present on the
        V2, where it reads 8). Falls back to 8 when absent/unparseable and is
        clamped to 8..16 so a bogus value can neither remove the eight V2 tube
        sensors nor spawn a runaway number of entities.
        """
        device = self.device or {}
        raw: Any = None
        for key in ("VialsNumber", "vialsNumber", "VialCount", "vialCount"):
            value = device.get(key)
            if value not in (None, ""):
                raw = value
                break
        try:
            count = int(float(raw))
        except (TypeError, ValueError):
            return 8
        if count < 1:
            return 8
        return max(8, min(16, count))

    @property
    def model_name(self) -> str:
        """Human-readable device model.

        Inferred from the (reliable) vial count rather than an unconfirmed
        payload model string, so the V2 label stays exactly "ReefBot V2".
        """
        return "ReefBot Lab" if self.vial_count >= 9 else "ReefBot V2"

    @property
    def tank(self) -> dict[str, Any] | None:
        """Return the configured tank, or the first tank."""
        return self.tanks[0] if self.tanks else None

    @property
    def parameters(self) -> list[dict[str, Any]]:
        """Return dynamic operation parameters."""
        data = self.results.get("Data", self.results.get("data", {}))
        if not isinstance(data, dict):
            return []
        parameters = data.get("Parameters", data.get("parameters", []))
        if not isinstance(parameters, list):
            return []
        return [item for item in parameters if isinstance(item, dict)]

    def history_for_parameter(
        self, parameter: dict[str, Any]
    ) -> list[dict[str, Any]]:
        """Return detailed history for a parameter, falling back to dashboard data."""
        parameter_id = _first_present(
            parameter, ("OperationParameterId", "operationParameterId")
        )
        if parameter_id is not None:
            history = self.parameter_results.get(str(parameter_id))
            if history is not None:
                return history

        history = _first_present(parameter, ("OperationsHistory", "operationsHistory"))
        if isinstance(history, list):
            return [item for item in history if isinstance(item, dict)]
        return []

    @property
    def tubes(self) -> list[dict[str, Any]]:
        """Return chemical settings ordered by tube position."""
        return sorted(
            self.chemicals,
            key=lambda item: int(
                _first_present(item, ("PositionIndex", "positionIndex")) or 0
            ),
        )

    @property
    def configured_operations(self) -> list[dict[str, Any]]:
        """Return available operations whose required chemicals are installed."""
        chemical_ids = {
            str(chemical_id)
            for chemical in self.chemicals
            if (
                chemical_id := _first_present(
                    chemical, ("ChemicalId", "chemicalId", "AvailableChemicalId")
                )
            )
            is not None
        }
        if not chemical_ids:
            return []

        configured: list[dict[str, Any]] = []
        for operation in self.available_operations:
            related = _first_present(
                operation, ("RelatedChemicals", "relatedChemicals")
            )
            if not isinstance(related, list) or not related:
                continue
            related_ids = {
                str(chemical_id)
                for chemical in related
                if isinstance(chemical, dict)
                and (
                    chemical_id := _first_present(
                        chemical,
                        (
                            "AvailableChemicalId",
                            "availableChemicalId",
                            "ChemicalId",
                            "chemicalId",
                        ),
                    )
                )
                is not None
            }
            if related_ids and related_ids <= chemical_ids:
                configured.append(operation)
        return configured

    @property
    def current_operation_request(self) -> dict[str, Any] | None:
        """Return the first pending operation request, if any."""
        if not self.pending_operation_requests:
            return None
        return self.pending_operation_requests[0]

    def operation_type_name(self, type_id: Any) -> str | None:
        """Return the display name for an operation request type."""
        if type_id is None:
            return None
        type_text = str(type_id)
        for operation_type in self.operation_types:
            candidate = _first_present(
                operation_type, ("TypeId", "typeId", "Id", "id")
            )
            if candidate is not None and str(candidate) == type_text:
                value = _first_present(
                    operation_type, ("TypeName", "typeName", "Name", "name")
                )
                return str(value) if value is not None else None
        return None


class ReefBotCoordinator(DataUpdateCoordinator[ReefBotData]):
    """Coordinate ReefBot cloud polling."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client: ReefBotApiClient,
    ) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=DEFAULT_SCAN_INTERVAL,
        )
        self.entry = entry
        self.client = client
        self.last_successful_refresh: datetime | None = None

    async def _async_update_data(self) -> ReefBotData:
        """Fetch latest ReefBot data."""
        try:
            if _token_expired(self.entry.data.get(CONF_TOKEN_EXPIRY)):
                raise ReefBotAuthError("ReefBot token has expired")
            devices = await self.client.get_user_devices()
            tanks = await self.client.get_user_tanks()
            devices = self._prefer_configured(
                devices,
                CONF_DEVICE_ID,
                ("DeviceId", "deviceId", "id"),
            )
            tanks = self._prefer_configured(
                tanks, CONF_TANK_ID, ("TankId", "tankId", "id")
            )
            tank_id = self.entry.data.get(CONF_TANK_ID)
            if tank_id is None and tanks:
                tank_id = tanks[0].get("TankId", tanks[0].get("tankId"))
            results = await self.client.get_operation_results(tank_id) if tank_id else {}
            parameter_results = (
                await self._async_fetch_parameter_results(results, tank_id)
                if tank_id
                else {}
            )
            device_id = self.entry.data.get(CONF_DEVICE_ID)
            if device_id is None and devices:
                device_id = devices[0].get("DeviceId", devices[0].get("deviceId"))
            chemicals = (
                await self._async_optional_list(
                    self.client.get_device_chemical_settings, device_id
                )
                if device_id
                else []
            )
            available_chemicals = (
                await self._async_optional_list(
                    self.client.get_available_chemicals, device_id
                )
                if device_id
                else []
            )
            available_operations = (
                await self._async_optional_list(
                    self.client.get_available_operations, device_id
                )
                if device_id
                else []
            )
            source_settings = (
                await self._async_optional_list(
                    self.client.get_device_source_settings, device_id
                )
                if device_id
                else []
            )
            device_results = (
                await self._async_optional_list(self.client.get_device_results, device_id)
                if device_id
                else []
            )
            pending_operation_requests = (
                await self._async_optional_list(
                    self.client.get_pending_operation_requests, tank_id
                )
                if tank_id
                else []
            )
            operation_request_history = (
                await self._async_optional_list(
                    self.client.get_operation_request_history, tank_id
                )
                if tank_id
                else []
            )
            operation_types = await self._async_optional_list(
                self.client.get_operation_types
            )
            component_settings = (
                await self._async_optional_list(
                    self.client.get_device_component_settings, device_id
                )
                if device_id
                else []
            )
            pending_calibration_requests = (
                await self._async_optional_list(
                    self.client.get_pending_calibration_requests, device_id
                )
                if device_id
                else []
            )
            size_types = await self._async_optional_list(self.client.get_size_types)
            components = await self._async_optional_list(self.client.get_components)
            tank_alarms = (
                await self._async_optional_list(self.client.get_tank_alarms, tank_id)
                if tank_id
                else []
            )
            alarm_logs = (
                await self._async_optional_list(self.client.get_alarm_logs, tank_id)
                if tank_id
                else []
            )
            notifications = await self._async_optional_list(
                self.client.get_user_notifications
            )
            unread_notifications_count = await self._async_optional_value(
                self.client.get_unread_notifications_count
            )
        except ReefBotAuthError as err:
            raise ConfigEntryAuthFailed("ReefBot authentication failed") from err
        except ReefBotApiError as err:
            raise UpdateFailed(str(err)) from err

        self.last_successful_refresh = datetime.now(UTC)
        return ReefBotData(
            devices=devices,
            tanks=tanks,
            results=results,
            parameter_results=parameter_results,
            chemicals=chemicals,
            available_chemicals=available_chemicals,
            available_operations=available_operations,
            source_settings=source_settings,
            device_results=device_results,
            pending_operation_requests=pending_operation_requests,
            operation_request_history=operation_request_history,
            operation_types=operation_types,
            component_settings=component_settings,
            pending_calibration_requests=pending_calibration_requests,
            size_types=size_types,
            components=components,
            tank_alarms=tank_alarms,
            alarm_logs=alarm_logs,
            notifications=notifications,
            unread_notifications_count=unread_notifications_count,
        )

    async def _async_optional_list(self, method: Any, *args: Any) -> list[dict[str, Any]]:
        """Fetch optional list data without failing the whole coordinator."""
        try:
            return await method(*args)
        except ReefBotApiError:
            _LOGGER.debug("Unable to fetch optional ReefBot data", exc_info=True)
            return []

    async def _async_optional_value(self, method: Any, *args: Any) -> Any:
        """Fetch optional scalar data without failing the whole coordinator."""
        try:
            return await method(*args)
        except ReefBotApiError:
            _LOGGER.debug("Unable to fetch optional ReefBot value", exc_info=True)
            return None

    def _resolve_device_id(self) -> Any:
        """Return the configured ReefBot device id, if known."""
        device_id = self.entry.data.get(CONF_DEVICE_ID)
        if device_id is None and self.data and self.data.device:
            device_id = self.data.device.get(
                "DeviceId", self.data.device.get("deviceId")
            )
        return device_id

    async def async_set_chemical_positions(
        self, positions: list[dict[str, Any]]
    ) -> None:
        """Write the full chemical->tube assignment, then refresh (Gap 1 write)."""
        device_id = self._resolve_device_id()
        if device_id is None:
            raise HomeAssistantError("ReefBot device id is unknown")
        try:
            await self.client.update_chemical_positions(device_id, positions)
        except ReefBotApiError as err:
            raise HomeAssistantError(str(err)) from err
        await self.async_request_refresh()

    async def _async_fetch_parameter_results(
        self, results: dict[str, Any], tank_id: int | str
    ) -> dict[str, list[dict[str, Any]]]:
        """Fetch detailed histories for each parameter returned by the dashboard."""
        data = results.get("Data", results.get("data", {}))
        parameters = data.get("Parameters", []) if isinstance(data, dict) else []
        if not isinstance(parameters, list):
            return {}

        histories: dict[str, list[dict[str, Any]]] = {}
        for parameter in parameters:
            if not isinstance(parameter, dict):
                continue
            name = _first_present(
                parameter,
                (
                    "OperationParameterName",
                    "operationParameterName",
                    "ParameterName",
                    "name",
                ),
            )
            if name and slugify(str(name)) in EXCLUDED_PARAMETER_NAMES:
                continue
            parameter_id = _first_present(
                parameter, ("OperationParameterId", "operationParameterId")
            )
            if parameter_id is None:
                continue
            try:
                histories[str(parameter_id)] = await self.client.get_parameter_results(
                    tank_id, parameter_id
                )
            except ReefBotApiError:
                _LOGGER.debug(
                    "Unable to fetch ReefBot history for parameter %s",
                    parameter_id,
                    exc_info=True,
                )
        return histories

    def _prefer_configured(
        self,
        items: list[dict[str, Any]],
        config_key: str,
        id_keys: tuple[str, ...],
    ) -> list[dict[str, Any]]:
        """Move the configured device or tank to the front of a list."""
        configured_id = self.entry.data.get(config_key)
        if configured_id is None:
            return items

        configured_text = str(configured_id)
        selected = [
            item
            for item in items
            if any(str(item.get(id_key)) == configured_text for id_key in id_keys)
        ]
        others = [item for item in items if item not in selected]
        return selected + others


def _token_expired(value: Any) -> bool:
    """Return whether a stored token expiry is in the past."""
    if not value or not isinstance(value, str):
        return False

    text = value.strip().replace("Z", "+00:00")
    if "." in text:
        prefix, suffix = text.split(".", 1)
        fraction = suffix
        timezone = ""
        for separator in ("+", "-"):
            if separator in suffix:
                fraction, timezone_part = suffix.split(separator, 1)
                timezone = f"{separator}{timezone_part}"
                break
        text = f"{prefix}.{fraction[:6]}{timezone}"

    try:
        expiry = datetime.fromisoformat(text)
    except ValueError:
        return False
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=UTC)
    return expiry <= datetime.now(UTC)


def _first_present(data: dict[str, Any] | None, keys: tuple[str, ...]) -> Any:
    """Return the first present value from a dict."""
    if not data:
        return None
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None
