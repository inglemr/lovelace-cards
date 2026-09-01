import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { HomeAssistant } from "../../shared/ha";
import {
  stateStr,
  stateNum,
  entityPicture,
  moreInfo,
  pct,
  isUnknown,
} from "../../shared/ha";
import { DEFAULTS, type PhevVehicleCardConfig, type StatusChipConfig } from "./config";
import { styles } from "./styles";

const CHARGING_STATES = ["charging", "ac_charging", "dc_charging", "chargingactive", "charging_active"];

function isCharging(s?: string): boolean {
  if (!s) return false;
  const l = s.toLowerCase();
  if (l.includes("ended") || l.includes("finished") || l.includes("complete")) return false;
  return CHARGING_STATES.some((c) => l.includes(c)) || l === "charging";
}

function isSecured(s?: string): boolean {
  if (!s) return false;
  const l = s.toLowerCase();
  return l === "secured" || l === "locked" || l === "closed";
}

function fmtDuration(mins?: number): string | undefined {
  if (mins === undefined || mins <= 0) return undefined;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

@customElement("phev-vehicle-card")
export class PhevVehicleCard extends LitElement {
  static styles = styles;

  @state() private config!: PhevVehicleCardConfig;
  private _hass?: HomeAssistant;

  @property({ attribute: false })
  set hass(hass: HomeAssistant) {
    this._hass = hass;
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): PhevVehicleCardConfig {
    return { type: "custom:phev-vehicle-card" };
  }

  setConfig(config: PhevVehicleCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    // Merge shallow-with-nested against the baked 330e defaults.
    this.config = {
      ...config,
      name: config.name ?? DEFAULTS.name,
      image_entity: config.image_entity ?? DEFAULTS.image_entity,
      electric: { ...DEFAULTS.electric, ...(config.electric ?? {}) },
      fuel: { ...DEFAULTS.fuel, ...(config.fuel ?? {}) },
      total_range: config.total_range ?? DEFAULTS.total_range,
      odometer: config.odometer ?? DEFAULTS.odometer,
      location: config.location ?? DEFAULTS.location,
      lock: config.lock ?? DEFAULTS.lock,
      charging: { ...DEFAULTS.charging, ...(config.charging ?? {}) },
      statuses: config.statuses ?? DEFAULTS.statuses,
      doors: config.doors ?? DEFAULTS.doors,
      windows: config.windows ?? DEFAULTS.windows,
    };
  }

  getCardSize(): number {
    return 6;
  }

  private _more(entityId?: string) {
    if (entityId && this._hass?.states[entityId]) moreInfo(this, entityId);
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const hass = this._hass;
    const c = this.config;

    const chargeState = stateStr(hass, c.charging?.state);
    const charging = isCharging(chargeState);
    const plugState = stateStr(hass, c.charging?.plug);
    const plugged = charging || (plugState ? plugState.toLowerCase() === "connected" : false);

    return html`
      <ha-card>
        ${this._renderHeader(charging, plugged)}
        ${this._renderHero()}
        <div class="gauges">
          ${this._renderElectric()}
          ${this._renderFuel()}
        </div>
        ${plugged ? this._renderChargeStrip(chargeState, charging) : nothing}
        ${this._renderStatuses()}
        ${this._renderFooter()}
      </ha-card>
    `;
  }

  private _renderHeader(charging: boolean, plugged: boolean): TemplateResult {
    const hass = this._hass!;
    const c = this.config;
    const lock = stateStr(hass, c.lock);
    const secured = isSecured(lock);
    const showLock = lock !== undefined;

    return html`
      <div class="header">
        <div class="title"><span class="brand">BMW</span>${c.name}</div>
        <div class="spacer"></div>
        ${charging
          ? html`<span class="pill charge"><ha-icon icon="mdi:flash"></ha-icon>Charging</span>`
          : plugged
            ? html`<span class="pill charge"><ha-icon icon="mdi:power-plug"></ha-icon>Plugged in</span>`
            : nothing}
        ${showLock
          ? html`<span
              class=${classMap({ pill: true, good: secured, alert: !secured })}
              @click=${() => this._more(c.lock)}
            >
              <ha-icon icon=${secured ? "mdi:lock" : "mdi:lock-open-variant"}></ha-icon>
              ${secured ? "Secured" : "Unlocked"}
            </span>`
          : nothing}
      </div>
    `;
  }

  private _renderHero(): TemplateResult {
    const hass = this._hass!;
    const c = this.config;
    const pic = c.image_entity ? entityPicture(hass, c.image_entity) : c.image;
    return html`
      <div class="hero">
        ${pic
          ? html`<img src=${pic} alt=${c.name ?? "vehicle"} @click=${() => this._more(c.image_entity)} />`
          : html`<ha-icon class="noimg" icon="mdi:car-sports"></ha-icon>`}
      </div>
    `;
  }

  private _renderElectric(): TemplateResult {
    const hass = this._hass!;
    const c = this.config;
    const soc = stateNum(hass, c.electric?.soc);
    const range = stateNum(hass, c.electric?.range);
    return html`
      <div class="gauge" @click=${() => this._more(c.electric?.soc ?? c.electric?.range)}>
        <div class="gauge-top">
          <ha-icon icon="mdi:lightning-bolt" style="color:var(--pv-elec)"></ha-icon>
          <span class="lbl">${c.electric?.name ?? "Electric"}</span>
          ${range !== undefined ? html`<span class="sub">· ${Math.round(range)} km range</span>` : nothing}
          <span class="spacer"></span>
          <span class="val">${soc !== undefined ? Math.round(soc) : "–"}<small>%</small></span>
        </div>
        <div class="track">
          <div class="fill elec" style=${styleMap({ width: `${pct(soc)}%` })}></div>
        </div>
      </div>
    `;
  }

  private _renderFuel(): TemplateResult {
    const hass = this._hass!;
    const c = this.config;
    const level = stateNum(hass, c.fuel?.level);
    const litres = stateNum(hass, c.fuel?.litres);
    let range = stateNum(hass, c.fuel?.range);
    if (range === undefined) {
      const total = stateNum(hass, c.total_range);
      const ev = stateNum(hass, c.electric?.range);
      if (total !== undefined && ev !== undefined) range = Math.max(0, total - ev);
    }
    const sub = [
      litres !== undefined ? `${Math.round(litres)} L` : undefined,
      range !== undefined ? `${Math.round(range)} km range` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    return html`
      <div class="gauge" @click=${() => this._more(c.fuel?.level ?? c.fuel?.litres)}>
        <div class="gauge-top">
          <ha-icon icon="mdi:gas-station" style="color:var(--pv-fuel)"></ha-icon>
          <span class="lbl">${c.fuel?.name ?? "Fuel"}</span>
          ${sub ? html`<span class="sub">· ${sub}</span>` : nothing}
          <span class="spacer"></span>
          <span class="val">${level !== undefined ? Math.round(level) : "–"}<small>%</small></span>
        </div>
        <div class="track">
          <div class="fill fuel" style=${styleMap({ width: `${pct(level)}%` })}></div>
        </div>
      </div>
    `;
  }

  private _renderChargeStrip(chargeState: string | undefined, charging: boolean): TemplateResult {
    const hass = this._hass!;
    const c = this.config;
    const ttf = fmtDuration(stateNum(hass, c.charging?.time_to_full));
    const amps = stateNum(hass, c.charging?.ac_current);
    const volts = stateNum(hass, c.charging?.ac_voltage);
    const session = stateNum(hass, c.charging?.session_energy);
    const powerKw = amps !== undefined && volts !== undefined && volts > 0
      ? (amps * volts * 3) / 1000 // 3-phase AC
      : undefined;

    const items: TemplateResult[] = [];
    if (chargeState) {
      const label = chargeState.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase());
      items.push(html`<span class="ci"><ha-icon icon="mdi:ev-station"></ha-icon><b>${label}</b></span>`);
    }
    if (charging && ttf) items.push(html`<span class="ci"><ha-icon icon="mdi:timer-sand"></ha-icon><b>${ttf}</b> <span>to full</span></span>`);
    if (powerKw !== undefined && powerKw > 0.1)
      items.push(html`<span class="ci"><ha-icon icon="mdi:flash"></ha-icon><b>${powerKw.toFixed(1)}</b> <span>kW</span></span>`);
    else if (amps !== undefined && amps > 0)
      items.push(html`<span class="ci"><ha-icon icon="mdi:flash"></ha-icon><b>${amps.toFixed(0)}</b> <span>A</span></span>`);
    if (session !== undefined)
      items.push(html`<span class="ci"><ha-icon icon="mdi:battery-charging"></ha-icon><b>${session.toFixed(1)}</b> <span>kWh session</span></span>`);

    if (!items.length) return nothing as unknown as TemplateResult;
    return html`<div class="charge-strip">${items}</div>`;
  }

  private _chip(icon: string, label: string, tone: "good" | "alert" | "muted", onClick?: () => void): TemplateResult {
    return html`
      <span
        class=${classMap({ pill: true, good: tone === "good", alert: tone === "alert" })}
        @click=${onClick ?? nothing}
      >
        <ha-icon icon=${icon}></ha-icon>${label}
      </span>
    `;
  }

  private _summaryChip(entities: string[] | undefined, label: string, iconClosed: string, iconOpen: string): TemplateResult | typeof nothing {
    const hass = this._hass!;
    if (!entities?.length) return nothing;
    const present = entities.filter((e) => !isUnknown(hass, e));
    if (!present.length) return nothing;
    const open = present.filter((e) => {
      const s = stateStr(hass, e)!.toLowerCase();
      return s === "on" || s === "open" || s === "opened";
    });
    return open.length
      ? this._chip(iconOpen, `${open.length} ${label} open`, "alert")
      : this._chip(iconClosed, `${label} closed`, "good");
  }

  private _statusChip(cfg: StatusChipConfig): TemplateResult | typeof nothing {
    const hass = this._hass!;
    if (isUnknown(hass, cfg.entity)) return nothing;
    const s = stateStr(hass, cfg.entity)!.toLowerCase();
    const good = (cfg.good ?? []).map((x) => x.toLowerCase()).includes(s);
    const alert = (cfg.alert ?? []).map((x) => x.toLowerCase()).includes(s);
    const tone: "good" | "alert" | "muted" = alert ? "alert" : good ? "good" : "muted";
    const label = cfg.name ?? cfg.entity;
    return this._chip(cfg.icon ?? "mdi:information-outline", label, tone, () => this._more(cfg.entity));
  }

  private _renderStatuses(): TemplateResult {
    const c = this.config;
    return html`
      <div class="statuses">
        ${this._summaryChip(c.doors, "Doors", "mdi:car-door-lock", "mdi:car-door")}
        ${this._summaryChip(c.windows, "Windows", "mdi:car-windshield", "mdi:window-open-variant")}
        ${(c.statuses ?? []).map((s) => this._statusChip(s))}
      </div>
    `;
  }

  private _renderFooter(): TemplateResult {
    const hass = this._hass!;
    const c = this.config;
    const odo = stateNum(hass, c.odometer);
    const loc = stateStr(hass, c.location);
    const atHome = loc ? loc.toLowerCase() === "home" : false;
    const locLabel = loc ? (atHome ? "Home" : loc.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase())) : undefined;
    return html`
      <div class="footer">
        ${odo !== undefined
          ? html`<span class="odo" @click=${() => this._more(c.odometer)}>${odo.toLocaleString()}<small>km</small></span>`
          : nothing}
        <span class="spacer"></span>
        ${locLabel !== undefined
          ? html`<span
              class=${classMap({ loc: true, home: atHome })}
              @click=${() => this._more(c.location)}
            >
              <ha-icon icon=${atHome ? "mdi:home" : "mdi:map-marker"}></ha-icon>${locLabel}
            </span>`
          : nothing}
      </div>
    `;
  }
}

// Register in the card picker.
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "phev-vehicle-card",
  name: "PHEV Vehicle Card",
  description: "Plug-in hybrid hero card: image, dual electric+fuel gauges, charging, status & odometer.",
  preview: true,
});
