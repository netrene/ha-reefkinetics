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
ENDPOINT_UPDATE_CHEMICAL_SETTINGS = (
    "/api/APIService/UpdateDeviceAvailableChemicalsSettingsV2"
)
ENDPOINT_AVAILABLE_CHEMICALS = "/api/APIService/GetAvailableChemicals"
ENDPOINT_UPDATE_CHEMICAL_POSITIONS = (
    "/api/APIService/UpdateDeviceAvailableChemicalsPositions"
)
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
ENDPOINT_COMPONENT_SETTINGS = "/api/APIService/GetDeviceComponentSettings"
ENDPOINT_UPDATE_COMPONENT_SETTING = "/api/APIService/UpdateDeviceComponentSettings"
ENDPOINT_PENDING_CALIBRATION_REQUESTS = (
    "/api/APIService/CheckPendingCalibrationRequestsV2"
)
ENDPOINT_SIZE_TYPES = "/api/APIService/GetSizeTypes"
ENDPOINT_COMPONENTS = "/api/APIService/GetComponents"
ENDPOINT_TANK_ALARMS = "/api/APIService/GetTankAlarmsByTankId"
ENDPOINT_ALARM_LOGS = "/api/APIService/GetAlarmLogsByTankId"
ENDPOINT_NOTIFICATIONS = "/api/Notifications/GetUserNotifications"
ENDPOINT_NOT_READ_NOTIFICATIONS_COUNT = (
    "/api/APIService/GetNotReadUserNotificationsCount"
)


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

    async def refill_device_chemical(
        self, device_id: int | str, position_index: int
    ) -> dict[str, Any]:
        """Set one configured chemical to its configured full volume."""
        chemicals = await self.get_device_chemical_settings(device_id)
        if not chemicals:
            raise ReefBotResponseError("ReefBot returned no chemical settings")

        updated_chemicals = [_chemical_update_payload(chemical) for chemical in chemicals]
        updated_chemical: dict[str, Any] | None = None
        for chemical in updated_chemicals:
            try:
                chemical_position = int(chemical["positionIndex"])
            except (KeyError, TypeError, ValueError):
                continue
            if chemical_position != position_index:
                continue

            full_value = _first_present(
                chemical, ("customVolume", "sizeTypeValue", "currentValue")
            )
            if full_value is None:
                raise ReefBotResponseError("ReefBot chemical has no configured volume")
            chemical["currentValue"] = full_value
            updated_chemical = chemical
            break

        if updated_chemical is None:
            raise ReefBotResponseError("ReefBot chemical position was not found")

        await self._post(
            ENDPOINT_UPDATE_CHEMICAL_SETTINGS,
            {
                "DeviceId": device_id,
                "availableChemicals": updated_chemicals,
            },
        )
        return updated_chemical

    async def get_available_chemicals(
        self, device_id: int | str
    ) -> list[dict[str, Any]]:
        """Return the catalog of chemicals assignable to a ReefBot device."""
        payload = await self._post(
            ENDPOINT_AVAILABLE_CHEMICALS, {"DeviceId": device_id}
        )
        return self._extract_list(
            payload,
            ("Chemicals", "chemicals", "AvailableChemicals", "availableChemicals"),
        )

    async def update_chemical_positions(
        self, device_id: int | str, positions: list[Mapping[str, Any]]
    ) -> list[dict[str, Any]]:
        """Write the complete chemical->tube assignment (Setup Tests / Save Changes).

        ``positions`` is the full list of occupied tubes; each item carries a
        chemical id, a 0-based position index (Tube 1 = 0) and a chemical name.
        Payload matches the confirmed Android-app request:
        ``{DeviceId, ChemicalPositions: [{ChemicalId(num|str), PositionIndex(int),
        chemicalName}]}``.
        """
        chemical_positions: list[dict[str, Any]] = []
        for position in positions:
            chemical_id = _first_present(
                position,
                (
                    "chemical_id",
                    "ChemicalId",
                    "chemicalId",
                    "AvailableChemicalId",
                    "availableChemicalId",
                ),
            )
            position_index = _first_present(
                position, ("position_index", "PositionIndex", "positionIndex")
            )
            chemical_name = _first_present(
                position, ("chemical_name", "chemicalName", "ChemicalName")
            )
            if chemical_id is None or position_index is None:
                continue
            chemical_positions.append(
                {
                    "ChemicalId": _numeric_id(chemical_id),
                    "PositionIndex": int(position_index),
                    "chemicalName": str(chemical_name or ""),
                }
            )

        await self._post(
            ENDPOINT_UPDATE_CHEMICAL_POSITIONS,
            {"DeviceId": device_id, "ChemicalPositions": chemical_positions},
        )
        return chemical_positions

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

    async def get_device_component_settings(
        self, device_id: int | str
    ) -> list[dict[str, Any]]:
        """Return configured ReefBot component maintenance settings."""
        payload = await self._post(ENDPOINT_COMPONENT_SETTINGS, {"DeviceId": device_id})
        return self._extract_list(payload, ("Components", "components", "Settings"))

    async def reset_device_component(
        self, device_id: int | str, device_component_id: int | str
    ) -> dict[str, Any]:
        """Reset one ReefBot maintenance component using dashboard semantics."""
        components = await self.get_device_component_settings(device_id)
        component = _find_component(components, device_component_id)
        if component is None:
            raise ReefBotResponseError("ReefBot component was not found")

        original_value = _first_present(
            component, ("OriginalValue", "originalValue")
        )
        current_value = _component_reset_value(component)
        if original_value is None or current_value is None:
            raise ReefBotResponseError("ReefBot component has no reset value")

        payload = {
            "DeviceId": device_id,
            "ComponentId": _first_present(component, ("ComponentId", "componentId")),
            "OriginalValue": original_value,
            "CurrentValue": current_value,
            "DeviceComponentId": _first_present(
                component, ("DeviceComponentId", "deviceComponentId")
            ),
            "ResetTime": _first_present(component, ("ResetTime", "resetTime")),
        }
        if payload["ComponentId"] is None or payload["DeviceComponentId"] is None:
            raise ReefBotResponseError("ReefBot component is missing identifiers")

        await self._post(ENDPOINT_UPDATE_COMPONENT_SETTING, payload)
        return payload

    async def update_device_component_capacity(
        self,
        device_id: int | str,
        device_component_id: int | str,
        original_value: float,
    ) -> dict[str, Any]:
        """Update one ReefBot maintenance component capacity."""
        components = await self.get_device_component_settings(device_id)
        component = _find_component(components, device_component_id)
        if component is None:
            raise ReefBotResponseError("ReefBot component was not found")

        current_value = _first_present(component, ("CurrentValue", "currentValue"))
        if current_value is None:
            raise ReefBotResponseError("ReefBot component has no current value")

        payload = {
            "DeviceId": device_id,
            "ComponentId": _first_present(component, ("ComponentId", "componentId")),
            "OriginalValue": _api_number(original_value),
            "CurrentValue": current_value,
            "DeviceComponentId": _first_present(
                component, ("DeviceComponentId", "deviceComponentId")
            ),
            "ResetTime": _first_present(component, ("ResetTime", "resetTime")),
        }
        if payload["ComponentId"] is None or payload["DeviceComponentId"] is None:
            raise ReefBotResponseError("ReefBot component is missing identifiers")

        await self._post(ENDPOINT_UPDATE_COMPONENT_SETTING, payload)
        return payload

    async def get_pending_calibration_requests(
        self, device_id: int | str
    ) -> list[dict[str, Any]]:
        """Return pending calibration requests for a ReefBot device."""
        payload = await self._post(
            ENDPOINT_PENDING_CALIBRATION_REQUESTS, {"DeviceIdArray": [device_id]}
        )
        return self._extract_list(payload, ("Requests", "requests", "Calibrations"))

    async def get_size_types(self) -> list[dict[str, Any]]:
        """Return configured size type definitions."""
        payload = await self._post(ENDPOINT_SIZE_TYPES)
        return self._extract_list(payload, ("SizeTypes", "sizeTypes"))

    async def get_components(self) -> list[dict[str, Any]]:
        """Return component definitions."""
        payload = await self._post(ENDPOINT_COMPONENTS)
        return self._extract_list(payload, ("Components", "components"))

    async def get_tank_alarms(self, tank_id: int | str) -> list[dict[str, Any]]:
        """Return safe-margin alarms for a tank."""
        payload = await self._post(ENDPOINT_TANK_ALARMS, {"tankId": tank_id})
        return self._extract_list(payload, ("Alarms", "alarms"))

    async def get_alarm_logs(self, tank_id: int | str) -> list[dict[str, Any]]:
        """Return alarm log entries for a tank."""
        payload = await self._post(ENDPOINT_ALARM_LOGS, {"tankId": tank_id})
        return self._extract_list(payload, ("Logs", "logs", "Alarms", "alarms"))

    async def get_user_notifications(
        self, page_index: int = 0, page_size: int = 6
    ) -> list[dict[str, Any]]:
        """Return user notifications."""
        payload = await self._post(
            ENDPOINT_NOTIFICATIONS,
            {"pageIndex": page_index, "pageSize": page_size},
        )
        return self._extract_list(payload, ("Notifications", "notifications", "Items"))

    async def get_unread_notifications_count(self) -> int | None:
        """Return unread notification count."""
        payload = await self._post(ENDPOINT_NOT_READ_NOTIFICATIONS_COUNT)
        data = payload.get("Data", payload.get("data", payload))
        if isinstance(data, int):
            return data
        if isinstance(data, str):
            try:
                return int(data)
            except ValueError:
                return None
        if isinstance(data, dict):
            for key in (
                "Count",
                "count",
                "NotReadCount",
                "notReadCount",
                "UnreadCount",
                "unreadCount",
            ):
                value = data.get(key)
                if value is None:
                    continue
                try:
                    return int(value)
                except (TypeError, ValueError):
                    continue
        return None

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


