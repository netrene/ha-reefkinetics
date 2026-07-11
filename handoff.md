# Reef Kinetics ReefBot Integration Handoff

Stand: 2026-07-12

Dieses Dokument fasst den aktuellen Reverse-Engineering- und Implementierungsstand der Home-Assistant-Integration `ha-reefkinetics` zusammen. Es soll als Startpunkt fuer spaetere Sessions dienen, insbesondere fuer native Android- und iOS-Apps mit einer besseren, grafischen Bedienoberflaeche fuer ReefBot.

## Zielbild

Die offizielle Reef-Kinetics-Weboberflaeche verteilt wichtige Funktionen ueber Tank-Dashboard, Activity, Manage, Devices, Maintenance und Settings. Das aktuelle HA-Sidebar-Panel beweist, dass ein wesentlich besserer Bedienfluss moeglich ist:

- Tests und letzte Messwerte auf einen Blick.
- Vials/Reagenzien mit Fuellstand direkt am visuellen Geraet.
- RODI, Waste und Syringe als Wartungsstatus.
- Testkammer, aktuelle Operation und Testfortschritt in einer zentralen Ansicht.
- Start- und Refill-Aktionen mit Sicherheitsabfrage.

Eine native Mobile-App kann dieses Prinzip weiterfuehren und muss nicht die fragmentierte Originalnavigation kopieren.

## Repository

- Repo: `netrene/ha-reefkinetics`
- Lokaler Pfad: `/Users/renezuch/Documents/Codex/ha-reefkinetics`
- Home Assistant Domain: `reefbot`
- Aktuelle Version: siehe `custom_components/reefbot/manifest.json`
- Sidebar Panel: `custom_components/reefbot/frontend/reefbot-panel.js`

Wichtige Dateien:

- `custom_components/reefbot/api.py`: Reef-Kinetics-Cloud-Client und Endpunkte.
- `custom_components/reefbot/config_flow.py`: Login, Reauth, Tank-Auswahl.
- `custom_components/reefbot/coordinator.py`: Polling und Zusammenfuehrung der API-Daten.
- `custom_components/reefbot/sensor.py`: Device-, Tank-, Parameter-, Tube-, Maintenance-, Alarm- und Timing-Sensoren.
- `custom_components/reefbot/button.py`: Teststart, Tube-Refill, Component-Reset.
- `custom_components/reefbot/number.py`: Kapazitaetswerte fuer Wartungskomponenten.
- `custom_components/reefbot/frontend/reefbot-panel.js`: Grafisches Bedienpanel.
- `docs/browser-analysis/README.md`: Read-only Browser-Walkthrough mit Screenshots und Seitenzuordnung. Dieser Ordner war zum Zeitpunkt dieses Handoffs untracked und sollte vor einem Public Commit auf sensible Daten geprueft werden.

## Sicherheit und Datenschutz

Die Reef-Kinetics-API ist nicht offiziell dokumentiert. HAR-Dateien und echte Payloads koennen Token, User-ID, Device-Token, Device-ID, Tank-ID, Seriennummern oder Tanknamen enthalten und duerfen nicht ungeprueft in ein oeffentliches Repository.

Die Integration redaktiert sensitive Felder in Diagnostics. Fuer App-Entwicklung sollten echte Zugangsdaten nur lokal oder in sicheren Secrets verwendet werden.

Lokale, nicht versionierte Details zum aktuell analysierten Account liegen in
`handoff.local.md`. Diese Datei enthaelt reale Account-/Device-IDs und ist
lokal ueber `.git/info/exclude` von Git ausgeschlossen. Sie darf nicht in das
oeffentliche Repo uebernommen werden.

Sensible Felder:

- `TOKEN`
- `DEVICETOKEN`
- `USERID`
- `PORTALAPPSECRET`
- `username`
- `password`
- `token`
- `token_expiry`
- `device_token`
- `user_id`

## Login und Authentifizierung

Basis-URL:

```text
https://gateway.reefkinetics.com
```

Login-Endpunkt:

```text
POST /api/auth/AuthorizeAndLoginWithPortal
```

Login-Payload:

```json
{
  "PortalUsername": "<email>",
  "PortalPassword": "<password>",
  "DEVICETOKEN": "<generated-device-token>",
  "PORTALAPPID": "TESTAPP1",
  "PORTALAPPSECRET": "SEC!@#",
  "DEVICEPLATFORM": "WEB",
  "portalID": 1
}
```

Login-Response liefert mindestens:

- `Token`
- `TokenExpiry`
- `UserId`

