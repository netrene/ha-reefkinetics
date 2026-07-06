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

from .api import ReefBotApiClient, ReefBotApiError, ReefBotAuthError
from .const import (
    CONF_DEVICE_ID,
    CONF_TANK_ID,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class ReefBotData:
    """Latest ReefBot cloud data."""

    devices: list[dict[str, Any]]
    tanks: list[dict[str, Any]]
    results: dict[str, Any]

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
            devices = await self.client.get_user_devices()
            tanks = await self.client.get_user_tanks()
            devices = self._prefer_configured(
                devices,
                CONF_DEVICE_ID,
                ("DeviceId", "deviceId", "id"),
            )
            tanks = self._prefer_configured(tanks, CONF_TANK_ID, ("TankId", "tankId", "id"))
            tank_id = self.entry.data.get(CONF_TANK_ID)
            if tank_id is None and tanks:
                tank_id = tanks[0].get("TankId", tanks[0].get("tankId"))
            results = await self.client.get_operation_results(tank_id) if tank_id else {}
        except ReefBotAuthError as err:
            raise ConfigEntryAuthFailed("ReefBot authentication failed") from err
        except ReefBotApiError as err:
            raise UpdateFailed(str(err)) from err

        self.last_successful_refresh = datetime.now(UTC)
        return ReefBotData(devices=devices, tanks=tanks, results=results)

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