def _chemical_update_payload(chemical: Mapping[str, Any]) -> dict[str, Any]:
    """Return a chemical setting in the shape expected by the dashboard API."""
    available_size_types = _first_present(
        chemical, ("availableSizeTypes", "AvailableSizeTypes")
    )
    if isinstance(available_size_types, list):
        available_size_types = [
            _size_type_update_payload(size_type)
            for size_type in available_size_types
            if isinstance(size_type, Mapping)
        ]
    else:
        available_size_types = []

    return {
        "chemicalId": _first_present(chemical, ("chemicalId", "ChemicalId")),
        "positionIndex": _first_present(chemical, ("positionIndex", "PositionIndex")),
        "chemicalName": _first_present(chemical, ("chemicalName", "ChemicalName")),
        "typeId": _first_present(chemical, ("typeId", "TypeId")),
        "chemicalDisplayName": _first_present(
            chemical, ("chemicalDisplayName", "ChemicalDisplayName")
        ),
        "unit": _first_present(chemical, ("unit", "Unit")),
        "sizeTypeId": _first_present(chemical, ("sizeTypeId", "SizeTypeId")),
        "sizeTypeName": _first_present(chemical, ("sizeTypeName", "SizeTypeName")),
        "sizeTypeValue": _first_present(chemical, ("sizeTypeValue", "SizeTypeValue")),
        "currentValue": _first_present(chemical, ("currentValue", "CurrentValue")),
        "customVolume": _first_present(chemical, ("customVolume", "CustomVolume")),
        "availableSizeTypes": available_size_types,
    }


