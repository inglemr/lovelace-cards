import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo } from "../../shared/ha";

// v3 "Lightwell": warmth is the ONLY signal. No bulb hue ever reaches a pixel —
// the palette is a fixed amber band, so the card can never read as an alert.
const WARM = "#f2a93b"; // ~2700K tungsten
const COOL = "#ffe8c2"; // ~4500K pale warm ivory (never blue-white)

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
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

@customElement("homelab-room-card")
export class RoomCard extends LitElement {
  @state() private config!: RoomCardConfig;
  @state() private _dragVal?: number;
  @state() private _dragging = false;
  private _hass?: HomeAssistant;
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
  private _briFrac(e: string): number {
    if (this._isSwitch(e)) return 1;
    return (this._attrs(e).brightness ?? 255) / 255;
  }
  private get _presentLights(): LightSpec[] {
    return this._lights.filter((l) => this._isPresent(l.entity));
  }
  private get _onLights(): LightSpec[] {
    return this._lights.filter((l) => this._isOn(l.entity));
  }
  private get _presentDimmable(): string[] {
    return this._presentLights.filter((l) => !this._isSwitch(l.entity)).map((l) => l.entity);
  }
  private get _onDimmable(): string[] {
    return this._onLights.filter((l) => !this._isSwitch(l.entity)).map((l) => l.entity);
  }
  private _brightnessPct(): number {
    const ds = this._onDimmable;
    if (!ds.length) return 0;
    const avg = ds.reduce((s, e) => s + Number(this._attrs(e).brightness ?? 0), 0) / ds.length;
    return Math.round((avg / 255) * 100);
  }
  private _meanBriFrac(): number {
    const on = this._onLights;
    if (!on.length) return 0;
    return on.reduce((s, l) => s + this._briFrac(l.entity), 0) / on.length;
  }

  /** Warmth-only glow colour: warm↔ivory by clamped mean colour-temp. Hue is
   *  never sampled — rgb-only lights count as tungsten. Result stays amber-band. */
  private _glowColor(): string {
    const kelvins = this._onLights
      .map((l) => ({ k: this._attrs(l.entity).color_temp_kelvin, w: this._briFrac(l.entity) }))
      .filter((x) => Number.isFinite(x.k));
    let t = 0;
    if (kelvins.length) {
      const wsum = kelvins.reduce((s, x) => s + x.w, 0) || 1;
      const kMean = kelvins.reduce((s, x) => s + x.w * x.k, 0) / wsum;
      t = clamp((kMean - 2200) / (4500 - 2200), 0, 1);
    }
    return `color-mix(in srgb, ${WARM} ${Math.round((1 - t) * 100)}%, ${COOL})`;
  }

