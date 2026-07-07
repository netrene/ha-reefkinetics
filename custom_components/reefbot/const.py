"""Constants for the Reef Kinetics ReefBot integration."""

from __future__ import annotations

from datetime import timedelta

DOMAIN = "reefbot"

CONF_TOKEN = "token"
CONF_TOKEN_EXPIRY = "token_expiry"
CONF_USERNAME = "username"
CONF_PASSWORD = "password"
CONF_USER_ID = "user_id"
CONF_DEVICE_TOKEN = "device_token"
CONF_TANK_ID = "tank_id"
CONF_DEVICE_ID = "device_id"
CONF_TANK_NAME = "tank_name"

DEFAULT_SCAN_INTERVAL = timedelta(minutes=5)
DEFAULT_BASE_URL = "https://gateway.reefkinetics.com"
DEFAULT_PORTAL_APP_ID = "TESTAPP1"
DEFAULT_PORTAL_APP_SECRET = "SEC!@#"
DEFAULT_DEVICE_PLATFORM = "WEB"
DEFAULT_PORTAL_ID = 1

CONF_BASE_URL = "base_url"
CONF_PORTAL_APP_ID = "portal_app_id"
CONF_PORTAL_APP_SECRET = "portal_app_secret"
CONF_DEVICE_PLATFORM = "device_platform"
CONF_PORTAL_ID = "portal_id"

SENSITIVE_KEYS = {
    CONF_TOKEN,
    CONF_TOKEN_EXPIRY,
    CONF_USERNAME,
    CONF_PASSWORD,
    CONF_DEVICE_TOKEN,
    CONF_USER_ID,
    CONF_PORTAL_APP_SECRET,
    "TOKEN",
    "DEVICETOKEN",
    "USERID",
    "PORTALAPPSECRET",
}

UNIT_MAP = {
    "alkalinity": "dKH",
    "ammonia": "mg/L",
    "calcium": "mg/L",
    "iodine": "mg/L",
    "magnesium": "mg/L",
    "nitrate": "mg/L",
    "nitrite": "mg/L",
    "phosphate": "mg/L",
    "silicate": "mg/L",
}

EXCLUDED_PARAMETER_NAMES = {
    "device_hardware_test",
}
