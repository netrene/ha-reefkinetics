"""API client for Reef Kinetics ReefBot."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
import logging
from typing import Any

from aiohttp import ClientError, ClientResponseError, ClientSession

from .const import (
    CONF_BASE_URL,
    CONF_DEVICE_PLATFORM,
    CONF_DEVICE_TOKEN,
    CONF_PORTAL_APP_ID,
    CONF_PORTAL_APP_SECRET,
    CONF_PORTAL_ID,
    CONF_TOKEN,
    CONF_USER_ID,
    DEFAULT_BASE_URL,
    DEFAULT_DEVICE_PLATFORM,
    DEFAULT_PORTAL_APP_ID,
    DEFAULT_PORTAL_APP_SECRET,
    DEFAULT_PORTAL_ID,
)

_LOGGER = logging.getLogger(__name__)

ENDPOINT_LOGIN = "/api/auth/AuthorizeAndLoginWithPortal"
ENDPOINT_DEVICES = "/api/APIService/GetUserDevices"
ENDPOINT_TANKS = "/api/APIService/GetUserTanks"
ENDPOINT_RESULTS = "/api/APIService/GetOperationResultsByTankIdWithColorsV2"
ENDPOINT_PARAMETER_RESULTS = (
    "/api/APIService/GetOperationResultsByTankIdOperationParameterIdWithColors"
)
ENDPOINT_CHEMICAL_SETTINGS = "/api/APIService/GetDeviceChemicalSettings"
ENDPOINT_AVAILABLE_OPERATIONS = "/api/APIService/GetAvailableOperations"
ENDPOINT_SOURCE_SETTINGS = "/api/APIService/GetDeviceSourceSettings"
ENDPOINT_DEVICE_RESULTS = "/api/APIService/GetOperationResultsByDeviceIdV2"
ENDPOINT_PENDING_OPERATION_REQUESTS = (
    "/api/APIService/GetPendingOperationRequestsByTank"
)
ENDPOINT_OPERATION_REQUEST_HISTORY = (
    "/api/APIService/GetOperationRequestsHistoryByTankId"
)
ENDPOINT_OPERATION_TYPES = "/api/APIService/GetOperationTypes"
ENDPOINT_ONE_TIME_OPERATION_REQUEST = "/api/APIService/OneTimeOperationRequest"


class ReefBotApiError(Exception):
    """Base ReefBot API error."""


class ReefBotCannotConnect(ReefBotApiError):
    """Raised when the API cannot be reached."""


class ReefBotAuthError(ReefBotApiError):
    """Raised when credentials are rejected."""


class ReefBotResponseError(ReefBotApiError):
    """Raised when the API returns an unexpected response."""


@dataclass(slots=True)
class ReefBotLoginResult:
    """Successful Reef Kinetics login result."""

    token: str
    token_expiry: str | None
    user_id: int


class ReefBotApiClient:
    """Small async client for the Reef Kinetics cloud gateway."""

    def __init__(self, session: ClientSession, config: Mapping[str, Any]) -> None:
        """Initialize the API client."""
        self._session = session
        self._base_url = str(config.get(CONF_BASE_URL, DEFAULT_BASE_URL)).rstrip("/")
        self._token = str(config.get(CONF_TOKEN, ""))
        self._user_id = config.get(CONF_USER_ID)
        self._device_token = str(config[CONF_DEVICE_TOKEN])
        self._portal_app_id = str(
            config.get(CONF_PORTAL_APP_ID, DEFAULT_PORTAL_APP_ID)
        )
        self._portal_app_secret = str(
            config.get(CONF_PORTAL_APP_SECRET, DEFAULT_PORTAL_APP_SECRET)
        )
        self._device_platform = str(
            config.get(CONF_DEVICE_PLATFORM, DEFAULT_DEVICE_PLATFORM)
        )
        self._portal_id = config.get(CONF_PORTAL_ID, DEFAULT_PORTAL_ID)

    async def login(self, username: str, password: str) -> ReefBotLoginResult:
        """Authenticate with Reef Kinetics and return a token."""
        data = await self._post(
            ENDPOINT_LOGIN,
            {
                "PortalUsername": username,
                "PortalPassword": password,
            },
            authenticated=False,
        )
        login_data = data.get("Data", data.get("data"))
        if not isinstance(login_data, dict):
            raise ReefBotResponseError("Reef Kinetics login returned no data")

        token = login_data.get("Token", login_data.get("token"))
        user_id = login_data.get(
            "UserId", login_data.get("UserID", login_data.get("userId"))
        )
        if not token or user_id is None:
            raise ReefBotAuthError("Reef Kinetics login did not return credentials")

        try:
            user_id_int = int(user_id)
        except (TypeError, ValueError) as err:
            raise ReefBotResponseError(
                "Reef Kinetics login returned invalid user ID"
            ) from err

        return ReefBotLoginResult(
            token=str(token),
            token_expiry=login_data.get(
                "TokenExpiry", login_data.get("tokenExpiry")
            ),
            user_id=user_id_int,
        )

    async def get_user_devices(self) -> list[dict[str, Any]]:
        """Return ReefBot devices linked to the user."""
        payload = await self._post(ENDPOINT_DEVICES)
        return self._extract_list(payload, ("Devices", "devices", "UserDevices"))

    async def get_user_tanks(self) -> list[dict[str, Any]]:
        """Return tanks linked to the user."""
        payload = await self._post(ENDPOINT_TANKS)
        return self._extract_list(payload, ("Tanks", "tanks", "UserTanks"))

    async def get_operation_results(self, tank_id: int | str) -> dict[str, Any]:
        """Return latest operation results for a tank."""
        return await self._post(ENDPOINT_RESULTS, {"tankId": tank_id})

    async def get_parameter_results(
        self, tank_id: int | str, operation_parameter_id: int | str
    ) -> list[dict[str, Any]]:
        """Return detailed operation result history for one parameter."""
        payload = await self._post(
            ENDPOINT_PARAMETER_RESULTS,
            {
                "tankId": tank_id,
                "OperationParameterId": operation_parameter_id,
            },
        )
        return self._extract_list(payload, ("Results", "results"))

    async def get_device_chemical_settings(
        self, device_id: int | str
    ) -> list[dict[str, Any]]:
        """Return configured ReefBot vial chemical settings."""
        payload = await self._post(ENDPOINT_CHEMICAL_SETTINGS, {"DeviceId": device_id})
        return self._extract_list(payload, ("Chemicals", "chemicals"))

    async def get_available_operations(
        self, device_id: int | str
    ) -> list[dict[str, Any]]:
        """Return all operations available for a ReefBot device."""
        payload = await self._post(ENDPOINT_AVAILABLE_OPERATIONS, {"DeviceId": device_id})
        return self._extract_list(payload, ("Operations", "operations"))

    async def get_device_source_settings(
        self, device_id: int | str
    ) -> list[dict[str, Any]]:
        """Return configured ReefBot source settings."""
        payload = await self._post(ENDPOINT_SOURCE_SETTINGS, {"DeviceId": device_id})
        return self._extract_list(payload, ("Sources", "sources"))

    async def get_device_results(self, device_id: int | str) -> list[dict[str, Any]]:
        """Return latest operation results for a ReefBot device."""
        payload = await self._post(ENDPOINT_DEVICE_RESULTS, {"DeviceId": device_id})
        return self._extract_list(payload, ("Results", "results"))

    async def get_pending_operation_requests(
        self, tank_id: int | str
    ) -> list[dict[str, Any]]:
        """Return currently pending operation requests for a tank."""
        payload = await self._post(
            ENDPOINT_PENDING_OPERATION_REQUESTS, {"tankId": tank_id}
        )
        return self._extract_list(payload, ("Requests", "requests"))

    async def get_operation_request_history(
        self, tank_id: int | str
    ) -> list[dict[str, Any]]:
        """Return recent operation request history for a tank."""
        payload = await self._post(
            ENDPOINT_OPERATION_REQUEST_HISTORY, {"tankId": tank_id}
        )
        return self._extract_list(
            payload, ("Requests", "requests", "History", "history")
        )

    async def get_operation_types(self) -> list[dict[str, Any]]:
        """Return ReefBot operation request type labels."""
        payload = await self._post(ENDPOINT_OPERATION_TYPES)
        return self._extract_list(payload, ("Types", "types"))

    async def request_one_time_operation(
        self,
        device_id: int | str,
        tank_id: int | str,
        available_operation_id: int | str,
    ) -> None:
        """Request a one-time ReefBot operation."""
        await self._post(
            ENDPOINT_ONE_TIME_OPERATION_REQUEST,
            {
                "DeviceIdArray": [device_id],
                "AvailableOperationId": available_operation_id,
                "TankId": tank_id,
            },
        )

    async def _post(
        self,
        endpoint: str,
        extra_payload: Mapping[str, Any] | None = None,
        *,
        authenticated: bool = True,
    ) -> dict[str, Any]:
        """POST to the Reef Kinetics API and return the JSON body."""
        url = f"{self._base_url}{endpoint}"
        payload = self._base_payload() if authenticated else self._portal_payload()
        if extra_payload:
            payload.update(extra_payload)

        try:
            async with asyncio.timeout(30):
                async with self._session.post(
                    url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    response.raise_for_status()
                    data = await response.json(content_type=None)
        except ClientResponseError as err:
            if err.status in (401, 403):
                raise ReefBotAuthError("Reef Kinetics credentials were rejected") from err
            raise ReefBotCannotConnect("Unable to reach Reef Kinetics gateway") from err
        except (TimeoutError, ClientError) as err:
            raise ReefBotCannotConnect("Unable to reach Reef Kinetics gateway") from err
        except ValueError as err:
            raise ReefBotResponseError("Reef Kinetics returned invalid JSON") from err

        if not isinstance(data, dict):
            raise ReefBotResponseError("Reef Kinetics returned a non-object response")

        self._raise_for_api_error(data)
        return data

    def _base_payload(self) -> dict[str, Any]:
        """Build the common Reef Kinetics dashboard payload."""
        if not self._token or self._user_id is None:
            raise ReefBotAuthError("Missing Reef Kinetics token or user ID")
        return {
            "TOKEN": self._token,
            "USERID": self._user_id,
            **self._portal_payload(),
        }

    def _portal_payload(self) -> dict[str, Any]:
        """Build the common portal payload."""
        return {
            "DEVICETOKEN": self._device_token,
            "PORTALAPPID": self._portal_app_id,
            "PORTALAPPSECRET": self._portal_app_secret,
            "DEVICEPLATFORM": self._device_platform,
            "portalID": self._portal_id,
        }

    def _raise_for_api_error(self, data: Mapping[str, Any]) -> None:
        """Raise for API-level errors while avoiding sensitive log output."""
        result = data.get("Result", data.get("result"))
        success = data.get("Success", data.get("success"))
        message = str(data.get("Message", data.get("message", "")))
        token_message = str(data.get("TokenMessage", data.get("tokenMessage", "")))

        failed = success is False
        if result is not None:
            result_text = str(result).strip().lower()
            failed = failed or result_text in {"fail", "failed", "failure", "error"}

        if not failed:
            if token_message and self._looks_like_auth_error(token_message):
                raise ReefBotAuthError("Reef Kinetics token was rejected")
            return

        _LOGGER.debug("Reef Kinetics API returned an error result")
        if self._looks_like_auth_error(message or token_message):
            raise ReefBotAuthError("Reef Kinetics credentials were rejected")
        raise ReefBotResponseError(message or "Reef Kinetics API returned an error")

    @staticmethod
    def _looks_like_auth_error(message: str) -> bool:
        """Return whether an API message looks authentication related."""
        lowered = message.lower()
        return any(
            token in lowered
            for token in ("auth", "token", "credential", "unauthorized", "login")
        ) and not any(
            token in lowered for token in ("valid token", "token valid", "token is valid")
        )

    @staticmethod
    def _extract_list(
        payload: Mapping[str, Any], collection_keys: tuple[str, ...]
    ) -> list[dict[str, Any]]:
        """Extract a list from the common Reef Kinetics response shapes."""
        data = payload.get("Data", payload.get("data", payload))

        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = None
            for key in collection_keys:
                value = data.get(key)
                if isinstance(value, list):
                    items = value
                    break
            if items is None:
                for value in data.values():
                    if isinstance(value, list):
                        items = value
                        break
            if items is None:
                items = []
        else:
            items = []

        return [item for item in items if isinstance(item, dict)]