Die HA-Integration speichert:

- Username
- Token
- Token-Expiry
- User-ID
- generiertes Device-Token

Das Passwort wird nach erfolgreichem Login nicht gespeichert. Wenn `TokenExpiry` abgelaufen ist, startet die Integration eine Reauth-Flow und fragt das Passwort erneut ab.

Fuer native Apps gibt es zwei naheliegende Auth-Strategien:

1. Direkter Reef-Kinetics-Login wie in der HA-Integration.
2. Nutzung einer eigenen Backend-Schicht, die Login/Token-Refresh kapselt.

Fuer eine Standalone-App ist Variante 1 technisch am einfachsten, muss aber UI-seitig sehr sauber mit Credentials und Token-Ablauf umgehen.

## Gemeinsamer API-Payload

Alle authentifizierten API-Calls verwenden einen gemeinsamen Payload-Block:

```json
{
  "TOKEN": "<token>",
  "USERID": <user-id>,
  "DEVICETOKEN": "<generated-device-token>",
  "PORTALAPPID": "TESTAPP1",
  "PORTALAPPSECRET": "SEC!@#",
  "DEVICEPLATFORM": "WEB",
  "portalID": 1
}
```

Endpoint-spezifische Felder werden in denselben JSON-Body gemerged, z. B.:

```json
{
  "TOKEN": "...",
  "USERID": 123,
  "DEVICETOKEN": "...",
  "PORTALAPPID": "TESTAPP1",
  "PORTALAPPSECRET": "SEC!@#",
  "DEVICEPLATFORM": "WEB",
  "portalID": 1,
  "tankId": "<tank-id>"
}
```

## Geraete- und Tank-Erkennung

Nach Login:

```text
POST /api/APIService/GetUserDevices
POST /api/APIService/GetUserTanks
```

Die Integration erwartet mindestens ein Device und mindestens einen Tank.

Config-Flow:

- Wenn genau ein Tank vorhanden ist, wird automatisch dieser Tank verwendet.
- Wenn mehrere Tanks vorhanden sind, zeigt HA eine Tank-Auswahl.
- Aktuell wird das erste Device verwendet und mit dem gewaehlten Tank kombiniert.
- Unique-ID ist aus Seriennummer oder Device-ID plus Tank-ID aufgebaut.

Fuer Mobile-Apps sollte die Discovery expliziter werden:

- Accounts koennen mehrere Tanks haben.
- Mehrere ReefBot-Geraete pro Account/Tank sind moeglich.
- UI sollte Tank- und Device-Wechsel vorsehen, auch wenn die erste Version nur ein Geraet fokussiert.

## Polling-Modell

Die HA-Integration nutzt `DataUpdateCoordinator` mit 5-Minuten-Intervall.

Bei Button-Aktionen:

- Vor der Aktion wird ein Refresh ausgefuehrt.
- Aktion wird an die Reef-Kinetics-API gesendet.
- Danach wird erneut refreshed.
- Das Sidebar-Panel ruft zusaetzlich verzoegerte `homeassistant.update_entity`-Updates nach 1, 5 und 15 Sekunden aus.

Fuer native Apps:

- Normales Polling alle 1 bis 5 Minuten reicht fuer Messwerte.
- Nach Start/Refill/Reset sollten gezielte Refreshes nach wenigen Sekunden erfolgen.
- Bei laufendem Test kann lokaler Fortschritt minuetlich aus Startzeit und erwarteter Dauer berechnet werden.

## Verfuegbare Read-Endpunkte

