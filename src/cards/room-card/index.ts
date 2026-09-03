import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo } from "../../shared/ha";
import { displayColor, kelvinToRgb, type RGB } from "../../shared/color";

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
  navigation_path?: string;
}

const PLAYING = new Set(["playing", "on", "paused"]);

const POWER_PATH =
  "M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.92 6.92 0 0 1 19 12a7 7 0 1 1-11.83-5.06L5.76 5.51a9 9 0 1 0 12.07.66z";

@customElement("homelab-room-card")
export class RoomCard extends LitElement {
  @state() private config!: RoomCardConfig;
  @state() private _dragVal?: number;
  private _hass?: HomeAssistant;

  // derived render fields (set in willUpdate)
  private _dark = false;
  private _onCount = 0;
  private _total = 0;
  private _bloom = 0;
  private _dominant = "";
  private _gradA = "";
  private _gradB = "";
  private _active: "a" | "b" = "a";
  private _curGrad = "";
  private _throttle = 0;

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
    this.config = { icon: "mdi:sofa-outline", ...config };
  }

  getCardSize(): number {
    return 2;
  }

  private get _lights(): LightSpec[] {
    return (this.config?.lights ?? []).map((l) => (typeof l === "string" ? { entity: l } : l));
  }
  private _attrs(e: string) {
    return this._hass?.states[e]?.attributes ?? {};
  }
  private _isOn(e: string): boolean {
    return this._hass?.states[e]?.state === "on";
  }
  private _isPresent(e: string): boolean {
    const st = this._hass?.states[e]?.state;
    return st !== undefined && st !== "unavailable";
  }
  private _isSwitch(e: string): boolean {
    const a = this._attrs(e);
    const modes: string[] = a.supported_color_modes ?? [];
    return (modes.length === 0 || (modes.length === 1 && modes[0] === "onoff")) && a.brightness == null;
  }
  private _lightRgb(e: string): RGB {
    const a = this._attrs(e);
    if (Array.isArray(a.rgb_color)) return a.rgb_color as RGB;
    if (a.color_temp_kelvin) return kelvinToRgb(a.color_temp_kelvin);
    if (a.brightness != null) return kelvinToRgb(3000);
    return kelvinToRgb(2700);
  }
  private _colorFor(e: string): string {
    return displayColor(this._lightRgb(e), this._dark);
  }
  private _weight(e: string): number {
    if (this._isSwitch(e)) return 1;
    const b = this._attrs(e).brightness;
    return Math.max(0.12, (b ?? 255) / 255);
  }
  private _briFrac(e: string): number {
    if (this._isSwitch(e)) return 1;
    const b = this._attrs(e).brightness;
    return (b ?? 255) / 255;
  }

  private get _presentLights(): LightSpec[] {
    return this._lights.filter((l) => this._isPresent(l.entity));
  }
  private get _onLights(): LightSpec[] {
    return this._lights.filter((l) => this._isOn(l.entity));
  }
  private get _dimmableOn(): string[] {
    return this._onLights.filter((l) => !this._isSwitch(l.entity) && this._attrs(l.entity).brightness != null).map((l) => l.entity);
  }
  private _brightnessPct(): number {
    const ds = this._dimmableOn;
    if (!ds.length) return 0;
    const avg = ds.reduce((s, e) => s + Number(this._attrs(e).brightness ?? 0), 0) / ds.length;
    return Math.round((avg / 255) * 100);
  }

  willUpdate(): void {
    if (!this._hass || !this.config) return;
    this._dark = !!(this._hass as any).themes?.darkMode;
    const on = this._onLights;
    this._onCount = on.length;
    this._total = this._presentLights.length;

    // dominant = brightest on-light's colour (keystone tile + accent)
    let domE: string | undefined;
    let domW = -1;
    for (const l of on) {
      const w = this._weight(l.entity);
      if (w > domW) { domW = w; domE = l.entity; }
    }
    this._dominant = domE ? this._colorFor(domE) : "";

    // brightness-weighted colour gradient for the Lightline
    const grad = this._buildGradient(on);
    if (grad !== this._curGrad) {
      // paint the new gradient into the hidden layer, then crossfade
      if (this._active === "a") { this._gradB = grad; this._active = "b"; }
      else { this._gradA = grad; this._active = "a"; }
      this._curGrad = grad;
    }
    const mean = on.length ? Math.max(0.35, on.reduce((s, l) => s + this._briFrac(l.entity), 0) / on.length) : 0;
    this._bloom = on.length ? (this._dark ? 0.22 : 0.12) * mean : 0;
  }

  private _buildGradient(on: LightSpec[]): string {
    if (!on.length) return "";
    const items = on.map((l) => ({ c: this._colorFor(l.entity), w: this._weight(l.entity) }));
    const total = items.reduce((s, i) => s + i.w, 0) || 1;
    const parts: string[] = [`${items[0].c} 0%`];
    let cum = 0;
    for (const it of items) {
      const center = ((cum + it.w / 2) / total) * 100;
      parts.push(`${it.c} ${center.toFixed(1)}%`);
      cum += it.w;
    }
    parts.push(`${items[items.length - 1].c} 100%`);
    return `linear-gradient(90deg, ${parts.join(", ")})`;
  }

  // ---- interactions ----
  private _toggleAll(e: Event) {
    e.stopPropagation();
    if (!this._hass) return;
    const ids = this._presentLights.map((l) => l.entity);
    if (!ids.length) return;
    this._hass.callService("light", this._onCount ? "turn_off" : "turn_on", { entity_id: ids });
  }
  private _toggleOne(entity: string, e: Event) {
    e.stopPropagation();
    this._hass?.callService("light", "toggle", { entity_id: entity });
  }
  private _onInput(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    this._dragVal = val;
    const now = Date.now();
    if (now - this._throttle > 220) {
      this._throttle = now;
      this._commitBrightness(val);
    }
  }
  private _onChange(e: Event) {
    this._commitBrightness(Number((e.target as HTMLInputElement).value));
    window.setTimeout(() => (this._dragVal = undefined), 900);
  }
  private _commitBrightness(val: number) {
    const ids = this._dimmableOn;
    if (ids.length && this._hass) this._hass.callService("light", "turn_on", { entity_id: ids, brightness_pct: val });
  }
  private _openRoom(e: Event) {
    e.stopPropagation();
    const path = this.config.navigation_path;
    if (!path) return;
    const hash = path.startsWith("#") ? path : `#${path}`;
    history.replaceState(null, "", hash);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: true } }));
  }
  private _more(e?: string) {
    if (e && this._hass?.states[e]) moreInfo(this, e);
  }

  private _shortName(l: LightSpec): string {
    if (l.name) return l.name;
    const fn = this._attrs(l.entity).friendly_name ?? l.entity;
    return fn.replace(new RegExp(`^${this.config.name}\\s+`, "i"), "").trim() || fn;
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const c = this.config;
    const anyOn = this._onCount > 0;
    const bright = this._dragVal ?? this._brightnessPct();
    const showSlider = this._dimmableOn.length > 0;
    // stable config order — so the ignition animation fires only on the light
    // you actually toggle (re-sorting would pop whichever chip moves into place)
    const chips = this._presentLights;

    return html`
      <ha-card class=${classMap({ lit: anyOn })}>
        <div class="lightline" aria-hidden="true">
          <div class="fil" style=${styleMap({ background: this._active === "a" ? this._gradA : this._gradB })}></div>
          <div class="bloom" style=${styleMap({ background: this._gradA, opacity: String(this._active === "a" ? this._bloom : 0) })}></div>
          <div class="bloom" style=${styleMap({ background: this._gradB, opacity: String(this._active === "b" ? this._bloom : 0) })}></div>
        </div>

        <div class="header">
          <button class="key ${classMap({ on: anyOn })}" @click=${(e: Event) => this._openRoom(e)}
            style=${styleMap(anyOn ? { background: `color-mix(in srgb, ${this._dominant} 14%, transparent)` } : {})}>
            <ha-icon icon=${c.icon!} style=${styleMap(anyOn ? { color: this._dominant } : {})}></ha-icon>
          </button>
          <button class="title" @click=${(e: Event) => this._openRoom(e)}>
            <span class="name">${c.name}</span>
            <ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>
            <div class="count">${anyOn ? `${this._onCount} of ${this._total} on` : "off"}</div>
          </button>
          ${this._total
            ? html`<button class="power ${classMap({ on: anyOn })}" @click=${(e: Event) => this._toggleAll(e)} aria-label="Toggle ${c.name} lights">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d=${POWER_PATH} fill="currentColor"></path></svg>
              </button>`
            : nothing}
        </div>

        <div class="slidewrap ${classMap({ open: showSlider })}">
          <div class="slideinner">
            <div class="sliderow-top"><span class="microlabel">Brightness</span><span class="readout ${classMap({ show: this._dragVal !== undefined })}">${bright}%</span></div>
            <input class="slider" type="range" min="1" max="100" .value=${String(bright)}
              @input=${(e: Event) => this._onInput(e)} @change=${(e: Event) => this._onChange(e)} @click=${(e: Event) => e.stopPropagation()}
              style=${styleMap({ "--pct": `${bright}%` })} aria-label="${c.name} brightness" />
          </div>
        </div>

        ${chips.length
          ? html`<div class="chips">
              ${chips.map((l) => {
                const on = this._isOn(l.entity);
                const sw = this._isSwitch(l.entity);
                const col = on ? this._colorFor(l.entity) : "";
                return html`<button
                  class=${classMap({ chip: true, on })}
                  style=${styleMap(on ? { "--lc": col } : {})}
                  @click=${(e: Event) => this._toggleOne(l.entity, e)}
                >
                  <span class="dot ${classMap({ sq: sw })}"></span><span class="cn">${this._shortName(l)}</span>
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
    if (!s || !PLAYING.has(s.state)) return nothing;
    const playing = s.state === "playing";
    const title = s.attributes.media_title || s.attributes.source || s.attributes.friendly_name || "Playing";
    return html`<button class="media" @click=${() => this._more(m)}>
      <span class="eq ${classMap({ live: playing })}"><i></i><i></i><i></i></span>
      <span class="mt">${title}</span>
    </button>`;
  }

  static styles = css`
    :host { --amber: #f5b301; display: block; }
    ha-card {
      position: relative; overflow: hidden; box-sizing: border-box; height: 100%;
      border-radius: 16px; padding: 14px 14px 12px;
      background: var(--ha-card-background, var(--card-background-color, #16181d));
      border: 1px solid transparent;
      animation: mount .28s ease-out both;
    }
    @media (prefers-color-scheme: light) { ha-card { border-color: var(--divider-color, rgba(0,0,0,.08)); } }
    @keyframes mount { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    /* ---- Lightline (signature) ---- */
    .lightline { position: absolute; inset: 0 0 auto 0; height: 45%; pointer-events: none; }
    .fil { position: absolute; top: 0; left: 0; right: 0; height: 2.5px; transform: scaleY(0); transform-origin: top; transition: transform .5s cubic-bezier(.22,1,.36,1) .09s, background .2s linear; }
    ha-card.lit .fil { transform: scaleY(1); }
    .bloom { position: absolute; inset: 0; opacity: 0; transition: opacity .6s ease-out; -webkit-mask-image: linear-gradient(to bottom, #000, transparent 85%); mask-image: linear-gradient(to bottom, #000, transparent 85%); }

    /* ---- header ---- */
    .header { position: relative; display: grid; grid-template-columns: 34px 1fr auto; column-gap: 10px; align-items: center; }
    button { -webkit-appearance: none; appearance: none; font-family: inherit; border: none; background: none; padding: 0; margin: 0; cursor: pointer; color: inherit; }
    .key { width: 34px; height: 34px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); transition: background .35s ease; }
    .key ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); transition: color .35s ease; }
    .title { display: grid; grid-template-columns: auto auto 1fr; align-items: baseline; column-gap: 4px; text-align: left; min-width: 0; }
    .name { font-size: 15px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chev { --mdc-icon-size: 15px; color: var(--secondary-text-color); opacity: .5; transform: translateX(0); transition: transform .15s ease, opacity .15s ease; align-self: center; }
    .title:hover .chev { transform: translateX(2px); opacity: .9; }
    .title:active .name { opacity: .65; }
    .count { grid-column: 1 / -1; font-size: 10px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--secondary-text-color); margin-top: 2px; }

    .power { position: relative; width: 30px; height: 30px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: var(--secondary-text-color); border: 1.5px solid color-mix(in srgb, var(--primary-text-color) 20%, transparent); transition: background .2s ease, color .2s ease, border-color .2s ease, transform .09s ease; }
    .power.on { color: #1a1a1a; background: var(--amber); border-color: transparent; }
    .power:active { transform: scale(.92); }
    .power::after { content: ""; position: absolute; inset: 0; border-radius: 999px; border: 2px solid var(--amber); opacity: 0; }
    ha-card.lit .power.on::after { animation: pulse .45s ease-out; }
    @keyframes pulse { from { opacity: .4; transform: scale(1); } to { opacity: 0; transform: scale(1.7); } }

    /* ---- slider (collapsible) ---- */
    .slidewrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .24s cubic-bezier(.22,1,.36,1); }
    .slidewrap.open { grid-template-rows: 1fr; }
    .slideinner { overflow: hidden; opacity: 0; transition: opacity .18s ease; }
    .slidewrap.open .slideinner { opacity: 1; margin-top: 12px; }
    .sliderow-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
    .microlabel { font-size: 10px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--secondary-text-color); }
    .readout { font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--secondary-text-color); opacity: 0; transition: opacity .12s ease; }
    .readout.show { opacity: 1; }
    input[type="range"] { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 2px; cursor: pointer;
      background: linear-gradient(90deg, var(--amber) var(--pct), color-mix(in srgb, var(--primary-text-color) 10%, transparent) var(--pct)); }
    input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 999px; background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / .35); transition: transform .12s ease; }
    input[type="range"]:active::-webkit-slider-thumb { transform: scale(1.12); }

    /* ---- chips ---- */
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
    .chip { position: relative; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px 0 8px; border-radius: 999px; font-size: 12px; font-weight: 500;
      color: var(--primary-text-color); border: 1px solid color-mix(in srgb, var(--primary-text-color) 12%, transparent); background: transparent; transition: background .24s ease, border-color .24s ease; }
    .chip .cn { color: color-mix(in srgb, var(--primary-text-color) 62%, transparent); transition: color .24s ease; }
    .chip .dot { width: 8px; height: 8px; border-radius: 999px; box-sizing: border-box; border: 1.5px solid color-mix(in srgb, var(--primary-text-color) 35%, transparent); background: transparent; transition: background .2s ease, border-color .2s ease; }
    .chip .dot.sq { border-radius: 2.5px; }
    .chip.on { border-color: color-mix(in srgb, var(--lc) 45%, transparent); background: color-mix(in srgb, var(--lc) 14%, transparent); }
    .chip.on .cn { color: var(--primary-text-color); }
    .chip.on .dot { background: var(--lc); border-color: var(--lc); animation: dotpop .32s cubic-bezier(.22,1,.36,1); }
    .chip.on .dot::after { content: ""; position: absolute; left: 8px; top: 50%; width: 12px; height: 12px; margin: -6px 0 0 -2px; border-radius: 999px; background: var(--lc); animation: bloom .38s ease-out; }
    .chip:active { transform: scale(.95); }
    @keyframes dotpop { 0% { transform: scale(.5); } 60% { transform: scale(1.18); } 100% { transform: scale(1); } }
    @keyframes bloom { from { opacity: .55; transform: scale(1); } to { opacity: 0; transform: scale(2.6); } }

    /* ---- media ---- */
    .media { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 11px; padding: 7px 10px; border-radius: 12px; text-align: left;
      background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); font-size: 12px; }
    .eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
    .eq i { width: 2px; height: 40%; background: var(--secondary-text-color); border-radius: 1px; }
    .eq.live i { animation: eq 1.1s ease-in-out infinite alternate; }
    .eq.live i:nth-child(2) { animation-delay: .25s; } .eq.live i:nth-child(3) { animation-delay: .5s; }
    @keyframes eq { from { height: 30%; } to { height: 100%; } }
    .mt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: color-mix(in srgb, var(--primary-text-color) 72%, transparent); }

    /* focus */
    button:focus-visible, input:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

    @media (prefers-reduced-motion: reduce) {
      ha-card, .fil, .bloom, .chip .dot, .power::after, .eq.live i, .chip { animation: none !important; transition: opacity .12s linear !important; }
      .fil { transform: scaleY(1); }
      .chip .dot::after { display: none; }
    }
  `;
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "homelab-room-card",
  name: "Room Card",
  description: "Room control lit by its own lights: real-colour glow, master toggle, brightness, per-light chips.",
  preview: true,
});
