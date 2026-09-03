import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo } from "../../shared/ha";

interface LightSpec {
  entity: string;
  name?: string;
}
interface RoomCardConfig extends LovelaceCardConfig {
  type: string;
  name: string;
  icon?: string;
  lights?: (string | LightSpec)[];
  media?: string;
  temperature?: string;
  navigation_path?: string; // room popup hash
  accent?: string;
}

const ON = new Set(["on", "playing", "open", "home"]);

@customElement("homelab-room-card")
export class RoomCard extends LitElement {
  @state() private config!: RoomCardConfig;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): RoomCardConfig {
    return { type: "custom:homelab-room-card", name: "Room", lights: [] };
  }

  setConfig(config: RoomCardConfig): void {
    if (!config || !config.name) throw new Error("homelab-room-card: 'name' is required");
    this.config = { icon: "mdi:sofa-outline", accent: "#f5b301", ...config };
  }

  getCardSize(): number {
    return 2;
  }

  private get _lights(): LightSpec[] {
    return (this.config.lights ?? []).map((l) => (typeof l === "string" ? { entity: l } : l));
  }
  private _isOn(entity: string): boolean {
    const s = this._hass?.states[entity];
    return !!s && s.state === "on";
  }
  private get _onLights(): LightSpec[] {
    return this._lights.filter((l) => this._isOn(l.entity));
  }
  private get _present(): LightSpec[] {
    return this._lights.filter((l) => {
      const st = this._hass?.states[l.entity]?.state;
      return st !== undefined && st !== "unavailable";
    });
  }
  private get _dimmable(): string[] {
    return this._lights
      .filter((l) => {
        const a = this._hass?.states[l.entity]?.attributes ?? {};
        const modes: string[] = a.supported_color_modes ?? [];
        return a.brightness != null || modes.some((m) => m !== "onoff");
      })
      .map((l) => l.entity);
  }

  private _brightnessPct(): number | undefined {
    const on = this._onLights.map((l) => this._hass!.states[l.entity]).filter((s) => s?.attributes?.brightness != null);
    if (!on.length) return undefined;
    const avg = on.reduce((s, e) => s + Number(e.attributes.brightness), 0) / on.length;
    return Math.round((avg / 255) * 100);
  }

  private _toggleAll(e: Event) {
    e.stopPropagation();
    if (!this._hass) return;
    const ids = this._present.map((l) => l.entity);
    if (!ids.length) return;
    const anyOn = this._onLights.length > 0;
    this._hass.callService("light", anyOn ? "turn_off" : "turn_on", { entity_id: ids });
  }
  private _toggleOne(entity: string, e: Event) {
    e.stopPropagation();
    this._hass?.callService("light", "toggle", { entity_id: entity });
  }
  private _setBrightness(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    const ids = this._dimmable;
    if (!ids.length || !this._hass) return;
    this._hass.callService("light", "turn_on", { entity_id: ids, brightness_pct: val });
  }
  private _openRoom() {
    const path = this.config.navigation_path;
    if (path) {
      history.replaceState(null, "", path.startsWith("#") ? path : `#${path}`);
      window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: true } }));
    }
  }
  private _more(entity?: string) {
    if (entity && this._hass?.states[entity]) moreInfo(this, entity);
  }

  private _shortName(l: LightSpec): string {
    if (l.name) return l.name;
    const fn = this._hass?.states[l.entity]?.attributes?.friendly_name ?? l.entity;
    // drop a leading room-name prefix for compactness
    return fn.replace(new RegExp(`^${this.config.name}\\s+`, "i"), "").trim() || fn;
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const c = this.config;
    const onCount = this._onLights.length;
    const total = this._present.length;
    const anyOn = onCount > 0;
    const bright = this._brightnessPct();
    const accent = c.accent!;

    return html`
      <ha-card class=${classMap({ active: anyOn })} style=${styleMap({ "--room-accent": accent })}>
        <div class="head" @click=${() => this._openRoom()}>
          <ha-icon class="ri ${classMap({ on: anyOn })}" icon=${c.icon!}></ha-icon>
          <span class="name">${c.name}</span>
          <span class="count">${anyOn ? `${onCount} on` : total ? "off" : ""}</span>
          ${total
            ? html`<button class=${classMap({ toggle: true, on: anyOn })} @click=${(e: Event) => this._toggleAll(e)} title="Toggle room lights">
                <ha-icon icon="mdi:power"></ha-icon>
              </button>`
            : nothing}
        </div>

        ${anyOn && bright !== undefined
          ? html`<div class="slider">
              <ha-icon icon="mdi:brightness-6"></ha-icon>
              <input type="range" min="1" max="100" .value=${String(bright)} @change=${(e: Event) => this._setBrightness(e)} @click=${(e: Event) => e.stopPropagation()} style=${styleMap({ "--pct": `${bright}%` })} />
            </div>`
          : nothing}

        ${this._present.length
          ? html`<div class="chips">
              ${this._present.map((l) => {
                const on = this._isOn(l.entity);
                return html`<button class=${classMap({ chip: true, on })} @click=${(e: Event) => this._toggleOne(l.entity, e)}>
                  <span class="dot"></span>${this._shortName(l)}
                </button>`;
              })}
            </div>`
          : nothing}

        ${this._renderMedia()}
      </ha-card>
    `;
  }

  private _renderMedia(): TemplateResult | typeof nothing {
    const m = this.config.media;
    if (!m) return nothing;
    const s = this._hass?.states[m];
    if (!s || !ON.has(s.state)) return nothing;
    const title = s.attributes.media_title || s.attributes.source || s.attributes.friendly_name || "Playing";
    return html`<div class="media" @click=${() => this._more(m)}>
      <ha-icon icon=${s.state === "playing" ? "mdi:music" : "mdi:pause"}></ha-icon>
      <span class="mt">${title}</span>
    </div>`;
  }

  static styles = css`
    :host { --room-accent: #f5b301; }
    ha-card {
      border-radius: 22px; padding: 12px 13px; height: 100%; box-sizing: border-box;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent);
      background: var(--ha-card-background, var(--card-background-color, #111318));
      box-shadow: 0 14px 30px -22px rgba(0,0,0,.6);
      transition: border-color .2s, background .2s;
    }
    ha-card.active {
      border-color: color-mix(in srgb, var(--room-accent) 38%, transparent);
      background: linear-gradient(180deg, color-mix(in srgb, var(--room-accent) 9%, transparent), transparent 60%), var(--ha-card-background, var(--card-background-color, #111318));
    }
    .head { display: flex; align-items: center; gap: 9px; cursor: pointer; }
    .ri { --mdc-icon-size: 22px; color: color-mix(in srgb, var(--primary-text-color) 50%, transparent); flex: 0 0 auto; }
    .ri.on { color: var(--room-accent); }
    .name { font-size: 15px; font-weight: 700; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .count { font-size: 12px; font-weight: 600; color: color-mix(in srgb, var(--primary-text-color) 48%, transparent); }
    .toggle { -webkit-appearance: none; appearance: none; width: 30px; height: 30px; border-radius: 999px; cursor: pointer; flex: 0 0 auto;
      display: inline-flex; align-items: center; justify-content: center; color: color-mix(in srgb, var(--primary-text-color) 55%, transparent);
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 12%, transparent); background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
    .toggle ha-icon { --mdc-icon-size: 17px; }
    .toggle.on { color: #1a1205; border: none; background: var(--room-accent); }
    .toggle:active { transform: scale(.92); }

    .slider { display: flex; align-items: center; gap: 8px; margin-top: 11px; }
    .slider ha-icon { --mdc-icon-size: 17px; color: var(--room-accent); flex: 0 0 auto; }
    input[type="range"] { -webkit-appearance: none; appearance: none; flex: 1; height: 8px; border-radius: 999px; cursor: pointer;
      background: linear-gradient(90deg, var(--room-accent) var(--pct), color-mix(in srgb, var(--primary-text-color) 12%, transparent) var(--pct)); }
    input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 999px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); }

    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
    .chip { -webkit-appearance: none; appearance: none; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-family: inherit;
      font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 999px; color: color-mix(in srgb, var(--primary-text-color) 62%, transparent);
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); background: color-mix(in srgb, var(--primary-text-color) 4%, transparent); }
    .chip .dot { width: 7px; height: 7px; border-radius: 999px; background: color-mix(in srgb, var(--primary-text-color) 30%, transparent); }
    .chip.on { color: var(--primary-text-color); border-color: color-mix(in srgb, var(--room-accent) 45%, transparent); background: color-mix(in srgb, var(--room-accent) 14%, transparent); }
    .chip.on .dot { background: var(--room-accent); box-shadow: 0 0 8px -1px var(--room-accent); }
    .chip:active { transform: scale(.96); }

    .media { display: flex; align-items: center; gap: 7px; margin-top: 11px; padding: 7px 10px; border-radius: 12px; cursor: pointer;
      background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); font-size: 12px; }
    .media ha-icon { --mdc-icon-size: 15px; color: color-mix(in srgb, var(--primary-text-color) 60%, transparent); flex: 0 0 auto; }
    .mt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: color-mix(in srgb, var(--primary-text-color) 72%, transparent); }
  `;
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "homelab-room-card",
  name: "Room Card",
  description: "Room control: lit state, master toggle, brightness, per-light chips and media.",
  preview: true,
});