| Bereich | Endpoint | Payload-Zusatz | Nutzen |
| --- | --- | --- | --- |
| Devices | `/api/APIService/GetUserDevices` | keiner | ReefBot-Geraete, Seriennummer, Firmware, Device-ID |
| Tanks | `/api/APIService/GetUserTanks` | keiner | Tanks, Tank-ID, Name, Volumen |
| Tank-Ergebnisse | `/api/APIService/GetOperationResultsByTankIdWithColorsV2` | `tankId` | Hauptdashboard: Parameter, letzte Messwerte, Farben/History |
| Parameter-Detail | `/api/APIService/GetOperationResultsByTankIdOperationParameterIdWithColors` | `tankId`, `OperationParameterId` | detaillierte Historie je Parameter |
| Chemikalien/Tubes | `/api/APIService/GetDeviceChemicalSettings` | `DeviceId` | Tube-Positionen, Chemikalien, aktuelle ml, Kapazitaet |
| Verfuegbare Tests | `/api/APIService/GetAvailableOperations` | `DeviceId` | alle moeglichen Operations/Tests und benoetigte Chemicals |
| Quellen | `/api/APIService/GetDeviceSourceSettings` | `DeviceId` | Source/Tank-Zuordnung |
| Device Results | `/api/APIService/GetOperationResultsByDeviceIdV2` | `DeviceId` | letzte Device-Ergebnisse |
| Pending Requests | `/api/APIService/GetPendingOperationRequestsByTank` | `tankId` | aktuell laufende/ausstehende Operationen |
| Request History | `/api/APIService/GetOperationRequestsHistoryByTankId` | `tankId` | letzte gestartete/abgeschlossene Operationen |
| Operation Types | `/api/APIService/GetOperationTypes` | keiner | Labels/Typen fuer Requests |
| Components | `/api/APIService/GetDeviceComponentSettings` | `DeviceId` | Syringe/Waste/RODI current/original/percent/reset action |
| Pending Calibration | `/api/APIService/CheckPendingCalibrationRequestsV2` | `DeviceIdArray` | ausstehende Calibration Requests |
| Size Types | `/api/APIService/GetSizeTypes` | keiner | Groessentypen fuer Chemikalien/Komponenten |
| Component Definitions | `/api/APIService/GetComponents` | keiner | Definitionen von Maintenance-Komponenten |
| Safe Margins | `/api/APIService/GetTankAlarmsByTankId` | `tankId` | konfigurierte Alarm-/Safe-Margin-Schwellen |
| Alarm Logs | `/api/APIService/GetAlarmLogsByTankId` | `tankId` | Alarmhistorie, soweit API Daten liefert |
| Notifications | `/api/Notifications/GetUserNotifications` | `pageIndex`, `pageSize` | Reef-Kinetics-Statusmeldungen/Notifications |
| Unread Count | `/api/APIService/GetNotReadUserNotificationsCount` | keiner | Anzahl ungelesener Notifications |

## Verfuegbare Write-Endpunkte

Diese Aktionen veraendern den Cloud-/Device-Zustand und muessen in jeder App mit Confirmation und Busy-State abgesichert werden.

| Aktion | Endpoint | Payload-Zusatz | Status |
| --- | --- | --- | --- |
| Einmaligen Test starten | `/api/APIService/OneTimeOperationRequest` | `DeviceIdArray`, `AvailableOperationId`, `TankId` | Implementiert |
| Tube/Chemikalie auf voll setzen | `/api/APIService/UpdateDeviceAvailableChemicalsSettingsV2` | `DeviceId`, `availableChemicals` | Implementiert |
| Waste/RODI/Syringe Reset | `/api/APIService/UpdateDeviceComponentSettings` | `DeviceId`, `ComponentId`, `OriginalValue`, `CurrentValue`, `DeviceComponentId`, `ResetTime` | Implementiert |
| Waste/RODI Capacity setzen | `/api/APIService/UpdateDeviceComponentSettings` | wie oben, aber `OriginalValue` geaendert | Implementiert |
| Test-/Tube-Konfiguration speichern | vermutlich Settings-Save aus Manage-Seite | noch nicht implementiert | Spaeter |
| Calibration starten | Calibration-Request aus Maintenance | noch nicht implementiert | Spaeter |
| Schedules bearbeiten | Schedule-Endpunkte | noch nicht implementiert | Spaeter |
| Manual Result hinzufuegen | Activity/Dashboard | noch nicht implementiert | Spaeter |

## Datenmodell in der Integration

`ReefBotData` im Coordinator haelt aggregiert:

- `devices`
- `tanks`
- `results`
- `parameter_results`
- `chemicals`
- `available_operations`
- `source_settings`
- `device_results`
- `pending_operation_requests`
- `operation_request_history`
- `operation_types`
- `component_settings`
- `pending_calibration_requests`
- `size_types`
- `components`
- `tank_alarms`
- `alarm_logs`
- `notifications`
- `unread_notifications_count`

Derived Properties:

- `device`: erstes/konfiguriertes Device.
- `tank`: erster/konfigurierter Tank.
- `parameters`: messbare Parameter aus dem Tank-Ergebnis.
- `tubes`: Chemikalien sortiert nach `PositionIndex`.
- `configured_operations`: available operations, deren benoetigte Chemicals installiert sind.
- `current_operation_request`: erster Pending Request.

Wichtig: `configured_operations` ist abgeleitet, nicht einfach eine Liste aus der UI. Es wird anhand der installierten Chemical IDs und der `RelatedChemicals` der Available Operations berechnet.