  // ---- interactions ----
  private _toggleAll(e: Event) {
    e.stopPropagation();
    if (!this._hass) return;
    const ids = this._presentLights.map((l) => l.entity);
    if (!ids.length) return;
    this._hass.callService("light", this._onLights.length ? "turn_off" : "turn_on", { entity_id: ids });
  }
  private _toggleOne(entity: string, e: Event) {
    e.stopPropagation();
    this._hass?.callService("light", "toggle", { entity_id: entity });
  }
  private _wellDown() { this._dragging = true; }
  private _wellUp() { this._dragging = false; }
  private _onInput(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    this._dragVal = val;
    const now = Date.now();
    if (now - this._throttle > 220) { this._throttle = now; this._commit(val); }
  }
  private _onChange(e: Event) {
    this._commit(Number((e.target as HTMLInputElement).value));
    window.setTimeout(() => { this._dragVal = undefined; this._dragging = false; }, 900);
  }
  private _commit(val: number) {
    if (!this._hass) return;
    // ignite the room's dimmables (or adjust the ones already on)
    const ids = this._onDimmable.length ? this._onDimmable : this._presentDimmable;
    if (ids.length) this._hass.callService("light", "turn_on", { entity_id: ids, brightness_pct: val });
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
    const dark = !!(this._hass as any).themes?.darkMode;
    const present = this._presentLights;
    const onCount = this._onLights.length;
    const total = present.length;
    const anyOn = onCount > 0;
    const hasDimmable = this._presentDimmable.length > 0;
    const pct = this._dragVal ?? this._brightnessPct();
    const ambient = anyOn ? Math.max(0.15, (dark ? 0.9 : 0.45) * (onCount / Math.max(1, total)) * this._meanBriFrac()) : 0;
    const glow = this._glowColor();

    return html`
      <ha-card
        class=${classMap({ lit: anyOn })}
        style=${styleMap({ "--rc-glow": glow, "--pct": `${pct}%`, "--ambient": String(ambient) })}
      >
        <div class="ambient" aria-hidden="true"></div>

        <div class="header">
          <button class="key ${classMap({ on: anyOn })}" @click=${(e: Event) => this._openRoom(e)} tabindex="-1" aria-hidden="true">
            <ha-icon icon=${c.icon!}></ha-icon>
          </button>
          <button class="title" @click=${(e: Event) => this._openRoom(e)} aria-label="Open ${c.name}">
            <span class="name">${c.name}</span>
            <ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>
            <div class="count">${anyOn ? `${onCount} of ${total} on` : "off"}</div>
          </button>
          ${total
            ? html`<button class="power ${classMap({ on: anyOn })}" @click=${(e: Event) => this._toggleAll(e)} aria-label="Toggle ${c.name} lights">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d=${POWER_PATH} fill="currentColor"></path></svg>
              </button>`
            : nothing}
        </div>

        ${hasDimmable
          ? html`<div class="wellwrap">
              <div class="readout ${classMap({ show: this._dragVal !== undefined })}">${pct}%</div>
              <div class="well ${classMap({ dragging: this._dragging, cold: !anyOn })}">
                <div class="fill"></div>
                <input class="wellinput" type="range" min="1" max="100" .value=${String(Math.max(1, pct))}
                  @pointerdown=${() => this._wellDown()} @pointerup=${() => this._wellUp()} @pointercancel=${() => this._wellUp()}
                  @input=${(e: Event) => this._onInput(e)} @change=${(e: Event) => this._onChange(e)} @click=${(e: Event) => e.stopPropagation()}
                  aria-label="${c.name} brightness" />
              </div>
            </div>`
          : nothing}

        ${present.length
          ? html`<div class="pills">
              ${present.map((l) => {
                const on = this._isOn(l.entity);
                const sw = this._isSwitch(l.entity);
                return html`<button class=${classMap({ pill: true, on })} @click=${(e: Event) => this._toggleOne(l.entity, e)}>
                  <span class="dot ${classMap({ sq: sw })}"></span><span class="pn">${this._shortName(l)}</span>
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
    @property --rc-glow { syntax: "<color>"; inherits: true; initial-value: #f2a93b; }
    :host { --amber: #f5b301; display: block; }

    ha-card {
      position: relative; overflow: hidden; box-sizing: border-box; height: 100%;
      border-radius: var(--ha-card-border-radius, 16px); padding: 14px 14px 12px;
      background: var(--ha-card-background, var(--card-background-color, #16181d));
      border: 1px solid var(--divider-color, rgba(0,0,0,.08));
      animation: mount .28s ease-out both;
      transition: border-color .6s ease, --rc-glow .8s linear;
    }
    ha-card.lit { border-color: color-mix(in srgb, var(--rc-glow) 22%, var(--divider-color, transparent)); }
    @keyframes mount { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    /* ambient warmth pooling up from the well */
    .ambient { position: absolute; inset: 0; pointer-events: none; z-index: 0;
      background: radial-gradient(140% 120% at 50% 82%, color-mix(in srgb, var(--rc-glow) 22%, transparent), transparent 65%);
      opacity: var(--ambient, 0); transition: opacity .6s ease; }
    .header, .wellwrap, .pills, .media { position: relative; z-index: 1; }

    button { -webkit-appearance: none; appearance: none; font-family: inherit; border: none; background: none; padding: 0; margin: 0; cursor: pointer; color: inherit; }

    /* header */
    .header { display: grid; grid-template-columns: 36px 1fr auto; column-gap: 10px; align-items: center; }
    .key { width: 36px; height: 36px; border-radius: 11px; display: inline-flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); transition: background .5s ease; }
    ha-card.lit .key { background: color-mix(in srgb, var(--rc-glow) 12%, transparent); }
    .key ha-icon { --mdc-icon-size: 21px; color: var(--secondary-text-color); transition: color .5s ease; }
    ha-card.lit .key ha-icon { color: color-mix(in srgb, var(--rc-glow) 70%, var(--primary-text-color)); }
    .title { display: grid; grid-template-columns: auto auto 1fr; align-items: baseline; column-gap: 4px; text-align: left; min-width: 0; }
    .name { font-size: 15px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chev { --mdc-icon-size: 15px; color: var(--secondary-text-color); opacity: .5; transform: translateX(0); transition: transform .15s ease, opacity .15s ease; align-self: center; }
    .title:hover .chev { transform: translateX(2px); opacity: .9; }
    .title:active .name { opacity: .65; }
    .count { grid-column: 1 / -1; font-size: 11px; font-weight: 400; color: var(--secondary-text-color); margin-top: 2px; }

    .power { position: relative; width: 30px; height: 30px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
      color: var(--secondary-text-color); border: 1.5px solid color-mix(in srgb, var(--primary-text-color) 20%, transparent);
      transition: background .2s ease, color .2s ease, border-color .2s ease, transform .09s ease; }
    .power.on { color: #1a1a1a; background: var(--amber); border-color: transparent; }
    .power:active { transform: scale(.94); }

    /* the Lightwell */
    .wellwrap { margin-top: 12px; }
    .readout { text-align: right; height: 14px; margin-bottom: 3px; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums;
      color: var(--secondary-text-color); opacity: 0; transition: opacity .12s ease; }
    .readout.show { opacity: 1; }
    .well { position: relative; height: 30px; border-radius: 15px; overflow: hidden;
      background: color-mix(in srgb, var(--primary-text-color) 7%, transparent); }
    .fill { position: absolute; inset: 0 auto 0 0; width: max(var(--pct), 9%); border-radius: 15px;
      background: linear-gradient(90deg, color-mix(in srgb, var(--rc-glow) 55%, #fff8ec), var(--rc-glow));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .35);
      transition: width .45s cubic-bezier(.22,1,.36,1), background .3s linear; }
    .well.cold .fill { width: 0; }
    .well.dragging .fill { transition: none; }
    .wellinput { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; -webkit-appearance: none; appearance: none; background: transparent; }
    .wellinput::-webkit-slider-thumb { -webkit-appearance: none; width: 30px; height: 30px; }
    .well:has(.wellinput:focus-visible) { outline: 2px solid var(--amber); outline-offset: 2px; }

    /* pills */
    .pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px 0 8px; border-radius: 999px; font-size: 12px; font-weight: 500;
      color: var(--primary-text-color); border: 1px solid color-mix(in srgb, var(--primary-text-color) 12%, transparent); background: transparent;
      transition: background .22s ease, border-color .22s ease; }
    .pill .pn { color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); transition: color .22s ease; }
    .pill .dot { width: 8px; height: 8px; border-radius: 999px; box-sizing: border-box; border: 1.5px solid color-mix(in srgb, var(--primary-text-color) 32%, transparent); background: transparent; transition: background .2s ease, border-color .2s ease, transform .22s ease; }
    .pill .dot.sq { border-radius: 2.5px; }
    .pill.on { border-color: color-mix(in srgb, var(--rc-glow) 30%, transparent); background: color-mix(in srgb, var(--rc-glow) 11%, transparent); }
    .pill.on .pn { color: var(--primary-text-color); }
    .pill.on .dot { background: var(--amber); border-color: var(--amber); animation: settle .22s ease; }
    .pill:active { transform: scale(.96); }
    @keyframes settle { from { transform: scale(.6); } to { transform: scale(1); } }

    /* media */
    .media { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 11px; padding: 7px 10px; border-radius: 12px; text-align: left;
      background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); font-size: 12px; }
    .eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
    .eq i { width: 2px; height: 70%; background: var(--secondary-text-color); border-radius: 1px; }
    .eq.live i { animation: eq 1.6s ease-in-out infinite alternate; }
    .eq.live i:nth-child(2) { animation-delay: .35s; } .eq.live i:nth-child(3) { animation-delay: .7s; }
    @keyframes eq { from { height: 30%; } to { height: 100%; } }
    .mt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: color-mix(in srgb, var(--primary-text-color) 72%, transparent); }

    button:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

    @media (prefers-reduced-motion: reduce) {
      ha-card, .fill, .ambient, .pill, .pill .dot, .power, .eq.live i { animation: none !important; }
      ha-card { transition: none; }
      .fill { transition: background .2s linear; }
      .ambient { transition: opacity .12s linear; }
      .eq.live i { height: 70%; }
    }
  `;
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "homelab-room-card",
  name: "Room Card",
  description: "Calm room control: a warm 'Lightwell' you drag to dim, per-light pills, master toggle.",
  preview: true,
});
