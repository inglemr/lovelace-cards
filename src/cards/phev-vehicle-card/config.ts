import type { LovelaceCardConfig } from "custom-card-helpers";

export interface StatusChipConfig {
  entity: string;
  name?: string;
  icon?: string;
  /** States (case-insensitive) that render the chip in the "good"/accent tone. */
  good?: string[];
  /** States (case-insensitive) that render the chip in the "alert"/red tone. */
  alert?: string[];
}

export interface PhevVehicleCardConfig extends LovelaceCardConfig {
  type: string;
  name?: string;

  /** image.* / camera.* entity whose picture is the hero, or a static image url. */
  image_entity?: string;
  image?: string;

  electric?: {
    soc?: string; // %
    range?: string; // km
    name?: string;
  };
  fuel?: {
    level?: string; // %
    litres?: string; // L
    range?: string; // km (computed from total_range - electric.range when omitted)
    name?: string;
  };
  total_range?: string; // km, used to derive fuel range

  odometer?: string;
  location?: string; // device_tracker
  lock?: string;

  charging?: {
    state?: string;
    plug?: string;
    time_to_full?: string; // minutes
    ac_current?: string; // A
    ac_voltage?: string; // V
    session_energy?: string; // kWh
  };

  /** Single-entity status chips shown in the status row. */
  statuses?: StatusChipConfig[];
  /** Entity groups summarised into one chip ("Closed" / "N open"). */
  doors?: string[];
  windows?: string[];
}

/**
 * Defaults baked to Matt's BMW 330e so `type: custom:phev-vehicle-card` renders
 * with zero extra config. Every key is overridable from the dashboard YAML.
 */
export const DEFAULTS: Required<
  Pick<
    PhevVehicleCardConfig,
    "name" | "image_entity" | "electric" | "fuel" | "total_range" | "odometer" | "location" | "lock" | "charging" | "statuses" | "doors" | "windows"
  >
> = {
  name: "330e",
  image_entity: "image.wba5x72070fj31363",
  electric: {
    soc: "sensor.wba5x72070fj31363_charging_ev_predicted_state_of_charge",
    range: "sensor.front_330e_range_ev_remaining_range",
    name: "Electric",
  },
  fuel: {
    level: "sensor.front_330e_range_tank_level",
    litres: "sensor.front_330e_range_tank_level_2",
    name: "Fuel",
  },
  total_range: "sensor.front_330e_range_total_range_last_sent",
  odometer: "sensor.front_330e_vehicle_mileage",
  location: "device_tracker.front_330e",
  lock: "sensor.front_330e_doors_overall_state",
  charging: {
    state: "sensor.wba5x72070fj31363_charging_ev_charging_state",
    plug: "sensor.front_330e_charging_port_plug_state",
    time_to_full: "sensor.front_330e_charging_ev_time_to_full_charge",
    ac_current: "sensor.wba5x72070fj31363_charging_ev_ac_charging_current",
    ac_voltage: "sensor.wba5x72070fj31363_charging_ev_ac_charging_voltage",
    session_energy: "sensor.wba5x72070fj31363_charged_energy_session",
  },
  statuses: [
    { entity: "binary_sensor.front_330e_charging_ev_climatization_active", name: "Climate", icon: "mdi:air-conditioner", good: ["on"] },
    { entity: "binary_sensor.front_330e_hood_state", name: "Hood", icon: "mdi:car", good: ["off"], alert: ["on"] },
    { entity: "binary_sensor.front_330e_tailgate_state", name: "Boot", icon: "mdi:car-back", good: ["off"], alert: ["on"] },
  ],
  doors: [
    "binary_sensor.front_330e_door_state_front_driver",
    "binary_sensor.front_330e_door_state_front_passenger",
    "binary_sensor.front_330e_door_state_rear_driver",
    "binary_sensor.front_330e_door_state_rear_passenger",
  ],
  windows: [
    "sensor.front_330e_window_state_front_driver",
    "sensor.front_330e_window_state_front_passenger",
    "sensor.front_330e_window_state_rear_driver",
    "sensor.front_330e_window_state_rear_passenger",
  ],
};