## Home-Assistant-Entities

### Device/Tank

- Firmware-Version
- Seriennummer
- Anzahl Vials
- Tankname
- Tankvolumen
- Online-Binary-Sensor

### Messwerte

Dynamische Parameter-Sensoren fuer API-Parameter:

- z. B. Alkalinity, Calcium, Nitrate, Nitrite, Phosphate
- aktuelle Werte als State
- `unit_of_measurement`
- `history` als Attribut
- Brand, Operation, Min/Max, Raw-Unit und weitere API-Metadaten als Attribute

`Device Hardware Test` wird bewusst aus den Parameter-Sensoren ausgeschlossen.

### Tubes/Reagenzien

Fuer Tube 1 bis 8:

- State: aktuelles Volumen
- Unit: typischerweise `mL`
- Attribute:
  - `tube_number`
  - `chemical_display_name`
  - `current_volume`
  - `capacity`
  - `fill_percentage`
  - Chemical IDs und API-Rohdaten soweit vorhanden

### Konfigurierte Tests

- Summary-Sensor mit Anzahl konfigurierter Tests.
- Einzelne configured-test Sensoren pro Operation.
- Attribute enthalten Display-Name, Methode, Parameter, benoetigte Chemicals/Tubes und API IDs.

### Aktuelle Operation und Timing

- `current_operation`: Name der aktuell pending Operation oder `idle`.
- `pending_operations`: Anzahl und Attribute mit pending/recent history.
- `current_test_duration`: erwartete Testdauer in Minuten.
- `current_test_elapsed_time`: vergangene Minuten.
- `current_test_remaining_time`: verbleibende Minuten.
- `current_test_progress`: Prozentfortschritt.

Die Dauer basiert auf einer hardcodierten Tabelle aus ReefBot-Testdaten. Beispiel: RedSea Alkalinity Pro ca. 26 Minuten.

### Maintenance

- Syringe: current/original/percentage/display.
- Waste: current/original/percentage/display.
- RODI: current/original/percentage/display.
- Kapazitaets-Number-Entities fuer Komponenten, deren API `AllowChange` erlaubt.
- Reset/Refill/Replace Buttons fuer resettable Komponenten.

### Alarme und Status

- `safe_margins`: konfigurierte Schwellen.
- `alarm_logs`: Alarmhistorie, soweit vom Endpoint geliefert.
- `notifications`: Reef-Kinetics Notifications inkl. unread count.
- Panel kombiniert Alarm Logs und Notifications in einem Dialog.

Wichtiger Befund: Die Weboberflaeche zeigt Statusmeldungen/Alarme teilweise anders als die API-Endpunkte. Fuer Apps sollte die Alarm-/Notification-Seite separat nochmal mit aktuellen HARs validiert werden.

## Sidebar Panel

Das Panel ist eine HA-Sidebar-Page und ruft die Reef-Kinetics-API nicht direkt auf. Es liest nur `hass.states` und drueckt HA-Button-Entities.

Aktuelle Elemente:

- Header mit Logo, Online-Status, Pending Operation, Last Operation, Alarms & Status.
- Test-Kacheln mit Start-Button, aktuellem Wert, Delta und kleinem Verlauf.
- ReefBot-Grafik:
  - Vials 1-8 mit Fuellstand, Farbe, Chemical-Name.
  - Refill-Button pro Vial direkt auf dem Vial, rot, mit Confirmation.
  - Test Chamber als groesserer Glaszylinder rechts neben Vial 8.
  - Spritze/Gantry-Animation bei aktivem Test.
  - Mess-/Ruehr-Animation in der Testkammer.
- Maintenance-Bar fuer RODI, Waste und Syringe.

Panel-Designentscheidung:

- Keine API-Calls im Frontend.
- Actions laufen ueber Home Assistant Button Entities.
- Dadurch bleibt Rechte-/Auth-Handling in der Integration und nicht im Browser-JS.

Fuer native Apps ist das anders: dort kann direkt gegen die Reef-Kinetics-API gearbeitet werden. Das Panel ist aber ein guter UX-Prototyp.

## Grafische Panel-Spezifikation fuer App-Nachbau

Dieser Abschnitt beschreibt das aktuelle Panel so, dass eine native Android-
oder iOS-App die Darstellung 1:1 als Produktprototyp nachbauen kann. Die
konkrete Implementierung liegt in
`custom_components/reefbot/frontend/reefbot-panel.js`.

### Render-Struktur

