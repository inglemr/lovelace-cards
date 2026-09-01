# Homelab Lovelace Cards

A self-owned stable of custom [Home Assistant](https://www.home-assistant.io/) Lovelace cards — built to replace paid dashboard modules with cards we maintain ourselves. Everything ships in a **single bundle** (`homelab-cards.js`) that registers every custom element, so it's one HACS entry and one dashboard resource.

## Cards

| Card | Element | Status |
|------|---------|--------|
| PHEV Vehicle Card | `custom:phev-vehicle-card` | ✅ v0.1 |
| Battery Fleet Card | `custom:battery-fleet-card` | 🔜 planned |
| Laundry Tracker Card | `custom:laundry-tracker-card` | 🔜 planned |

### `phev-vehicle-card`

A plug-in-hybrid hero card: rendered vehicle image, dual **Electric + Fuel** gauges (SoC % + EV range / tank % + litres + fuel range), a charging strip (state, time-to-full, power, session kWh), a status row (lock, doors, windows, climate, hood, boot) and an odometer + home/away footer.

Ships with defaults wired to a BMW 330e, so the minimal config just works:

```yaml
type: custom:phev-vehicle-card
```

Everything is overridable:

```yaml
type: custom:phev-vehicle-card
name: 330e
image_entity: image.wba5x72070fj31363
electric:
  soc: sensor.wba5x72070fj31363_charging_ev_predicted_state_of_charge
  range: sensor.front_330e_range_ev_remaining_range
fuel:
  level: sensor.front_330e_range_tank_level
  litres: sensor.front_330e_range_tank_level_2
total_range: sensor.front_330e_range_total_range_last_sent
odometer: sensor.front_330e_vehicle_mileage
location: device_tracker.front_330e
lock: sensor.front_330e_doors_overall_state
charging:
  state: sensor.wba5x72070fj31363_charging_ev_charging_state
  plug: sensor.front_330e_charging_port_plug_state
  time_to_full: sensor.front_330e_charging_ev_time_to_full_charge
  ac_current: sensor.wba5x72070fj31363_charging_ev_ac_charging_current
  ac_voltage: sensor.wba5x72070fj31363_charging_ev_ac_charging_voltage
  session_energy: sensor.wba5x72070fj31363_charged_energy_session
doors: [binary_sensor.front_330e_door_state_front_driver, ...]
windows: [sensor.front_330e_window_state_front_driver, ...]
statuses:
  - entity: binary_sensor.front_330e_charging_ev_climatization_active
    name: Climate
    icon: mdi:air-conditioner
    good: [on]
```

## Development

```bash
npm install
npm run build      # → dist/homelab-cards.js
npm run watch      # rebuild on change
npm run typecheck
```

Node version is pinned in `.tool-versions` (nodejs 22.11.0).

## Install in Home Assistant

**Via HACS** (custom repository → this repo, category *Dashboard/Lovelace*), or manually: copy `dist/homelab-cards.js` to `config/www/` and add a dashboard resource for `/local/homelab-cards.js` (module).

Releases: push a `vX.Y.Z` tag → GitHub Actions builds the bundle and attaches it to the release for HACS.

## License

MIT
