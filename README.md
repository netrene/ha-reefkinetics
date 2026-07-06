# Reef Kinetics ReefBot for Home Assistant

Custom Home Assistant integration for Reef Kinetics ReefBot devices.

This integration uses the Reef Kinetics cloud gateway observed from the official web dashboard. It is read-only and currently exposes ReefBot device status, tank metadata, and latest test results as Home Assistant entities.

## Status

Early development. The integration is not affiliated with, endorsed by, or supported by Reef Kinetics.

The Reef Kinetics cloud API used here is undocumented and may change without notice.

## Features

- UI-based setup through Home Assistant.
- Token-based authentication for initial testing.
- Cloud polling via `https://gateway.reefkinetics.com`.
- Online status binary sensor.
- Firmware, serial number, vial count, tank name, and tank volume sensors.
- Dynamic sensors for all parameters returned by the ReefBot API.
- Diagnostics with sensitive fields redacted.

## Not Included

This integration does not start tests, abort tests, calibrate the device, configure reagents, or perform any write operation.

Maintenance functions are intentionally out of scope for the first version.

## Installation With HACS

1. Add this repository as a custom HACS repository of type `Integration`.
2. Install `Reef Kinetics ReefBot`.
3. Restart Home Assistant.
4. Add the integration from **Settings > Devices & services**.

## Setup

The initial setup requires values observed from an authenticated Reef Kinetics dashboard session:

- Token
- User ID
- Device token

The integration then calls the cloud API to discover devices and tanks. If more than one tank is returned, Home Assistant will ask which tank to use.

Do not share these credentials and do not commit HAR files or real API payloads to a public repository.

## Polling

The default polling interval is 5 minutes. ReefBot tests are usually much less frequent than this; the interval is intentionally conservative for early testing and can be made configurable later.

## Known API Endpoints

- `POST /api/APIService/GetUserDevices`
- `POST /api/APIService/GetUserTanks`
- `POST /api/APIService/GetOperationResultsByTankIdWithColorsV2`

## Roadmap

- Username/password login flow if the login endpoint is captured and understood.
- Reauth flow if tokens expire.
- Options flow for polling interval.
- Better parameter metadata once more API samples are available.
- Optional support for multiple tanks per account.