Die Frontend-Datei arbeitet mit einem View-Model aus `buildModel(hass,
lastPressed)` und diesen Haupt-Renderern:

| Renderer | Aufgabe |
| --- | --- |
| `renderHeader(model)` | Logo, Titel, Online, Pending Operation, Last Operation, Alarms & Status |
| `renderTests(model)` | Test-Kacheln fuer die konfigurierten Messparameter |
| `renderMachine(model)` | Zentrale ReefBot-Geraetegrafik |
| `renderVial(tube)` | einzelnes Reagenz-Vial mit Fuellstand und Refill |
| `renderChamberVial(model)` | Testkammer rechts neben den acht Reagenz-Vials |
| `renderMaintenance(model)` | kompakte RODI/Waste/Syringe-Leiste unter dem Geraet |
| `renderConfirmDialog(action)` | Confirmation fuer Teststart und Refill |
| `renderAlarmDialog(model, open)` | Kombinierte Alarm-/Statusliste |

Die wichtigsten CSS-/DOM-Bausteine:

- `.page`, `.shell`, `.content-grid`, `.center-stack`
- `.header`, `.brand-mark`, `.header-metrics`, `.header-chip`
- `.tests`, `.test-grid`, `.test-card`, `.play`, `.result-trend`
- `.machine`, `.machine-frame`, `.top-rail`, `.gantry`, `.led-strip`
- `.syringe-carriage`, `.syringe-body`, `.syringe-needle`
- `.vial-row`, `.vial-card`, `.vial-cap`, `.vial`, `.vial-refill`, `.vial-number`
- `.chamber-slot`, `.chamber-vial`, `.chamber-operation`, `.chamber-progress`
- `.maintenance-bar`, `.maintenance-item`, `.mini-level`
- `.dialog-backdrop`, `.dialog-card`, `.alarm-dialog`

### Geraete-Layout

Das zentrale Element ist ein abstrahiertes ReefBot-Geraet, nicht eine normale
Dashboard-Kachel:

- Dunkles, breites Geraetegehaeuse mit dickem Rahmen.
- Oben innen eine horizontale Fuehrungsschiene.
- Darunter die bewegliche Spritze am Gantry.
- Im unteren Bereich acht Reagenz-Vials.
- Rechts neben Vial 8 sitzt die Testkammer als neunter Glaszylinder.
- Unter dem Geraet liegen RODI, Waste und Syringe als kompakte Wartungsbalken.
- Links und rechts neben dem Geraet sollen keine grossen Zusatzkarten mehr
  stehen; Statusinformationen werden in den Header oder in Dialoge verschoben.

Die Testkammer ist kein separates Dashboard-Widget. Sie ist Teil der
Geraetegrafik, steht auf derselben horizontalen Linie wie die Vials und ist ca.
14-20 Prozent groesser als ein Reagenz-Vial. Dadurch entspricht sie dem
realen ReefBot-Aufbau besser.

### Vials

Jedes Reagenz-Vial besteht visuell aus:

- schwarzem Deckel oben,
- transparentem Glaszylinder,
- farbigem Fuellstand mit leichtem Verlauf,
- dezenter Oberflaechen-Welle,
- 20-ml-Kalibrierstrich knapp unter dem Deckel,
- aktuellem ml-Wert in der Fluessigkeit,
- rotem Refill-Button auf dem unteren Bereich des Vials,
- runder Nummernplakette `1` bis `8` unter dem Vial,
- Chemical-Name unter der Nummer.

Die Labels sollen nicht `Tube 1` im Vordergrund tragen. Primaeres Label ist
die grosse Ziffer `1-8`; der Chemikalienname steht darunter.

Farbkonzept der aktuellen Referenz:

| Slot | Farbe/Anmutung |
| --- | --- |
| 1 | Bernstein/Gelb fuer KH Titrant |
| 2 | Gelb-Orange |
| 3 | Gruen |
| 4 | Tuerkis |
| 5 | Blau |
| 6 | Violett |
| 7 | Magenta |
| 8 | Rot/Orange |
| Testkammer | Blau/Cyan fuer Wasser/Reaktion |

Die Refill-Buttons:

- liegen mittig auf dem jeweiligen Vial,
- sind rot,
- liegen weit genug unten, damit Spritze/Nadel nicht verdeckt werden,
- brauchen immer Confirmation,
- loesen die zugehoerige HA-Button-Entity bzw. in einer App den
  `UpdateDeviceAvailableChemicalsSettingsV2`-Flow aus.

### Spritze und Animation

