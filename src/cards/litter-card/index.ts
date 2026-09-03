import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo, stateStr, stateNum } from "../../shared/ha";

interface LitterConfig extends LovelaceCardConfig {
  type: string;
  name?: string;
  entity?: string; // vacuum.* litter box
  waste_drawer?: string; // % full
  litter_level?: string; // % remaining
  drawer_warn?: number; // % full at/above which to flag (default 80)
  litter_warn?: number; // % remaining at/below which to flag (default 15)
}

const V = "vacuum.litter_robot_4_litter_box";
const S = "sensor.litter_robot_4_";
const DEFAULTS = {
  name: "Litter-Robot",
  entity: V,
  waste_drawer: `${S}waste_drawer`,
  litter_level: `${S}litter_level`,
};

// vacuum.state for the litter box: docked/cleaning/paused/error/off
function phase(s?: string): { label: string; cleaning: boolean; err: boolean } {
  const l = (s ?? "").toLowerCase();
  if (l === "cleaning" || l === "returning") return { label: "Cleaning", cleaning: true, err: false };
  if (l === "error") return { label: "Needs attention", cleaning: false, err: true };
  if (l === "paused") return { label: "Paused", cleaning: false, err: false };
  return { label: "Ready", cleaning: false, err: false };
}

@customElement("litter-card")
export class LitterCard extends LitElement {
  @state() private config!: LitterConfig;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): LitterConfig {
    return { type: "custom:litter-card" };
  }

  setConfig(config: LitterConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = { drawer_warn: 80, litter_warn: 15, ...DEFAULTS, ...config };
  }

  getCardSize(): number {
    return 2;
  }

  private _clean() {
    if (!this.config.entity || !this._hass) return;
    this._hass.callService("vacuum", "start", { entity_id: this.config.entity });
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const c = this.config;
    const ph = phase(stateStr(this._hass, c.entity));
    const drawer = stateNum(this._hass, c.waste_drawer); // % full
    const litter = stateNum(this._hass, c.litter_level); // % remaining
    const drawerWarn = drawer !== undefined && drawer >= (c.drawer_warn ?? 80);
    const litterWarn = litter !== undefined && litter <= (c.litter_warn ?? 15);
    const attention = ph.err || drawerWarn || litterWarn;

    const pill = ph.err
      ? html`<span class="pill alert"><ha-icon icon="mdi:alert"></ha-icon>${ph.label}</span>`
      : ph.cleaning
        ? html`<span class="pill busy"><ha-icon icon="mdi:autorenew"></ha-icon>${ph.label}</span>`
        : attention
          ? html`<span class="pill warn"><ha-icon icon="mdi:tray-alert"></ha-icon>${drawerWarn ? "Empty the drawer" : "Add litter"}</span>`
          : html`<span class="pill good"><ha-icon icon="mdi:check-circle"></ha-icon>${ph.label}</span>`;

    return html`
      <ha-card class=${classMap({ attention })}>
        <div class="head" @click=${() => this._more(c.entity)}>
          <ha-icon icon="mdi:robot-vacuum"></ha-icon>
          <span class="title">${c.name}</span>
          <span class="spacer"></span>
          ${pill}
        </div>
        <div class="bars">
          ${this._bar("Waste drawer", drawer, false, drawerWarn, c.waste_drawer)}
          ${this._bar("Litter level", litter, true, litterWarn, c.litter_level)}
        </div>
        <button class="act primary" @click=${() => this._clean()}>
          <ha-icon icon="mdi:broom"></ha-icon>Clean now
        </button>
      </ha-card>
    `;
  }

  // remaining=true → the value IS remaining (low is bad); remaining=false → value is fullness (high is bad)
  private _bar(label: string, v: number | undefined, remaining: boolean, warn: boolean, entity?: string): TemplateResult {
    const pctv = v === undefined ? 0 : Math.max(0, Math.min(100, v));
    const color = warn ? "var(--lr-red)" : remaining ? "var(--lr-green)" : "var(--lr-amber)";
    return html`
      <div class="bar" @click=${() => this._more(entity)}>
        <div class="barhead">
          <span class="bl">${label}</span>
          <span class=${classMap({ bv: true, warn })}>${v === undefined ? "—" : `${Math.round(v)}%`}</span>
        </div>
        <div class="track"><div class="fill" style=${styleMap({ width: `${pctv}%`, background: color })}></div></div>
      </div>
    `;
  }

  private _more(e?: string) {
    if (e && this._hass?.states[e]) moreInfo(this, e);
  }

  static styles = [hearth, css`
    :host { --lr-amber: #f5b301; --lr-green: #34d399; --lr-red: #f87171; }
    ha-card {
      border-radius: var(--hl-r-card); padding: 14px 14px 14px;
      border: 1px solid var(--hl-hair);
      background: var(--ha-card-background, var(--card-background-color, #111318));
      box-shadow: var(--hl-e1);
      transition: border-color var(--hl-d4) var(--hl-settle);
    }
    ha-card.attention { border-color: color-mix(in srgb, var(--lr-amber) 40%, transparent); }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; cursor: pointer; }
    .head > ha-icon { --mdc-icon-size: 20px; color: var(--hl-text-2); }
    .title { font-size: 15px; font-weight: 700; }
    .spacer { flex: 1; }
    .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700;
      padding: 4px 9px; border-radius: 999px; }
    .pill ha-icon { --mdc-icon-size: 14px; }
    .pill.good { color: var(--lr-green); background: color-mix(in srgb, var(--lr-green) 15%, transparent); }
    .pill.warn { color: var(--lr-amber); background: color-mix(in srgb, var(--lr-amber) 16%, transparent); }
    .pill.alert { color: var(--lr-red); background: color-mix(in srgb, var(--lr-red) 16%, transparent); }
    .pill.busy { color: var(--lr-amber); background: color-mix(in srgb, var(--lr-amber) 16%, transparent); }
    .pill.busy ha-icon { animation: hl-spin 1.4s linear infinite; }
    @keyframes hl-spin { to { transform: rotate(360deg); } }

    .bars { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
    .bar { cursor: pointer; }
    .barhead { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 5px; }
    .bl { font-size: 12.5px; font-weight: 600; color: var(--hl-text-2); }
    .bv { font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .bv.warn { color: var(--lr-red); }
    .track { height: 8px; border-radius: 999px; background: var(--hl-wash-2); overflow: hidden; }
    .fill { height: 100%; border-radius: 999px; transform-origin: left center;
      transition: width var(--hl-d4) var(--hl-settle); animation: hl-grow-x var(--hl-d3) var(--hl-settle) both; }

    .act {
      -webkit-appearance: none; appearance: none; width: 100%;
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 11px; border-radius: var(--hl-r-inner); border: none; cursor: pointer;
      font-family: inherit; font-weight: 700; font-size: 14px;
      color: #0b1220;
      background: linear-gradient(180deg, color-mix(in srgb, var(--lr-amber) 82%, white 18%), var(--lr-amber));
      box-shadow: 0 8px 18px -8px color-mix(in srgb, var(--lr-amber) 85%, transparent);
      transition: transform var(--hl-d1) var(--hl-shift), filter var(--hl-d1) ease;
    }
    .act ha-icon { --mdc-icon-size: 20px; color: #0b1220; }
    .act:hover { filter: brightness(1.05); }
    .act:active { transform: scale(0.97); }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "litter-card",
  name: "Litter Card",
  description: "Litter-Robot status: ready/cleaning, waste-drawer + litter-level bars, one-tap clean cycle.",
  preview: true,
});
