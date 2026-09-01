import type { LovelaceCardConfig } from "custom-card-helpers";

export type TabId = "overview" | "tyres" | "charging" | "history";

export interface StatusChipConfig {
  entity: string;
  name: string;
  icon?: string;
  /** "opening": on/open ⇒ red "X open", else green "X closed".
   *  "onoff":   on ⇒ blue on_label, off ⇒ muted off_label. */
  kind?: "opening" | "onoff";
  on_label?: string;
  off_label?: string;
  on_icon?: string;
}

export interface TyreCorner {
  pressure?: string;
  target?: string;
}

export interface PhevVehicleCardConfig extends LovelaceCardConfig {
  type: string;
  name?: string;
  default_tab?: TabId;

  image_entity?: string;
  image?: string;

  electric?: { soc?: string; range?: string; name?: string };
  fuel?: { level?: string; litres?: string; range?: string; name?: string };
  total_range?: string;

  odometer?: string;
  location?: string;
  lock?: string;
  stream_status?: string; // connection sensor, for data-freshness

  charging?: {
    state?: string;
    plug?: string;
    time_to_full?: string;
    ac_current?: string;
    ac_voltage?: string;
    session_energy?: string;
    month_energy?: string;
    total_energy?: string;
    target_soc?: string;
    phases?: string;
  };

  tyres?: { front_left?: TyreCorner; front_right?: TyreCorner; rear_left?: TyreCorner; rear_right?: TyreCorner };

  trips?: {
    avg_consumption?: string;
    electric_share?: string;
    eco_share?: string;
    battery_health?: string;
    hv_energy?: string;
  };

  /** Two %-scale entities plotted together in the History tab. */
  history?: { electric?: string; fuel?: string };

  statuses?: StatusChipConfig[];
  doors?: string[];
  windows?: string[];
}

const E = "sensor.front_330e_";
const W = "sensor.wba5x72070fj31363_";

/** Defaults wired to Matt's BMW 330e so a bare `type:` config just works. */
export const DEFAULTS = {
  name: "330e",
  default_tab: "overview" as TabId,
  image_entity: "image.wba5x72070fj31363",
  electric: {
    soc: `${W}charging_ev_predicted_state_of_charge`,
    range: `${E}range_ev_remaining_range`,
    name: "Electric",
  },
  fuel: {
    level: `${E}range_tank_level`,
    litres: `${E}range_tank_level_2`,
    name: "Fuel",
  },
  total_range: `${E}range_total_range_last_sent`,
  odometer: `${E}vehicle_mileage`,
  location: "device_tracker.front_330e",
  lock: `${E}doors_overall_state`,
  stream_status: "sensor.bmw_stream_data",
  charging: {
    state: `${W}charging_ev_charging_state`,
    plug: `${E}charging_port_plug_state`,
    time_to_full: `${E}charging_ev_time_to_full_charge`,
    ac_current: `${W}charging_ev_ac_charging_current`,
    ac_voltage: `${W}charging_ev_ac_charging_voltage`,
    session_energy: `${W}charged_energy_session`,
    month_energy: `${W}charging_energy_this_month`,
    total_energy: `${W}charged_energy_total`,
    target_soc: `${W}battery_ev_target_state_of_charge`,
    phases: `${W}charging_ev_charging_phases`,
  },
  tyres: {
    front_left: { pressure: `${E}tire_pressure_front_left`, target: `${E}tire_pressure_target_front_left` },
    front_right: { pressure: `${E}tire_pressure_front_right`, target: `${E}tire_pressure_target_front_right` },
    rear_left: { pressure: `${E}tire_pressure_rear_left`, target: `${E}tire_pressure_target_rear_left` },
    rear_right: { pressure: `${E}tire_pressure_rear_right`, target: `${E}tire_pressure_target_rear_right` },
  },
  trips: {
    avg_consumption: `${E}range_ev_average_electric_consumption`,
    electric_share: `${E}trip_electric_share`,
    eco_share: `${E}trip_eco_pro_mode_share`,
    battery_health: `${W}battery_health`,
    hv_energy: `${W}battery_hv_energy_content`,
  },
  history: {
    electric: `${W}charging_ev_predicted_state_of_charge`,
    fuel: `${E}range_tank_level`,
  },
  statuses: [
    { entity: "binary_sensor.front_330e_hood_state", name: "Bonnet", kind: "opening" as const, icon: "mdi:engine-outline" },
    { entity: "binary_sensor.front_330e_tailgate_state", name: "Boot", kind: "opening" as const, icon: "mdi:car-back" },
    {
      entity: "binary_sensor.front_330e_charging_ev_climatization_active",
      name: "Climate",
      kind: "onoff" as const,
      on_label: "Climate on",
      off_label: "Climate off",
      icon: "mdi:air-conditioner",
    },
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