Die Spritze ist vertikal und sitzt an einem horizontal beweglichen Schlitten:

- Oben kleiner quadratischer Motor-/Schlittenblock.
- Transparenter Spritzenkoerper mit Markierungsstrichen.
- Innen ein leichter Cyan-Fuellstand, wenn bei aktivem Test Reagenz gezogen
  wird.
- Kurze Fluegel/Griffpartie seitlich.
- Nadel unten ohne Dreieckspfeil.

Bei aktivem Test:

1. Spritze faehrt horizontal ueber die fuer den Test benoetigten Vials.
2. Sie faehrt optisch etwas nach unten, um Fluessigkeit zu entnehmen.
3. Sie faellt/entleert optisch in Richtung Testkammer.
4. Tropfen kommen aus der Nadelspitze und fallen mittig in die Testkammer.
5. Danach wiederholt sich die Sequenz, bis der Test beendet ist.

In der aktuellen Panel-Implementierung ist die Bewegung CSS-basiert:

- `--source-a-left`, `--source-b-left`, `--chamber-left` definieren Positionen.
- `@keyframes syringeCollect` bewegt den Schlitten.
- `@keyframes syringeFill` animiert die Fuellung im Spritzenkoerper.
- Tropfen werden ueber Pseudo-Elemente der Nadel dargestellt.

Wichtig fuer native Apps: Die Animation muss nur bei echten Tests laufen, nicht
bei Maintenance-Aktionen wie `Empty Waste`, `Refill RODI` oder `Replace
Syringe`.

### Testkammer

Die Testkammer zeigt:

- Glaszylinder wie ein groesseres Vial,
- Wasser/Fuellstand in Cyan,
- Ruehrbewegung/Wasserwirbel,
- kleinen Magnetruehrer unten,
- kurze LED-/Messblitze von der Seite,
- Status-Label `Live:` oder `Last:` plus Operation,
- Fortschritt mit Restzeit, Prozent und Gesamtdauer.

Logik:

- `Live:` wird nur angezeigt, wenn `current_operation` wirklich ein aktiver
  Test ist.
- `Last:` zeigt den letzten Test/letzte Operation, aber ohne aktive Animation.
- Maintenance-Operationen duerfen nicht als aktive Testkammeranimation
  erscheinen.
- Der Fortschritt soll bevorzugt aus den HA-Timing-Sensoren kommen:
  - `current_test_duration`
  - `current_test_elapsed_time`
  - `current_test_remaining_time`
  - `current_test_progress`
- Fallback ist die hardcodierte Testdauer-Tabelle im Frontend, falls die
  Sensoren fehlen.

### Test-Kacheln

Die aktuelle Zielvariante ist eine kompakte Ergebnis-Kachel:

- runder Play-Button links,
- Parametername und aktueller Wert prominent,
- kurzer Trend der letzten drei Messwerte,
- Zahlenwerte der letzten drei Messpunkte unter dem Trend,
- Klick auf die Kachel oeffnet `hass-more-info` bzw. in einer App die
  Detailhistorie.

Teststart:

- Play-Button darf nicht direkt ausloesen.
- Immer Confirmation-Dialog zeigen.
- Bei laufendem Test/Pending Operation sollten weitere Teststarts disabled
  sein oder zumindest mit deutlicher Warnung blockiert werden.

### Header und Status

Header-Chips:

- `Status`: ReefBot Online/Offline aus der ReefBot-Online-Entity.
- `Pending operation`: aktuell laufender/pending Test.
- `Last operation`: letzte bekannte Operation; Klick oeffnet Historie von
  `current_operation`.
- `Alarms & status`: Anzahl/Status, Klick oeffnet Dialog mit Alarm Logs und
  Notifications.

Nicht anzeigen:

- fremde Entities aus anderen Integrationen,
- reine Notifications als einzelne Header-Kachel ohne Mehrwert,
- rohe IDs oder technische Labels im Hauptscreen.

### Maintenance-Bar

Unter dem Geraet:

- `RODI`: aktueller Literwert, Kapazitaet, Prozent, Refill-Button.
- `Waste`: aktueller Literwert, Kapazitaet, Prozent, Empty-Button.
- `Syringe`: aktuelle Usage, Max Usage, Prozent, Replace-Button.

Alle Maintenance-Aktionen brauchen Confirmation und duerfen die
Testkammeranimation nicht starten.

### Datenbindung fuer Native Apps

Das HA-Panel liest `hass.states`; eine native App sollte denselben View-Model-
Begriff direkt aus der Reef-Kinetics-API bauen:

