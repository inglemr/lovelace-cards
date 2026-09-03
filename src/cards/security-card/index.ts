import { LitElement, html, nothing, css } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo } from "../../shared/ha";

interface DoorSpec { entity: string; name?: string }
interface SecurityConfig extends LovelaceCardConfig {
  type: string;
  camera?: string;
  lock?: string;
  person?: string; // doorbell person-detection binary_sensor
  motion?: string; // doorbell motion binary_sensor
  doors?: DoorSpec[]; // door/window contact sensors (on = open)
  cameras_path?: string; // navigation target for the live view
}

const DEFAULTS = {
  camera: "camera.doorbell_fluent",
  lock: "lock.front_door",
  person: "binary_sensor.doorbell_person",
  motion: "binary_sensor.doorbell_motion",
  cameras_path: "/lovelace/cameras",
};

@customElement("security-card")
export class SecurityCard extends LitElement {
  @state() private config!: SecurityConfig;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.toggleAttribute("dark", !!(h?.themes as any)?.darkMode);
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): SecurityConfig {
    return { type: "custom:security-card" };
  }

  setConfig(config: SecurityConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = { ...DEFAULTS, ...config };
  }

  getCardSize(): number {
    return 3;
  }

  private _on(e?: string): boolean {
    return !!e && this._hass?.states[e]?.state === "on";
  }
  private _lock(action: "lock" | "unlock") {
    if (!this.config.lock || !this._hass) return;
    this._hass.callService("lock", action, { entity_id: this.config.lock });
  }
  private _openCameras() {
    const ev = new Event("location-changed", { bubbles: true, composed: true });
    history.pushState(null, "", this.config.cameras_path || "/lovelace/cameras");
    this.dispatchEvent(ev);
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const c = this.config;
    const cam = c.camera ? this._hass.states[c.camera] : undefined;
    const snap = cam?.attributes.entity_picture;
    const locked = c.lock ? this._hass.states[c.lock]?.state === "locked" : false;
    const person = this._on(c.person);
    const motion = this._on(c.motion);
    const doors = (c.doors ?? []).filter((d) => this._hass!.states[d.entity]);
    const open = doors.filter((d) => this._hass!.states[d.entity].state === "on");

    // headline: person > motion > all-quiet
    const alert = person || motion;
    const headline = person ? "Someone's at the door" : motion ? "Motion at the door" : "All quiet";

    return html`
      <ha-card class=${classMap({ alert })}>
        <button class="cam" @click=${() => this._openCameras()} style=${styleMap(snap ? { backgroundImage: `url("${snap}")` } : {})}>
          ${snap ? nothing : html`<ha-icon icon="mdi:cctv"></ha-icon>`}
          <span class="scrim"></span>
          <span class="headline ${classMap({ alert })}"><ha-icon icon=${person ? "mdi:account-alert" : motion ? "mdi:motion-sensor" : "mdi:shield-check"}></ha-icon>${headline}</span>
          <span class="live"><ha-icon icon="mdi:arrow-expand"></ha-icon>Live</span>
        </button>

        <div class="row">
          <button class="lock ${classMap({ locked })}" @click=${() => (locked ? this._lock("unlock") : this._lock("lock"))} @contextmenu=${(e: Event) => { e.preventDefault(); this._more(c.lock); }}>
            <ha-icon icon=${locked ? "mdi:lock" : "mdi:lock-open-variant"}></ha-icon>
            <span class="ltext"><b>Front door</b><small>${locked ? "Locked · tap to unlock" : "Unlocked · tap to lock"}</small></span>
          </button>
          ${doors.length
            ? html`<button class="doors ${classMap({ open: open.length > 0 })}" @click=${() => this._more(open[0]?.entity ?? doors[0].entity)}>
                <ha-icon icon=${open.length ? "mdi:door-open" : "mdi:door-closed-lock"}></ha-icon>
                <span class="dtext">${open.length ? `${open.length} open` : "All closed"}</span>
              </button>`
            : nothing}
        </div>
      </ha-card>
    `;
  }

  private _more(e?: string) {
    if (e && this._hass?.states[e]) moreInfo(this, e);
  }

  static styles = [hearth, css`
    ha-card {
      border-radius: var(--hl-r-card); padding: 10px; overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent);
      background: var(--ha-card-background, var(--card-background-color, #16181d));
      box-shadow: var(--hl-e1); transition: border-color var(--hl-d4) var(--hl-settle), box-shadow var(--hl-d4) var(--hl-settle);
    }
    ha-card.alert { border-color: color-mix(in srgb, var(--hl-amber) 45%, transparent); box-shadow: var(--hl-e1), 0 0 0 1px color-mix(in srgb, var(--hl-amber) 20%, transparent), 0 10px 30px -10px rgb(245 179 1 / .3); }
    button { -webkit-appearance: none; appearance: none; font-family: inherit; border: none; background: none; padding: 0; margin: 0; cursor: pointer; color: inherit; }

    .cam { position: relative; display: block; width: 100%; height: 168px; border-radius: 16px; overflow: hidden;
      background-size: cover; background-position: center; background-color: color-mix(in oklab, rgb(var(--hl-ember)) 8%, var(--card-background-color, #fff));
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / .08); }
    .cam > ha-icon { position: absolute; inset: 0; margin: auto; --mdc-icon-size: 40px; color: var(--hl-text-3); }
    .scrim { position: absolute; inset: 0; background: linear-gradient(0deg, rgb(0 0 0 / .55), transparent 45%); pointer-events: none; }
    .headline { position: absolute; left: 12px; bottom: 11px; display: inline-flex; align-items: center; gap: 6px; color: #fff; font-size: 14px; font-weight: 700; text-shadow: 0 1px 3px rgb(0 0 0 / .5); }
    .headline ha-icon { --mdc-icon-size: 18px; }
    .headline.alert { color: color-mix(in srgb, var(--hl-amber) 55%, #fff); }
    .live { position: absolute; right: 10px; top: 10px; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: #fff;
      padding: 4px 9px; border-radius: 999px; background: rgb(0 0 0 / .4); backdrop-filter: blur(4px); }
    .live ha-icon { --mdc-icon-size: 13px; }

    .row { display: flex; gap: 8px; margin-top: 8px; }
    .lock, .doors { display: inline-flex; align-items: center; gap: 10px; padding: 11px 13px; border-radius: var(--hl-r-inner);
      background: color-mix(in oklab, rgb(var(--hl-ember)) 5%, var(--card-background-color, #fff)); box-shadow: inset 0 1.5px 3px rgb(var(--hl-ember) / .07), inset 0 -1px 0 rgb(255 255 255 / .5);
      transition: transform var(--hl-d1) var(--hl-shift), background var(--hl-d2) var(--hl-settle); }
    :host([dark]) .lock, :host([dark]) .doors { background: color-mix(in oklab, black 20%, var(--card-background-color, #16181d)); box-shadow: inset 0 1.5px 3px rgb(0 0 0 / .35); }
    .lock { flex: 1; }
    .lock:active, .doors:active { transform: scale(.98); }
    .lock ha-icon { --mdc-icon-size: 22px; color: var(--hl-text-2); flex: 0 0 auto; }
    .lock.locked { background: linear-gradient(180deg, color-mix(in oklab, #34d399 16%, var(--card-background-color, #fff)), color-mix(in oklab, #34d399 24%, var(--card-background-color, #fff))); box-shadow: inset 0 1px 0 rgb(255 255 255 / .5), 0 2px 6px rgb(16 120 80 / .2); }
    .lock.locked ha-icon { color: #0f7a4d; }
    .ltext { display: flex; flex-direction: column; line-height: 1.25; text-align: left; min-width: 0; }
    .ltext b { font-size: 14px; font-weight: 700; }
    .ltext small { font-size: 11px; color: var(--hl-text-3); }
    .lock.locked .ltext small { color: color-mix(in srgb, #0f7a4d 70%, var(--primary-text-color)); }

    .doors { flex: 0 0 auto; flex-direction: column; gap: 3px; padding: 11px 14px; }
    .doors ha-icon { --mdc-icon-size: 20px; color: var(--hl-text-2); }
    .dtext { font-size: 11px; font-weight: 700; color: var(--hl-text-2); }
    .doors.open { background: linear-gradient(180deg, color-mix(in oklab, var(--hl-amber) 18%, var(--card-background-color, #fff)), color-mix(in oklab, var(--hl-amber) 26%, var(--card-background-color, #fff))); }
    .doors.open ha-icon, .doors.open .dtext { color: var(--hl-ink-on-amber); }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "security-card",
  name: "Security Card",
  description: "Doorbell snapshot (tap for live) + front-door lock + door-contact summary + at-the-door activity.",
  preview: true,
});
