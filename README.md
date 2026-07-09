# Reef Kinetics ReefBot for Home Assistant

Custom Home Assistant integration for Reef Kinetics ReefBot devices.

This integration uses the Reef Kinetics cloud gateway observed from the official web dashboard. It is read-only and currently exposes ReefBot device status, tank metadata, and latest test results as Home Assistant entities.

## Status

Early development. The integration is not affiliated with, endorsed by, or supported by Reef Kinetics.

The Reef Kinetics cloud API used here is undocumented and may change without notice.

## Features

- UI-based setup through Home Assistant.
- Reef Kinetics dashboard login through the Home Assistant UI.
- Cloud polling via `https://gateway.reefkinetics.com`.
- Online status binary sensor.
- Firmware, serial number, vial count, tank name, and tank volume sensors.
- Dynamic sensors for all parameters returned by the ReefBot API.
- Compact per-parameter result history exposed as sensor attributes.
- Tube volume sensors named with their configured chemicals and fill percentage attributes.
- Configured tests sensor derived from installed chemicals and available operations.
- Individual configured test sensors with tube and chemical mappings.
- Current operation and pending operation sensors for manually started or queued tests.
- Start-test button entities for configured tests.
- Read-only maintenance sensors for syringe, waste, and RODI levels.
- Read-only sensors for notifications, configured safe margins, alarm logs, and pending calibrations.
- Refill button entities for configured chemical tubes. These set one tube back to its configured full volume.
- Maintenance button entities for Syringe, Waste, and RODI. These mirror the dashboard actions to replace, empty, or refill the component state.
- Diagnostics with sensitive fields redacted.

## Not Included

This integration can start configured one-time tests, refill configured chemical tube values, and reset basic maintenance component values through Home Assistant button entities. Test buttons can consume reagents. Refill and maintenance buttons update the Reef Kinetics cloud state for the selected item.

This integration does not abort tests, calibrate the device, configure reagent positions, or perform maintenance write operations beyond the exposed chemical/component reset buttons.

Maintenance writes are intentionally out of scope until the matching dashboard behavior has been reviewed carefully.

## Installation With HACS

1. Add this repository as a custom HACS repository of type `Integration`.
2. Install `Reef Kinetics ReefBot`.
3. Restart Home Assistant.
4. Add the integration from **Settings > Devices & services**.

## Setup

The setup flow asks for your Reef Kinetics dashboard login:

- Email
- Password

The password is used once to request a cloud token and is not stored in the Home Assistant config entry. The integration stores the returned token, token expiry, user ID, and a generated web device token. If the token expires, Home Assistant will start a reauthentication flow and ask for the password again.

The integration then calls the cloud API to discover devices and tanks. If more than one tank is returned, Home Assistant will ask which tank to use.

Do not share these credentials and do not commit HAR files or real API payloads to a public repository.

## Polling

The default polling interval is 5 minutes. ReefBot tests are usually much less frequent than this; the interval is intentionally conservative for early testing and can be made configurable later.

## Known API Endpoints

- `POST /api/APIService/GetUserDevices`
- `POST /api/APIService/GetUserTanks`
- `POST /api/APIService/GetOperationResultsByTankIdWithColorsV2`
- `POST /api/APIService/GetPendingOperationRequestsByTank`
- `POST /api/APIService/GetOperationRequestsHistoryByTankId`
- `POST /api/APIService/OneTimeOperationRequest`
- `POST /api/APIService/UpdateDeviceAvailableChemicalsSettingsV2`
- `POST /api/APIService/GetDeviceComponentSettings`
- `POST /api/APIService/UpdateDeviceComponentSettings`
- `POST /api/APIService/CheckPendingCalibrationRequestsV2`
- `POST /api/APIService/GetSizeTypes`
- `POST /api/APIService/GetComponents`
- `POST /api/APIService/GetTankAlarmsByTankId`
- `POST /api/APIService/GetAlarmLogsByTankId`
- `POST /api/Notifications/GetUserNotifications`
- `POST /api/APIService/GetNotReadUserNotificationsCount`

## Roadmap

- Maintenance actions for carefully reviewed refill/reset/calibration workflows.
- Options flow for polling interval.
- Better parameter metadata once more API samples are available.
- Optional support for multiple tanks per account.