| UI-Element | HA-Quelle | Direkte API-Quelle |
| --- | --- | --- |
| Online | Online-Binary-Sensor | Device-/Tank-Device-Daten |
| Messwerte | Parameter-Sensoren | `GetOperationResultsByTankIdWithColorsV2` |
| Detailhistorie | Sensor-Attribute `history` | `GetOperationResultsByTankIdOperationParameterIdWithColors` |
| Vials | Tube-Sensoren | `GetDeviceChemicalSettings` |
| Konfigurierte Tests | Configured-test Sensoren | `GetAvailableOperations` + installierte Chemicals |
| Teststart | Button-Entity | `OneTimeOperationRequest` |
| Refill Tube | Button-Entity | `UpdateDeviceAvailableChemicalsSettingsV2` |
| RODI/Waste/Syringe | Maintenance-Sensoren/Buttons/Numbers | `GetDeviceComponentSettings` + `UpdateDeviceComponentSettings` |
| Aktueller Vorgang | Current-operation Sensor | `GetPendingOperationRequestsByTank` + Request History |
| Timing | Timing-Sensoren | Operation Startzeit + Testdauer-Tabelle |
| Alarme/Status | Alarm-/Notification-Sensoren | `GetAlarmLogsByTankId`, `GetUserNotifications` |

### Responsiveness

Desktop:

- Header oben.
- Tests als horizontale Kachelreihe.
- ReefBot-Geraet breit und zentral.
- Maintenance-Bar unten.

Tablet:

- Tests duerfen auf zwei Reihen umbrechen.
- Geraet bleibt zentral, ggf. etwas schmaler.
- Maintenance-Bar bleibt kompakt.

Smartphone / Companion App:

- Keine winzigen Vials erzwingen.
- Geraetegrafik darf horizontal scrollbar sein oder als Zoom-/Carousel-
  Bereich funktionieren.
- Alternativ zwei Vial-Reihen `1-4` und `5-8` plus Testkammer darunter.
- Touch-Ziele fuer Play, Refill und Maintenance mindestens fingerfreundlich.
- Wichtige Werte nicht ausschliesslich ueber Hover/Tooltip erklaeren.

### Offene visuelle Punkte

- Tropfen muessen exakt aus der Nadelspitze und mittig in die Testkammer fallen.
- Messblitz in der Testkammer soll sichtbarer werden.
- Teststart-Buttons sollten waehrend laufender Tests konsequent blockieren.
- Alarmdialog zeigt aktuell nur Daten, die die Integration als Alarm Logs oder
  Notifications liefert. Die Original-Webseite scheint teils weitere
  Statusmeldungen zu haben; dafuer braucht es noch einen frischen HAR der
  Alarmglocke/Statusseite.

## App-Architekturvorschlag

### Variante A: Direkt gegen Reef Kinetics Cloud

Die App implementiert Login, Token-Speicherung, Discovery, Polling und Write-Actions selbst.

Vorteile:

- Funktioniert unabhaengig von Home Assistant.
- Groesserer Markt, da nicht nur HA-Nutzer.
- UI kann sehr frei und performant gebaut werden.

Nachteile:

- Undokumentierte API kann brechen.
- Credentials/Token-Sicherheit muss nativ sauber geloest werden.
- Push/Background-Refresh muss je Plattform korrekt gebaut werden.

### Variante B: Companion-App fuer Home Assistant

Die App nutzt HA-Entities und HA-Services.

Vorteile:

- Auth/Sicherheit ueber HA.
- Integration ist schon Daten- und Write-Layer.
- Weniger Reverse-Engineering in der App.

Nachteile:

- Zielgruppe kleiner.
- Ohne HA nicht nutzbar.

### Variante C: Gemeinsame Core-Library

Eine kleine TypeScript/Kotlin/Swift-unabhaengige Spezifikation oder OpenAPI-nahe Dokumentation fuer die Reef-Kinetics-API, plus separate Clients.

Empfehlung:

- Fuer eine kommerzielle Consumer-App eher Variante A.
- Fuer schnelle Prototypen und Validierung Variante B.
- Langfristig API-Client-Logik klar von UI trennen, damit Android/iOS denselben Datenbegriff nutzen.

## UI-Konzept fuer Mobile

Die aktuelle Panel-Struktur kann fast direkt in Mobile uebernommen werden:

1. Startscreen als grafischer ReefBot.
2. Oben:
   - Online/Offline
   - aktueller Vorgang
   - verbleibende Zeit
   - Alarmindikator
