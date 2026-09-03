import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo } from "../../shared/ha";
import { calmDotColor, kelvinDotColor, hueToRgb, type RGB } from "../../shared/color";

// v3 "Lightwell" + v3.1 per-light colour/tune.
// GOVERNING RULE: hue is DATA, not atmosphere. A light's real hue may only be
// painted in (1) the ≤8px pill dot (calm-clamped) and (2) an editor surface the
// user explicitly opened. Never in card background, ambient glow, borders or
// washes — those stay kelvin-warmth only, so the card can never read as an alert.
const WARM = "#f2a93b";
const COOL = "#ffe8c2";
const CURATED: { name: string; hex: string }[] = [
  { name: "Ember", hex: "#e8543f" },
  { name: "Sunset", hex: "#f59632" },
  { name: "Fern", hex: "#4fa863" },
  { name: "Lagoon", hex: "#2fa8c7" },
  { name: "Twilight", hex: "#5b6fd4" },
];
const RGB_MODES = ["rgb", "rgbw", "rgbww", "hs", "xy"];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const hexToRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;

interface LightSpec { entity: string; name?: string; }
interface RoomCardConfig extends LovelaceCardConfig {
  type: string;
  name: string;
  icon?: string;
  lights?: (string | LightSpec)[];
  media?: string;
  navigation_path?: string;
}

const PLAYING = new Set(["playing", "on", "paused"]);
const POWER_PATH = "M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.92 6.92 0 0 1 19 12a7 7 0 1 1-11.83-5.06L5.76 5.51a9 9 0 1 0 12.07.66z";

@customElement("homelab-room-card")
export class RoomCard extends LitElement {
  @state() private config!: RoomCardConfig;
  @state() private _dragVal?: number;
  @state() private _dragging = false;
  @state() private _editEntity?: string;
  @state() private _closing = false;
  @state() private _editBri?: number;
  @state() private _custom = false;
  private _hass?: HomeAssistant;
  private _throttle = 0;

  set hass(h: HomeAssistant) { this._hass = h; this.requestUpdate(); }
  get hass(): HomeAssistant | undefined { return this._hass; }

  static getStubConfig(): RoomCardConfig { return { type: "custom:homelab-room-card", name: "Room", lights: [] }; }
  setConfig(config: RoomCardConfig): void {
    if (!config || !config.name) throw new Error("homelab-room-card: 'name' is required");
    this.config = { icon: "mdi:sofa-outline", ...config };
  }
  getCardSize(): number { return 2; }
  disconnectedCallback(): void { super.disconnectedCallback(); document.removeEventListener("keydown", this._onKey); }

  private get _lights(): LightSpec[] { return (this.config?.lights ?? []).map((l) => (typeof l === "string" ? { entity: l } : l)); }
  private _attrs(e: string) { return this._hass?.states[e]?.attributes ?? {}; }
  private _isOn(e: string): boolean { return this._hass?.states[e]?.state === "on"; }
  private _isPresent(e: string): boolean { const st = this._hass?.states[e]?.state; return st !== undefined && st !== "unavailable"; }
  private _modes(e: string): string[] { return this._attrs(e).supported_color_modes ?? []; }
  private _isSwitch(e: string): boolean { const m = this._modes(e); return (m.length === 0 || (m.length === 1 && m[0] === "onoff")) && this._attrs(e).brightness == null; }
  private _canTune(e: string): boolean { return !this._isSwitch(e); }
  private _isRgb(e: string): boolean { return this._modes(e).some((m) => RGB_MODES.includes(m)); }
  private _isTemp(e: string): boolean { return this._modes(e).includes("color_temp"); }
  private _briFrac(e: string): number { if (this._isSwitch(e)) return 1; return (this._attrs(e).brightness ?? 255) / 255; }
  private get _presentLights(): LightSpec[] { return this._lights.filter((l) => this._isPresent(l.entity)); }
  private get _onLights(): LightSpec[] { return this._lights.filter((l) => this._isOn(l.entity)); }
  private get _presentDimmable(): string[] { return this._presentLights.filter((l) => !this._isSwitch(l.entity)).map((l) => l.entity); }
  private get _onDimmable(): string[] { return this._onLights.filter((l) => !this._isSwitch(l.entity)).map((l) => l.entity); }
  private _briPct(e: string): number { return Math.round(((this._attrs(e).brightness ?? 0) / 255) * 100); }
  private _roomBriPct(): number { const ds = this._onDimmable; if (!ds.length) return 0; return Math.round((ds.reduce((s, e) => s + (this._attrs(e).brightness ?? 0), 0) / ds.length / 255) * 100); }
  private _meanBriFrac(): number { const on = this._onLights; if (!on.length) return 0; return on.reduce((s, l) => s + this._briFrac(l.entity), 0) / on.length; }