def _size_type_update_payload(size_type: Mapping[str, Any]) -> dict[str, Any]:
    """Return a size type in the shape expected by the dashboard API."""
    return {
        "sizeTypeId": _first_present(size_type, ("sizeTypeId", "SizeTypeId")),
        "sizeTypeName": _first_present(size_type, ("sizeTypeName", "SizeTypeName")),
        "sizeTypeValue": _first_present(size_type, ("sizeTypeValue", "SizeTypeValue")),
    }


def _find_component(
    components: list[dict[str, Any]], device_component_id: int | str
) -> dict[str, Any] | None:
    """Return a component by its device component ID."""
    target = str(device_component_id)
    for component in components:
        candidate = _first_present(
            component, ("DeviceComponentId", "deviceComponentId")
        )
        if candidate is not None and str(candidate) == target:
            return component
    return None


def _component_reset_value(component: Mapping[str, Any]) -> Any:
    """Return the component value after pressing the dashboard reset button."""
    change_operation = _first_present(
        component, ("ChangeOperation", "changeOperation")
    )
    try:
        operation = int(change_operation)
    except (TypeError, ValueError):
        operation = None

    original_value = _first_present(component, ("OriginalValue", "originalValue"))
    if operation == 0:
        return original_value
    if operation == 1:
        return 0

    reset_title = str(
        _first_present(component, ("ResetTitle", "resetTitle")) or ""
    ).strip().lower()
    if reset_title in {"refill"}:
        return original_value
    if reset_title in {"empty", "replace", "reset"}:
        return 0
    return None


def _numeric_id(value: Any) -> int | str:
    """Send a chemical id as int when parseable (API format), else as string."""
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return str(value)


def _api_number(value: float) -> int | float:
    """Return a compact number for the dashboard API."""
    numeric_value = float(value)
    if numeric_value.is_integer():
        return int(numeric_value)
    return numeric_value


def _first_present(data: Mapping[str, Any] | None, keys: tuple[str, ...]) -> Any:
    """Return the first present value from a mapping."""
    if not data:
        return None
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None