3. Mitte:
   - Vials 1-8 mit Fuellstand, Chemikalienname und Refill-Aktion.
   - Test Chamber rechts bzw. auf Mobile als prominenter Bereich unter/zwischen Vials.
4. Tests:
   - Kacheln fuer konfigurierte Tests.
   - aktueller Wert, Einheit, letzter Verlauf.
   - Start mit Confirmation.
5. Wartung:
   - RODI Refill
   - Waste Empty
   - Syringe Replace
   - Kapazitaeten setzen, falls API erlaubt.

Mobile UX:

- Teststart immer mit Confirmation.
- Refill/Reset immer mit Confirmation.
- Disable/Busy-State, wenn Pending Operations vorhanden sind.
- Nach Write-Actions mehrere Refreshes.
- Alarme/Notifications als eigene Liste, nicht nur Zahl.
- Klar zwischen `Live`, `Pending`, `Last` und `Idle` unterscheiden.

## Bekannte Risiken

- API ist undocumented und kann sich aendern.
- Endpoint-Namen und Payload-Casing sind inkonsistent.
- Manche Response-Collections liegen unter verschiedenen Keys (`Data`, `Results`, `results`, etc.).
- Alarm-/Notification-Daten sind noch nicht vollstaendig validiert.
- Calibration und Setup-Tests sind noch nicht als Write-Flow analysiert.
- Multi-Tank/Multi-Device ist nur teilweise vorbereitet.
- Testdauer-Tabelle ist hardcodiert und sollte bei weiteren Testtypen erweitert werden.
- Das offizielle Dashboard erlaubt ggf. Aktionen, die nicht sofort am Device sichtbar werden.

## Offene Analysepunkte

- Calibration starten und Pending Calibration sauber interpretieren.
- Test-Setup speichern:
  - konfigurierte Tests auswaehlen/abwaehlen.
  - Chemical Positions aendern.
  - Source Settings aendern.
- Schedule-Endpunkte analysieren.
- Manual Result Flow analysieren.
- Alarmglocke/Notification-Menue im Webdashboard mit HAR erneut erfassen.
- Genau klaeren, welche Operationen im Busy-State parallel gestartet werden duerfen. Aktuell konservativ: keine weiteren Tests starten, wenn Pending Operations > 0.
- Multi-Device Accounts testen.

## Empfohlene Analyse-Vorgehensweise fuer neue Sessions

1. In Chrome/Browser Developer Tools `Preserve log` aktivieren.
2. Gewuenschte Dashboard-Seite aufrufen.
3. Nur eine Aktion ausfuehren.
4. HAR exportieren.
5. Request-Namen, Payload und Response dokumentieren.
6. Secrets/Tokens vor Commit redaktieren.
7. Erst Read-Endpunkte implementieren.
8. Write-Endpunkte nur mit Confirmation und Refresh-Strategie implementieren.

Wenn Browser-Automation in Codex verfuegbar ist:

- Codex Browser/Chrome Connector nutzen.
- Nutzer klickt im echten eingeloggten Browser oder Codex klickt read-only.
- Console/Network/HAR gemeinsam auswerten.

## Validierung im HA-Repo

Vor Commit:

```bash
node --check custom_components/reefbot/frontend/reefbot-panel.js
python3 -m py_compile custom_components/reefbot/*.py
python3 -m json.tool custom_components/reefbot/manifest.json
git diff --check
```

Fuer HACS-visible Releases:

1. `manifest.json` Version bumpen.
2. `panel.py` `PANEL_VERSION` auf dieselbe Version setzen.
3. Commit erstellen.
4. Tag erstellen, z. B. `v0.12.21`.
5. `git push origin main --tags`.
6. GitHub Release fuer den Tag erstellen.

## Aktuelle Produktidee

Die bessere App koennte fuer ReefBot-Besitzer attraktiv sein, weil:

- Original-Web/App-UX ist stark fragmentiert.
- Viele wichtige Informationen liegen verteilt in Untermenues.
- Wartung und Teststart brauchen eine geraetezentrierte Ansicht.
- Grafische Fuellstands- und Testkammerdarstellung macht den Zustand sofort begreifbar.
- Eine gute Mobile-App kann echte Convenience liefern: Test starten, Fortschritt sehen, Reagenzien/Waste/RODI warten, Alarme verstehen.

Das HA-Panel ist der laufende UX-Prototyp. Eine native App sollte dieselben Kernprinzipien uebernehmen, aber mit nativer Navigation, Push Notifications und sicherem Credential Storage.
