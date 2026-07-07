"""Config flow for Reef Kinetics ReefBot."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import (
    ReefBotApiClient,
    ReefBotAuthError,
    ReefBotCannotConnect,
    ReefBotResponseError,
)
from .const import (
    CONF_DEVICE_ID,
    CONF_DEVICE_TOKEN,
    CONF_PASSWORD,
    CONF_TANK_ID,
    CONF_TANK_NAME,
    CONF_TOKEN,
    CONF_TOKEN_EXPIRY,
    CONF_USERNAME,
    CONF_USER_ID,
    DOMAIN,
)


async def validate_input(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """Validate credentials and discover ReefBot devices and tanks."""
    session = async_get_clientsession(hass)
    client = ReefBotApiClient(session, data)
    if CONF_USERNAME in data and CONF_PASSWORD in data:
        login = await client.login(data[CONF_USERNAME], data[CONF_PASSWORD])
        data[CONF_TOKEN] = login.token
        data[CONF_TOKEN_EXPIRY] = login.token_expiry
        data[CONF_USER_ID] = login.user_id
        client = ReefBotApiClient(session, data)

    devices = await client.get_user_devices()
    tanks = await client.get_user_tanks()

    if not devices:
        raise NoDevicesFound
    if not tanks:
        raise NoTanksFound

    return {"devices": devices, "tanks": tanks}


async def refresh_login(hass: HomeAssistant, data: dict[str, Any]) -> None:
    """Refresh login token fields in a config entry data dict."""
    client = ReefBotApiClient(async_get_clientsession(hass), data)
    login = await client.login(data[CONF_USERNAME], data[CONF_PASSWORD])
    data[CONF_TOKEN] = login.token
    data[CONF_TOKEN_EXPIRY] = login.token_expiry
    data[CONF_USER_ID] = login.user_id


class ReefBotConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Reef Kinetics ReefBot."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the config flow."""
        self._user_data: dict[str, Any] = {}
        self._devices: list[dict[str, Any]] = []
        self._tanks: list[dict[str, Any]] = []
        self._reauth_entry: config_entries.ConfigEntry | None = None

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Handle the initial setup step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            data = {
                CONF_USERNAME: user_input[CONF_USERNAME].strip(),
                CONF_PASSWORD: user_input[CONF_PASSWORD],
                CONF_DEVICE_TOKEN: _generate_device_token(),
            }

            try:
                info = await validate_input(self.hass, data)
            except ReefBotAuthError:
                errors["base"] = "invalid_auth"
            except ReefBotCannotConnect:
                errors["base"] = "cannot_connect"
            except ReefBotResponseError:
                errors["base"] = "invalid_response"
            except NoDevicesFound:
                errors["base"] = "no_devices"
            except NoTanksFound:
                errors["base"] = "no_tanks"
            except Exception:
                errors["base"] = "unknown"
            else:
                data.pop(CONF_PASSWORD, None)
                self._user_data = data
                self._devices = info["devices"]
                self._tanks = info["tanks"]
                if len(self._tanks) > 1:
                    return await self.async_step_tank()
                return await self._create_entry(self._tanks[0])

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_USERNAME): str,
                    vol.Required(CONF_PASSWORD): selector.TextSelector(
                        selector.TextSelectorConfig(
                            type=selector.TextSelectorType.PASSWORD
                        )
                    ),
                }
            ),
            errors=errors,
        )

    async def async_step_reauth(
        self, entry_data: dict[str, Any]
    ) -> config_entries.ConfigFlowResult:
        """Handle reauthentication when the token expires."""
        self._reauth_entry = self.hass.config_entries.async_get_entry(
            self.context["entry_id"]
        )
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Ask for the account password and refresh stored token data."""
        errors: dict[str, str] = {}
        if self._reauth_entry is None:
            return self.async_abort(reason="reauth_entry_missing")

        username = self._reauth_entry.data.get(CONF_USERNAME)
        if not username:
            return self.async_abort(reason="reauth_not_supported")

        if user_input is not None:
            data = dict(self._reauth_entry.data)
            data[CONF_PASSWORD] = user_input[CONF_PASSWORD]

            try:
                await refresh_login(self.hass, data)
            except ReefBotAuthError:
                errors["base"] = "invalid_auth"
            except ReefBotCannotConnect:
                errors["base"] = "cannot_connect"
            except ReefBotResponseError:
                errors["base"] = "invalid_response"
            except Exception:
                errors["base"] = "unknown"
            else:
                data.pop(CONF_PASSWORD, None)
                self.hass.config_entries.async_update_entry(
                    self._reauth_entry,
                    data=data,
                )
                await self.hass.config_entries.async_reload(
                    self._reauth_entry.entry_id
                )
                return self.async_abort(reason="reauth_successful")

        return self.async_show_form(
            step_id="reauth_confirm",
            description_placeholders={"username": str(username)},
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_PASSWORD): selector.TextSelector(
                        selector.TextSelectorConfig(
                            type=selector.TextSelectorType.PASSWORD
                        )
                    )
                }
            ),
            errors=errors,
        )

    async def async_step_tank(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Handle tank selection when the account has multiple tanks."""
        errors: dict[str, str] = {}

        if user_input is not None:
            tank_id = str(user_input[CONF_TANK_ID])
            selected = next(
                (
                    tank
                    for tank in self._tanks
                    if str(_first_present(tank, ("TankId", "tankId", "id"))) == tank_id
                ),
                None,
            )
            if selected is None:
                errors[CONF_TANK_ID] = "invalid_tank"
            else:
                return await self._create_entry(selected)

        return self.async_show_form(
            step_id="tank",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_TANK_ID): vol.In(
                        {
                            str(_first_present(tank, ("TankId", "tankId", "id"))): (
                                _tank_label(tank)
                            )
                            for tank in self._tanks
                        }
                    )
                }
            ),
            errors=errors,
        )

    async def _create_entry(
        self, tank: dict[str, Any]
    ) -> config_entries.ConfigFlowResult:
        """Create a config entry for the selected tank."""
        device = self._devices[0]
        tank_id = _first_present(tank, ("TankId", "tankId", "id"))
        device_id = _first_present(device, ("DeviceId", "deviceId", "id"))
        serial = _first_present(device, ("SerialNumber", "serialNumber", "serial"))
        tank_name = _first_present(tank, ("Name", "name")) or "ReefBot tank"
        device_name = _first_present(device, ("Name", "name")) or "ReefBot"

        unique_id = str(serial or device_id or tank_id)
        if tank_id is not None:
            unique_id = f"{unique_id}:{tank_id}"

        await self.async_set_unique_id(unique_id)
        self._abort_if_unique_id_configured()

        data = dict(self._user_data)
        if tank_id is not None:
            data[CONF_TANK_ID] = tank_id
            data[CONF_TANK_NAME] = tank_name
        if device_id is not None:
            data[CONF_DEVICE_ID] = device_id

        return self.async_create_entry(title=f"{device_name} ({tank_name})", data=data)


def _first_present(data: dict[str, Any], keys: tuple[str, ...]) -> Any:
    """Return the first present value from a dict."""
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None


def _tank_label(tank: dict[str, Any]) -> str:
    """Return a human readable tank label."""
    name = _first_present(tank, ("Name", "name")) or "Unnamed tank"
    tank_id = _first_present(tank, ("TankId", "tankId", "id"))
    return f"{name} ({tank_id})" if tank_id is not None else str(name)


def _generate_device_token() -> str:
    """Generate a stable-looking web device token for Reef Kinetics."""
    return f"DEVICETOKEN-WEB-{uuid4()}"


class NoDevicesFound(HomeAssistantError):
    """No ReefBot devices were returned."""


class NoTanksFound(HomeAssistantError):
    """No ReefBot tanks were returned."""