  private _glowColor(): string {
    const ks = this._onLights.map((l) => ({ k: this._attrs(l.entity).color_temp_kelvin, w: this._briFrac(l.entity) })).filter((x) => Number.isFinite(x.k));
    let t = 0;
    if (ks.length) { const ws = ks.reduce((s, x) => s + x.w, 0) || 1; const km = ks.reduce((s, x) => s + x.w * x.k, 0) / ws; t = clamp((km - 2200) / 2300, 0, 1); }
    return `color-mix(in srgb, ${WARM} ${Math.round((1 - t) * 100)}%, ${COOL})`;
  }
  private _dotColor(e: string): string {
    if (!this._isOn(e)) return "var(--amber)";
    const a = this._attrs(e);
    if (Array.isArray(a.rgb_color)) { const c = calmDotColor(a.rgb_color as RGB); if (c) return c; }
    if (a.color_temp_kelvin) return kelvinDotColor(a.color_temp_kelvin);
    return "var(--amber)";
  }

  // ---- room interactions ----
  private _toggleAll(e: Event) { e.stopPropagation(); if (!this._hass) return; const ids = this._presentLights.map((l) => l.entity); if (ids.length) this._hass.callService("light", this._onLights.length ? "turn_off" : "turn_on", { entity_id: ids }); }
  private _toggleOne(entity: string, e: Event) { e.stopPropagation(); this._hass?.callService("light", "toggle", { entity_id: entity }); }
  private _wellDown() { this._dragging = true; }
  private _wellUp() { this._dragging = false; }
  private _onInput(e: Event) { const v = Number((e.target as HTMLInputElement).value); this._dragVal = v; const now = Date.now(); if (now - this._throttle > 220) { this._throttle = now; this._commitRoom(v); } }
  private _onChange(e: Event) { this._commitRoom(Number((e.target as HTMLInputElement).value)); window.setTimeout(() => { this._dragVal = undefined; this._dragging = false; }, 900); }
  private _commitRoom(v: number) { if (!this._hass) return; const ids = this._onDimmable.length ? this._onDimmable : this._presentDimmable; if (ids.length) this._hass.callService("light", "turn_on", { entity_id: ids, brightness_pct: v }); }

  // ---- per-light editor ----
  private _onKey = (e: KeyboardEvent) => { if (e.key === "Escape") this._closeEdit(); };
  private _openEdit(entity: string, e: Event) {
    e.stopPropagation();
    if (this._editEntity === entity && !this._closing) { this._closeEdit(); return; }
    this._editEntity = entity; this._closing = false; this._custom = false; this._editBri = undefined;
    document.addEventListener("keydown", this._onKey);
  }
  private _closeEdit() {
    if (!this._editEntity) return;
    this._closing = true;
    document.removeEventListener("keydown", this._onKey);
    window.setTimeout(() => { this._editEntity = undefined; this._closing = false; this._custom = false; }, 340);
  }
  private _lightBri(e: Event) {
    const v = Number((e.target as HTMLInputElement).value); this._editBri = v;
    const now = Date.now(); if (now - this._throttle > 220) { this._throttle = now; this._svc({ brightness_pct: v }); }
  }
  private _lightBriChange(e: Event) { this._svc({ brightness_pct: Number((e.target as HTMLInputElement).value) }); window.setTimeout(() => (this._editBri = undefined), 900); }
  private _lightTemp(e: Event) { this._svc({ color_temp_kelvin: Number((e.target as HTMLInputElement).value) }); }
  private _lightHue(e: Event) { const h = Number((e.target as HTMLInputElement).value); const now = Date.now(); if (now - this._throttle > 180) { this._throttle = now; this._svc({ rgb_color: hueToRgb(h) }); } }
  private _lightHueChange(e: Event) { this._svc({ rgb_color: hueToRgb(Number((e.target as HTMLInputElement).value)) }); }
  private _svc(data: Record<string, unknown>) { if (this._editEntity && this._hass) this._hass.callService("light", "turn_on", { entity_id: this._editEntity, ...data }); }

