import { LitElement, html, nothing, css } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import { handleAction, type ActionConfig, type LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { stateStr, moreInfo } from "../../shared/ha";

interface HearthTileConfig extends LovelaceCardConfig {
  type: string;
  entity?: string;
  name?: string;
  icon?: string;
  state_text?: string; // override the state line (else derived)
  color?: string; // accent for the "on" fill (default amber)
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  toggle?: boolean; // tap toggles the entity (default: true for toggleable domains)
}

const NAMED: Record<string, string> = {
  amber: "#f5b301", orange: "#fb8c00", teal: "#14b8a6", blue: "#38bdf8",
  purple: "#9c6ade", pink: "#ec4899", green: "#34d399", red: "#f87171",
};
const TOGGLEABLE = new Set(["light", "switch", "fan", "input_boolean", "media_player", "siren", "humidifier"]);
const ON = new Set(["on", "open", "playing", "home", "cleaning", "heat", "cool", "active"]);

function prettyState(s?: string): string {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase());
}

@customElement("hearth-tile")
export class HearthTile extends LitElement {
  @state() private config!: HearthTileConfig;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.toggleAttribute("dark", !!(h?.themes as any)?.darkMode);
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): HearthTileConfig {
    return { type: "custom:hearth-tile" };
  }

  setConfig(config: HearthTileConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = { ...config };
  }

  getCardSize(): number {
    return 1;
  }

  private get _accent(): string {
    const c = this.config.color ?? "amber";
    return NAMED[c] ?? c;
  }
  private _isOn(): boolean {
    const s = stateStr(this._hass, this.config.entity);
    return !!s && ON.has(s.toLowerCase());
  }
  private _tap() {
    const c = this.config;
    if (c.tap_action) {
      handleAction(this, this._hass!, c as any, "tap");
      return;
    }
    const domain = c.entity?.split(".")[0];
    if (c.entity && (c.toggle ?? (domain && TOGGLEABLE.has(domain)))) {
      this._hass!.callService(domain!, "toggle", { entity_id: c.entity });
    } else if (c.entity) {
      moreInfo(this, c.entity);
    }
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const c = this.config;
    const st = c.entity ? this._hass.states[c.entity] : undefined;
    const on = this._isOn();
    const name = c.name ?? st?.attributes.friendly_name ?? c.entity ?? "";
    const icon = c.icon ?? st?.attributes.icon ?? "mdi:circle-medium";
    const stateText = c.state_text ?? (st ? prettyState(st.state) : "");
    return html`
      <ha-card>
        <button class=${classMap({ tile: true, on })} style=${styleMap({ "--ht-accent": this._accent })}
          @click=${() => this._tap()}
          @contextmenu=${(e: Event) => { e.preventDefault(); if (c.entity) moreInfo(this, c.entity); }}>
          <span class="ic ${classMap({ on })}"><ha-icon icon=${icon}></ha-icon></span>
          <span class="txt">
            <span class="nm">${name}</span>
            ${stateText ? html`<span class="st">${stateText}</span>` : nothing}
          </span>
        </button>
      </ha-card>
    `;
  }

  static styles = [hearth, css`
    ha-card { border-radius: var(--hl-r-inner); background: none; border: none; box-shadow: none; }
    button { -webkit-appearance: none; appearance: none; font-family: inherit; cursor: pointer; color: inherit;
      display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; border: none;
      padding: 11px 13px; border-radius: var(--hl-r-inner);
      background: color-mix(in oklab, rgb(var(--hl-ember)) 5%, var(--card-background-color, #fff));
      box-shadow: inset 0 1.5px 3px rgb(var(--hl-ember) / .07), inset 0 -1px 0 rgb(255 255 255 / .5);
      transition: transform var(--hl-d1) var(--hl-shift), box-shadow var(--hl-d2) var(--hl-settle); }
    :host([dark]) button { background: color-mix(in oklab, black 20%, var(--card-background-color, #16181d)); box-shadow: inset 0 1.5px 3px rgb(0 0 0 / .35); }
    button.on { box-shadow: inset 0 1px 0 rgb(255 255 255 / .5), 0 2px 8px color-mix(in srgb, var(--ht-accent) 22%, transparent); }
    button:active { transform: scale(.98); }

    .ic { width: 38px; height: 38px; flex: 0 0 auto; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; transition: background .3s, box-shadow .3s;
      background: color-mix(in oklab, rgb(var(--hl-ember)) 6%, var(--card-background-color, #fff)); box-shadow: inset 0 1.5px 3px rgb(var(--hl-ember) / .08); }
    :host([dark]) .ic { background: color-mix(in oklab, black 26%, var(--card-background-color, #16181d)); box-shadow: inset 0 1.5px 3px rgb(0 0 0 / .4); }
    .ic ha-icon { --mdc-icon-size: 21px; color: color-mix(in srgb, var(--primary-text-color) 50%, transparent); transition: color .3s; }
    .ic.on { background: linear-gradient(180deg, color-mix(in oklab, var(--ht-accent) 82%, white 18%), var(--ht-accent)); box-shadow: inset 0 1px 0 rgb(255 255 255 / .4), 0 2px 6px color-mix(in srgb, var(--ht-accent) 45%, transparent); }
    .ic.on ha-icon { color: #0b1220; }

    .txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
    .nm { font-size: 14px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .st { font-size: 11.5px; font-weight: 500; color: var(--hl-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    button.on .st { color: color-mix(in srgb, var(--ht-accent) 60%, var(--primary-text-color)); }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "hearth-tile",
  name: "Hearth Tile",
  description: "A calm generic entity tile (icon + name + state) in the Hearthlight fill/well language. Replaces raw bubbles.",
  preview: true,
});
