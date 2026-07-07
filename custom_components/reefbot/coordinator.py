"""Data coordinator for Reef Kinetics ReefBot."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
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

    @property
    def device(self) -> dict[str, Any] | None:
        """Return the configured device, or the first device."""
        return self.devices[0] if self.devices else None

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
        )

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