  private _openRoom(e: Event) {
    e.stopPropagation();
    const path = this.config.navigation_path; if (!path) return;
    const hash = path.startsWith("#") ? path : `#${path}`;
    history.replaceState(null, "", hash);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: true } }));
  }
  private _more(e?: string) { if (e && this._hass?.states[e]) moreInfo(this, e); }
  private _shortName(l: LightSpec): string { if (l.name) return l.name; const fn = this._attrs(l.entity).friendly_name ?? l.entity; return fn.replace(new RegExp(`^${this.config.name}\\s+`, "i"), "").trim() || fn; }

  render() {
    if (!this.config || !this._hass) return nothing;
    const c = this.config;
    const dark = !!(this._hass as any).themes?.darkMode;
    const present = this._presentLights;
    const onCount = this._onLights.length;
    const total = present.length;
    const anyOn = onCount > 0;
    const hasDimmable = this._presentDimmable.length > 0;
    const pct = this._dragVal ?? this._roomBriPct();
    const ambient = anyOn ? Math.max(0.15, (dark ? 0.9 : 0.45) * (onCount / Math.max(1, total)) * this._meanBriFrac()) : 0;

    return html`
      <ha-card class=${classMap({ lit: anyOn })} style=${styleMap({ "--rc-glow": this._glowColor(), "--pct": `${pct}%`, "--ambient": String(ambient) })}>
        <div class="ambient" aria-hidden="true"></div>

        <div class="header">
          <button class="key ${classMap({ on: anyOn })}" @click=${(e: Event) => this._openRoom(e)} tabindex="-1" aria-hidden="true"><ha-icon icon=${c.icon!}></ha-icon></button>
          <button class="title" @click=${(e: Event) => this._openRoom(e)} aria-label="Open ${c.name}">
            <span class="name">${c.name}</span><ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>
            <div class="count">${anyOn ? `${onCount} of ${total} on` : "off"}</div>
          </button>
          ${total ? html`<button class="power ${classMap({ on: anyOn })}" @click=${(e: Event) => this._toggleAll(e)} aria-label="Toggle ${c.name} lights"><svg viewBox="0 0 24 24" width="16" height="16"><path d=${POWER_PATH} fill="currentColor"></path></svg></button>` : nothing}
        </div>

        ${hasDimmable ? html`<div class="wellwrap">
          <div class="readout ${classMap({ show: this._dragVal !== undefined })}">${pct}%</div>
          <div class="well ${classMap({ dragging: this._dragging, cold: !anyOn })}">
            <div class="fill"></div>
            <input class="wellinput" type="range" min="1" max="100" .value=${String(Math.max(1, pct))}
              @pointerdown=${() => this._wellDown()} @pointerup=${() => this._wellUp()} @pointercancel=${() => this._wellUp()}
              @input=${(e: Event) => this._onInput(e)} @change=${(e: Event) => this._onChange(e)} @click=${(e: Event) => e.stopPropagation()} aria-label="${c.name} brightness" />
          </div>
        </div>` : nothing}

        ${present.length ? html`<div class="pills">
          ${present.map((l) => {
            const on = this._isOn(l.entity);
            const sw = this._isSwitch(l.entity);
            const tune = this._canTune(l.entity);
            const active = this._editEntity === l.entity && !this._closing;
            return html`<div class="pill ${classMap({ on })}" role="group">
              <button class="pt" @click=${(e: Event) => this._toggleOne(l.entity, e)}>
                <span class="dot ${classMap({ sq: sw })}" style=${styleMap(on ? { "--dot-color": this._dotColor(l.entity) } : {})}></span><span class="pn">${this._shortName(l)}</span>
              </button>
              ${tune ? html`<button class="tune ${classMap({ active })}" @click=${(e: Event) => this._openEdit(l.entity, e)} aria-expanded=${active} aria-label="Tune ${this._shortName(l)}"><ha-icon icon="mdi:tune-variant"></ha-icon></button>` : nothing}
            </div>`;
          })}
        </div>` : nothing}

        <div class="drawer ${classMap({ open: !!this._editEntity && !this._closing })}">
          <div class="drawerinner">${this._editEntity ? this._renderEditor(this._editEntity) : nothing}</div>
        </div>

        ${this._renderMedia()}
      </ha-card>
    `;
  }

  private _renderEditor(entity: string): TemplateResult {
    const a = this._attrs(entity);
    const name = this._shortName({ entity });
    const bri = this._editBri ?? this._briPct(entity);
    const isRgb = this._isRgb(entity);
    const isTemp = this._isTemp(entity);
    const curRgb = Array.isArray(a.rgb_color) ? (a.rgb_color as RGB).join(",") : "";
    return html`<div class="edit">
      <div class="edit-head">
        <span class="edit-dot" style=${styleMap({ "--dot-color": this._dotColor(entity) })}></span>
        <span class="edit-name">${name}</span>
        <button class="edit-close" @click=${() => this._closeEdit()} aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button>
      </div>
      <div class="well mini">
        <div class="fill" style=${styleMap({ width: `max(${bri}%, 9%)` })}></div>
        <input class="wellinput" type="range" min="1" max="100" .value=${String(Math.max(1, bri))}
          @input=${(e: Event) => this._lightBri(e)} @change=${(e: Event) => this._lightBriChange(e)} aria-label="${name} brightness" />
      </div>
      ${isRgb
        ? this._custom
          ? html`<div class="customrow">
              <button class="link" @click=${() => (this._custom = false)}><ha-icon icon="mdi:chevron-left"></ha-icon>swatches</button>
              <input class="hue" type="range" min="0" max="359" @input=${(e: Event) => this._lightHue(e)} @change=${(e: Event) => this._lightHueChange(e)} aria-label="Hue" />
            </div>`
          : html`<div class="swatches">
              ${[2700, 4000].map((k) => html`<button class="swatch" style=${styleMap({ background: kelvinDotColor(k) })} @click=${() => this._svc({ color_temp_kelvin: k })} aria-label="${k}K white"></button>`)}
              ${CURATED.map((s) => {
                const sel = curRgb === hexToRgb(s.hex).join(",");
                return html`<button class="swatch ${classMap({ sel })}" style=${styleMap({ background: s.hex })} @click=${() => this._svc({ rgb_color: hexToRgb(s.hex) })} aria-label=${s.name}></button>`;
              })}
              <button class="swatch custom" @click=${() => (this._custom = true)} aria-label="Custom colour"></button>
            </div>`
        : isTemp
          ? html`<input class="ct" type="range" min=${a.min_color_temp_kelvin ?? 2200} max=${a.max_color_temp_kelvin ?? 6500} .value=${String(a.color_temp_kelvin ?? 2700)} @input=${(e: Event) => this._lightTemp(e)} aria-label="Colour temperature" />`
          : nothing}
    </div>`;
  }

  private _renderMedia(): TemplateResult | typeof nothing {
    const m = this.config.media; if (!m) return nothing;
    const s = this._hass?.states[m]; if (!s || !PLAYING.has(s.state)) return nothing;
    const playing = s.state === "playing";
    const title = s.attributes.media_title || s.attributes.source || s.attributes.friendly_name || "Playing";
    return html`<button class="media" @click=${() => this._more(m)}><span class="eq ${classMap({ live: playing })}"><i></i><i></i><i></i></span><span class="mt">${title}</span></button>`;
  }

  static styles = css`
    @property --rc-glow { syntax: "<color>"; inherits: true; initial-value: #f2a93b; }
    :host { --amber: #f5b301; --edit-bg: color-mix(in srgb, var(--primary-text-color) 5%, transparent); --hair: color-mix(in srgb, var(--primary-text-color) 12%, transparent); display: block; }

    ha-card { position: relative; overflow: hidden; box-sizing: border-box; height: 100%; border-radius: var(--ha-card-border-radius, 16px); padding: 14px 14px 12px;
      background: var(--ha-card-background, var(--card-background-color, #16181d)); border: 1px solid var(--divider-color, rgba(0,0,0,.08));
      animation: mount .28s ease-out both; transition: border-color .6s ease, --rc-glow .8s linear; }
    ha-card.lit { border-color: color-mix(in srgb, var(--rc-glow) 22%, var(--divider-color, transparent)); }
    @keyframes mount { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    .ambient { position: absolute; inset: 0; pointer-events: none; z-index: 0; background: radial-gradient(140% 120% at 50% 82%, color-mix(in srgb, var(--rc-glow) 22%, transparent), transparent 65%); opacity: var(--ambient, 0); transition: opacity .6s ease; }
    .header, .wellwrap, .pills, .drawer, .media { position: relative; z-index: 1; }
    button { -webkit-appearance: none; appearance: none; font-family: inherit; border: none; background: none; padding: 0; margin: 0; cursor: pointer; color: inherit; }

    .header { display: grid; grid-template-columns: 36px 1fr auto; column-gap: 10px; align-items: center; }
    .key { width: 36px; height: 36px; border-radius: 11px; display: inline-flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); transition: background .5s ease; }
    ha-card.lit .key { background: color-mix(in srgb, var(--rc-glow) 12%, transparent); }
    .key ha-icon { --mdc-icon-size: 21px; color: var(--secondary-text-color); transition: color .5s ease; }
    ha-card.lit .key ha-icon { color: color-mix(in srgb, var(--rc-glow) 70%, var(--primary-text-color)); }
    .title { display: grid; grid-template-columns: auto auto 1fr; align-items: baseline; column-gap: 4px; text-align: left; min-width: 0; }
    .name { font-size: 15px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chev { --mdc-icon-size: 15px; color: var(--secondary-text-color); opacity: .5; transition: transform .15s ease, opacity .15s ease; align-self: center; }
    .title:hover .chev { transform: translateX(2px); opacity: .9; }
    .count { grid-column: 1 / -1; font-size: 11px; color: var(--secondary-text-color); margin-top: 2px; }
    .power { position: relative; width: 30px; height: 30px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: var(--secondary-text-color); border: 1.5px solid color-mix(in srgb, var(--primary-text-color) 20%, transparent); transition: background .2s, color .2s, border-color .2s, transform .09s; }
    .power.on { color: #1a1a1a; background: var(--amber); border-color: transparent; }
    .power:active { transform: scale(.94); }

    .wellwrap { margin-top: 12px; }
    .readout { text-align: right; height: 14px; margin-bottom: 3px; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--secondary-text-color); opacity: 0; transition: opacity .12s ease; }
    .readout.show { opacity: 1; }
    .well { position: relative; height: 30px; border-radius: 15px; overflow: hidden; background: color-mix(in srgb, var(--primary-text-color) 7%, transparent); }
    .well.mini { height: 22px; border-radius: 11px; }
    .fill { position: absolute; inset: 0 auto 0 0; width: max(var(--pct), 9%); border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--rc-glow) 55%, #fff8ec), var(--rc-glow)); box-shadow: inset 0 1px 0 rgb(255 255 255 / .35); transition: width .45s cubic-bezier(.22,1,.36,1), background .3s linear; }
    .well.cold .fill { width: 0; }
    .well.dragging .fill { transition: none; }
    .wellinput { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; -webkit-appearance: none; appearance: none; background: transparent; }
    .wellinput::-webkit-slider-thumb { -webkit-appearance: none; width: 30px; height: 30px; }
    .wellinput:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; border-radius: inherit; }

    .pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
    .pill { display: inline-flex; align-items: stretch; border-radius: 999px; overflow: hidden; border: 1px solid var(--hair); background: transparent; transition: background .22s ease, border-color .22s ease; }
    .pill.on { border-color: color-mix(in srgb, var(--rc-glow) 30%, transparent); background: color-mix(in srgb, var(--rc-glow) 11%, transparent); }
    .pt { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px 0 8px; font-size: 12px; font-weight: 500; color: var(--primary-text-color); }
    .pt .pn { color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); transition: color .22s ease; }
    .pill.on .pt .pn { color: var(--primary-text-color); }
    .dot { width: 8px; height: 8px; border-radius: 999px; box-sizing: border-box; border: 1.5px solid color-mix(in srgb, var(--primary-text-color) 32%, transparent); background: transparent; transition: background .3s linear, border-color .3s linear, transform .22s ease; }
    .dot.sq { border-radius: 2.5px; }
    .pill.on .dot { background: var(--dot-color, var(--amber)); border: 1px solid color-mix(in srgb, var(--primary-text-color) 25%, transparent); animation: settle .22s ease; }
    .tune { width: 30px; display: inline-flex; align-items: center; justify-content: center; border-left: 1px solid var(--hair); color: var(--secondary-text-color); transition: background .22s ease; }
    .tune ha-icon { --mdc-icon-size: 15px; opacity: .55; }
    .tune.active { background: color-mix(in srgb, var(--rc-glow) 16%, transparent); }
    .tune.active ha-icon { opacity: 1; color: color-mix(in srgb, var(--rc-glow) 60%, var(--primary-text-color)); }
    .pt:active, .tune:active { transform: scale(.96); }
    @keyframes settle { from { transform: scale(.6); } to { transform: scale(1); } }

    .drawer { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .32s cubic-bezier(.22,1,.36,1); }
    .drawer.open { grid-template-rows: 1fr; margin-top: 10px; }
    .drawerinner { min-height: 0; overflow: hidden; }
    .edit { background: var(--edit-bg); border: 1px solid var(--hair); border-radius: 12px; padding: 10px 11px; opacity: 0; transform: translateY(-4px); transition: opacity .24s ease .06s, transform .24s ease .06s; }
    .drawer.open .edit { opacity: 1; transform: none; }
    .edit-head { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
    .edit-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--dot-color, var(--amber)); border: 1px solid color-mix(in srgb, var(--primary-text-color) 25%, transparent); }
    .edit-name { flex: 1; font-size: 13px; font-weight: 600; }
    .edit-close { width: 24px; height: 24px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: var(--secondary-text-color); }
    .edit-close ha-icon { --mdc-icon-size: 16px; }
    .swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .swatch { width: 24px; height: 24px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent); }
    .swatch.sel { outline: 2px solid color-mix(in srgb, var(--primary-text-color) 40%, transparent); outline-offset: 2px; }
    .swatch.custom { background: conic-gradient(from 0deg, #e8543f, #f59632, #e8d13f, #4fa863, #2fa8c7, #5b6fd4, #b45bd4, #e8543f); }
    .customrow { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
    .link { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; color: var(--secondary-text-color); }
    .link ha-icon { --mdc-icon-size: 16px; }
    .ct, .hue { flex: 1; width: 100%; height: 22px; border-radius: 11px; margin-top: 10px; cursor: pointer; -webkit-appearance: none; appearance: none; box-shadow: inset 0 0 0 1px var(--hair); }
    .customrow .ct, .customrow .hue { margin-top: 0; }
    .ct { background: linear-gradient(90deg, #ff9d3d, #ffd9a0, #fff4e0, #dceaf5); }
    .hue { background: linear-gradient(90deg, #ff4d4d, #ffd24d, #4dff4d, #4dffff, #4d4dff, #ff4dff, #ff4d4d); }
    .ct::-webkit-slider-thumb, .hue::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 999px; background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / .4); }

    .media { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 11px; padding: 7px 10px; border-radius: 12px; text-align: left; background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); font-size: 12px; }
    .eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
    .eq i { width: 2px; height: 70%; background: var(--secondary-text-color); border-radius: 1px; }
    .eq.live i { animation: eq 1.6s ease-in-out infinite alternate; }
    .eq.live i:nth-child(2) { animation-delay: .35s; } .eq.live i:nth-child(3) { animation-delay: .7s; }
    @keyframes eq { from { height: 30%; } to { height: 100%; } }
    .mt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: color-mix(in srgb, var(--primary-text-color) 72%, transparent); }

    button:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

    @media (prefers-reduced-motion: reduce) {
      ha-card, .fill, .ambient, .pill, .dot, .power, .eq.live i, .drawer, .edit { animation: none !important; transition: opacity .12s linear, background .15s linear, color .15s linear !important; }
      ha-card { transition: none; }
      .drawer { transition: none; }
    }
  `;
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "homelab-room-card",
  name: "Room Card",
  description: "Calm room control: warm Lightwell, per-light colour dots, tap-to-tune brightness & colour.",
  preview: true,
});
