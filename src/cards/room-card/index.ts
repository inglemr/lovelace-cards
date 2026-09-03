import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo } from "../../shared/ha";
import { calmDotColor, kelvinDotColor, hueToRgb, type RGB } from "../../shared/color";

// GOVERNING RULE: hue is DATA, not atmosphere. A light's real hue is painted only
// in (1) the ≤8px pill dot (calm-clamped) and (2) the light-detail sheet the user
// opens. Card background/ambient/washes stay kelvin-warmth — never an alert.
const WARM = "#f2a93b";
const COOL = "#ffe8c2";
const CURATED: { name: string; hex: string }[] = [
  { name: "Ember", hex: "#e8543f" },
  { name: "Sunset", hex: "#f59632" },
  { name: "Gold", hex: "#e8c53f" },
  { name: "Fern", hex: "#4fa863" },
  { name: "Lagoon", hex: "#2fa8c7" },
  { name: "Twilight", hex: "#5b6fd4" },
  { name: "Orchid", hex: "#b45bd4" },
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
  @state() private _editBri?: number;
  @state() private _custom = false;
  private _hass?: HomeAssistant;
  private _throttle = 0;
  private _vDrag = false;

  set hass(h: HomeAssistant) { this._hass = h; this.toggleAttribute("dark", !!(h?.themes as any)?.darkMode); this.requestUpdate(); }
  get hass(): HomeAssistant | undefined { return this._hass; }

  static getStubConfig(): RoomCardConfig { return { type: "custom:homelab-room-card", name: "Room", lights: [] }; }
  setConfig(config: RoomCardConfig): void {
    if (!config || !config.name) throw new Error("homelab-room-card: 'name' is required");
    this.config = { icon: "mdi:sofa-outline", ...config };
  }
  getCardSize(): number { return 2; }
  disconnectedCallback(): void { super.disconnectedCallback(); }
  updated(): void {
    const dlg = this.renderRoot?.querySelector("dialog.sheet") as HTMLDialogElement | null;
    if (!dlg) return;
    if (this._editEntity && !dlg.open) dlg.showModal();
    else if (!this._editEntity && dlg.open) dlg.close();
  }

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

  // ---- room ----
  private _toggleAll(e: Event) { e.stopPropagation(); if (!this._hass) return; const ids = this._presentLights.map((l) => l.entity); if (ids.length) this._hass.callService("light", this._onLights.length ? "turn_off" : "turn_on", { entity_id: ids }); }
  private _toggleOne(entity: string, e: Event) { e.stopPropagation(); this._hass?.callService("light", "toggle", { entity_id: entity }); }
  private _wellDown() { this._dragging = true; }
  private _wellUp() { this._dragging = false; }
  private _onInput(e: Event) { const v = Number((e.target as HTMLInputElement).value); this._dragVal = v; const now = Date.now(); if (now - this._throttle > 220) { this._throttle = now; this._commitRoom(v); } }
  private _onChange(e: Event) { this._commitRoom(Number((e.target as HTMLInputElement).value)); window.setTimeout(() => { this._dragVal = undefined; this._dragging = false; }, 900); }
  private _commitRoom(v: number) { if (!this._hass) return; const ids = this._onDimmable.length ? this._onDimmable : this._presentDimmable; if (ids.length) this._hass.callService("light", "turn_on", { entity_id: ids, brightness_pct: v }); }

  // ---- light-detail sheet (native <dialog> → top layer, escapes ancestor transforms) ----
  private _openEdit(entity: string, e: Event) {
    e.stopPropagation();
    if (this._editEntity === entity) { this._closeEdit(); return; }
    this._editEntity = entity; this._custom = false; this._editBri = undefined;
  }
  private _closeEdit() { this._editEntity = undefined; this._custom = false; this._editBri = undefined; }
  private _vbarPos(e: PointerEvent) {
    const bar = this.renderRoot.querySelector(".vbar") as HTMLElement | null;
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    const pct = clamp(Math.round((1 - (e.clientY - r.top) / r.height) * 100), 1, 100);
    this._editBri = pct;
    const now = Date.now();
    if (now - this._throttle > 200) { this._throttle = now; this._svc({ brightness_pct: pct }); }
  }
  private _vDown(e: PointerEvent) { this._vDrag = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); this._vbarPos(e); }
  private _vMove(e: PointerEvent) { if (this._vDrag) this._vbarPos(e); }
  private _vUp() { if (!this._vDrag) return; this._vDrag = false; if (this._editBri != null) this._svc({ brightness_pct: this._editBri }); }
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
      <ha-card class=${classMap({ lit: anyOn })} style=${styleMap({ "--rc-glow": this._glowColor(), "--pct": `${pct}%`, "--pctnum": String(pct / 100), "--ambient": String(ambient) })}>
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
            <div class="fill"><span class="handle"></span><span class="lvl">${pct}%</span></div>
            <input class="wellinput" type="range" min="1" max="100" .value=${String(Math.max(1, pct))}
              @pointerdown=${() => this._wellDown()} @pointerup=${() => this._wellUp()} @pointercancel=${() => this._wellUp()}
              @input=${(e: Event) => this._onInput(e)} @change=${(e: Event) => this._onChange(e)} @click=${(e: Event) => e.stopPropagation()} aria-label="${c.name} brightness" />
          </div>
        </div>` : nothing}

        ${present.length ? html`<div class="pills">
          ${present.map((l) => {
            const on = this._isOn(l.entity);
            const active = this._editEntity === l.entity;
            return html`<div class="pill ${classMap({ on })}" role="group">
              <button class="pt" @click=${(e: Event) => this._toggleOne(l.entity, e)}>
                <span class="dot ${classMap({ sq: this._isSwitch(l.entity) })}" style=${styleMap(on ? { "--dot-color": this._dotColor(l.entity) } : {})}></span><span class="pn">${this._shortName(l)}</span>
                ${on && this._canTune(l.entity) ? html`<span class="pb">${this._briPct(l.entity)}%</span>` : nothing}
              </button>
              ${this._canTune(l.entity) ? html`<button class="tune ${classMap({ active })}" @click=${(e: Event) => this._openEdit(l.entity, e)} aria-label="Tune ${this._shortName(l)}"><ha-icon icon="mdi:tune-variant"></ha-icon></button>` : nothing}
            </div>`;
          })}
        </div>` : nothing}

        ${this._renderMedia()}
        ${this._renderSheet()}
      </ha-card>
    `;
  }

  private _renderSheet(): TemplateResult {
    const entity = this._editEntity;
    return html`<dialog class="sheet" @cancel=${(e: Event) => { e.preventDefault(); this._closeEdit(); }} @click=${(e: Event) => { if (e.target === e.currentTarget) this._closeEdit(); }}>
      ${entity ? this._renderSheetBody(entity) : nothing}
    </dialog>`;
  }

  private _renderSheetBody(entity: string): TemplateResult {
    const name = this._shortName({ entity });
    const a = this._attrs(entity);
    const on = this._isOn(entity);
    const bri = this._editBri ?? (on ? this._briPct(entity) : 0);
    const fill = this._dotColor(entity);
    const isRgb = this._isRgb(entity);
    const isTemp = this._isTemp(entity);
    const curRgb = Array.isArray(a.rgb_color) ? (a.rgb_color as RGB).join(",") : "";
    return html`
      <div class="sheet-body" @click=${(e: Event) => e.stopPropagation()}>
        <div class="sheet-head">
          <span class="sheet-name">${name}</span>
          <button class="sheet-x" @click=${() => this._closeEdit()} aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button>
        </div>

        <div class="vbar" style=${styleMap({ "--fill": fill })}
          @pointerdown=${(e: PointerEvent) => this._vDown(e)} @pointermove=${(e: PointerEvent) => this._vMove(e)} @pointerup=${() => this._vUp()} @pointercancel=${() => this._vUp()}
          role="slider" aria-label="${name} brightness" aria-valuenow=${bri}>
          <div class="vfill" style=${styleMap({ height: `${Math.max(bri, 3)}%` })}></div>
          <div class="vmeta"><ha-icon icon=${on ? "mdi:lightbulb" : "mdi:lightbulb-outline"}></ha-icon><span>${bri}%</span></div>
        </div>

        ${isRgb
          ? this._custom
            ? html`<div class="crow"><button class="link" @click=${() => (this._custom = false)}><ha-icon icon="mdi:chevron-left"></ha-icon>Presets</button>
                <input class="hue" type="range" min="0" max="359" @input=${(e: Event) => this._lightHue(e)} @change=${(e: Event) => this._lightHueChange(e)} aria-label="Hue" /></div>`
            : html`<div class="swatches">
                ${[2700, 4000].map((k) => html`<button class="sw" style=${styleMap({ background: kelvinDotColor(k) })} @click=${() => this._svc({ color_temp_kelvin: k })} aria-label="${k}K white"></button>`)}
                ${CURATED.map((s) => html`<button class="sw ${classMap({ sel: curRgb === hexToRgb(s.hex).join(",") })}" style=${styleMap({ background: s.hex })} @click=${() => this._svc({ rgb_color: hexToRgb(s.hex) })} aria-label=${s.name}></button>`)}
                <button class="sw wheel" @click=${() => (this._custom = true)} aria-label="Custom colour"></button>
              </div>`
          : isTemp
            ? html`<input class="ct" type="range" min=${a.min_color_temp_kelvin ?? 2200} max=${a.max_color_temp_kelvin ?? 6500} .value=${String(a.color_temp_kelvin ?? 2700)} @input=${(e: Event) => this._lightTemp(e)} aria-label="Colour temperature" />`
            : nothing}
      </div>
    `;
  }

  private _renderMedia(): TemplateResult | typeof nothing {
    const m = this.config.media; if (!m) return nothing;
    const s = this._hass?.states[m]; if (!s || !PLAYING.has(s.state)) return nothing;
    const playing = s.state === "playing";
    const title = s.attributes.media_title || s.attributes.source || s.attributes.friendly_name || "Playing";
    return html`<button class="media" @click=${() => { if (this._hass?.states[m]) moreInfo(this, m); }}><span class="eq ${classMap({ live: playing })}"><i></i><i></i><i></i></span><span class="mt">${title}</span></button>`;
  }

  static styles = [hearth, css`
    @property --rc-glow { syntax: "<color>"; inherits: true; initial-value: #f2a93b; }
    :host { --amber: #f5b301; --hair: color-mix(in srgb, var(--primary-text-color) 12%, transparent); display: block; }

    ha-card { position: relative; overflow: hidden; box-sizing: border-box; height: 100%; border-radius: var(--hl-r-card); padding: 14px 14px 12px;
      background: linear-gradient(180deg, color-mix(in oklab, var(--hl-amber) 4%, var(--card-background-color, #fff)), color-mix(in oklab, var(--hl-amber) 8%, var(--card-background-color, #fff)));
      border: 1px solid color-mix(in srgb, var(--hl-amber) 20%, transparent);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .75), 0 1px 2px rgb(var(--hl-ember) / .06), 0 6px 16px rgb(var(--hl-ember) / .08), 0 24px 48px -24px rgb(var(--hl-ember) / .16);
      animation: hl-rise var(--hl-d3) var(--hl-settle) both; transition: border-color .6s ease, box-shadow .5s ease, --rc-glow .8s linear; }
    :host([dark]) ha-card {
      background: linear-gradient(180deg, color-mix(in oklab, var(--hl-amber) 7%, var(--card-background-color, #16181d)), color-mix(in oklab, var(--hl-amber) 3%, var(--card-background-color, #16181d)));
      border-color: color-mix(in srgb, var(--hl-amber) 14%, transparent);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .06), 0 8px 24px rgb(0 0 0 / .35); }
    ha-card.lit { border-color: color-mix(in srgb, var(--hl-amber) 26%, transparent);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .75), 0 1px 2px rgb(var(--hl-ember) / .06), 0 6px 16px rgb(var(--hl-ember) / .08), 0 24px 48px -24px rgb(var(--hl-ember) / .16), 0 0 0 1px color-mix(in srgb, var(--hl-amber) 12%, transparent), 0 10px 30px -10px rgb(245 179 1 / .20); }
    :host([dark]) ha-card.lit { box-shadow: inset 0 1px 0 rgb(255 255 255 / .06), 0 8px 24px rgb(0 0 0 / .35), 0 10px 30px -12px rgb(245 179 1 / .28); }
    .ambient { position: absolute; inset: 0; pointer-events: none; z-index: 0; border-radius: inherit; overflow: hidden; background: radial-gradient(140% 120% at 50% 82%, color-mix(in srgb, var(--rc-glow) 22%, transparent), transparent 65%); opacity: var(--ambient, 0); transition: opacity .6s ease; }
    @keyframes mount { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .header, .wellwrap, .pills, .media { position: relative; z-index: 1; }
    button { -webkit-appearance: none; appearance: none; font-family: inherit; border: none; background: none; padding: 0; margin: 0; cursor: pointer; color: inherit; }

    .header { display: grid; grid-template-columns: 36px 1fr auto; column-gap: 10px; align-items: center; }
    .key { width: 40px; height: 40px; border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; transition: background .5s ease, box-shadow .5s ease;
      background: color-mix(in oklab, rgb(var(--hl-ember)) 5%, var(--card-background-color, #fff)); box-shadow: inset 0 1.5px 3px rgb(var(--hl-ember) / .08), inset 0 -1px 0 rgb(255 255 255 / .5); }
    :host([dark]) .key { background: color-mix(in oklab, black 22%, var(--card-background-color, #16181d)); box-shadow: inset 0 1.5px 3px rgb(0 0 0 / .4); }
    ha-card.lit .key { background: linear-gradient(180deg, var(--hl-amber-hot), var(--hl-amber-deep)); box-shadow: inset 0 1px 0 rgb(255 255 255 / .4), 0 2px 6px rgb(184 124 0 / .3); }
    .key ha-icon { --mdc-icon-size: 21px; color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); transition: color .5s ease; }
    ha-card.lit .key ha-icon { color: var(--hl-ink-on-amber); }
    .title { display: grid; grid-template-columns: auto auto 1fr; align-items: baseline; column-gap: 4px; text-align: left; min-width: 0; }
    .name { font-size: 15px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chev { --mdc-icon-size: 15px; color: var(--secondary-text-color); opacity: .5; transition: transform .15s ease, opacity .15s ease; align-self: center; }
    .title:hover .chev { transform: translateX(2px); opacity: .9; }
    .count { grid-column: 1 / -1; font-size: 11px; color: var(--secondary-text-color); margin-top: 2px; }
    .power { position: relative; width: 40px; height: 40px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; border: none;
      color: color-mix(in srgb, var(--primary-text-color) 55%, transparent);
      background: color-mix(in oklab, rgb(var(--hl-ember)) 5%, var(--card-background-color, #fff)); box-shadow: inset 0 1.5px 3px rgb(var(--hl-ember) / .08), inset 0 -1px 0 rgb(255 255 255 / .5);
      transition: background .3s, color .3s, box-shadow .3s, transform .09s; }
    :host([dark]) .power { background: color-mix(in oklab, black 22%, var(--card-background-color, #16181d)); box-shadow: inset 0 1.5px 3px rgb(0 0 0 / .4); }
    .power.on { color: var(--hl-ink-on-amber); background: linear-gradient(180deg, var(--hl-amber-hot), var(--hl-amber-deep));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .4), 0 0 0 4px color-mix(in srgb, var(--hl-amber) 14%, transparent), 0 4px 12px rgb(245 179 1 / .35); }
    .power:active { transform: scale(.94); }

    .wellwrap { margin-top: 12px; }
    .readout { text-align: right; height: 14px; margin-bottom: 3px; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--secondary-text-color); opacity: 0; transition: opacity .12s ease; }
    .readout.show { opacity: 1; }
    .well { position: relative; height: 44px; border-radius: 22px; overflow: hidden;
      background: color-mix(in oklab, rgb(var(--hl-ember)) 5%, var(--card-background-color, #fff)); box-shadow: inset 0 1.5px 3px rgb(var(--hl-ember) / .1), inset 0 -1px 0 rgb(255 255 255 / .5); }
    :host([dark]) .well { background: color-mix(in oklab, black 24%, var(--card-background-color, #16181d)); box-shadow: inset 0 2px 4px rgb(0 0 0 / .45); }
    .fill { position: absolute; inset: 0 auto 0 0; width: max(var(--pct), 12%); border-radius: inherit; overflow: hidden;
      background: linear-gradient(180deg, var(--hl-amber-hot), var(--hl-amber-deep));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .45), inset 0 -1px 2px rgb(var(--hl-ember) / .15);
      transition: width .45s var(--hl-settle); }
    /* under-glow: opacity IS the brightness */
    .fill::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; box-shadow: 0 3px 14px rgb(245 179 1 / .5); opacity: var(--pctnum, 0); transition: opacity .45s ease; }
    .well.cold .fill { width: 0; }
    .well.dragging .fill { transition: none; }
    .fill .handle { position: absolute; right: 8px; top: 20%; height: 60%; width: 3px; border-radius: 3px; background: rgb(255 255 255 / .85); box-shadow: 0 1px 2px rgb(var(--hl-ember) / .25); }
    .fill .lvl { position: absolute; right: 18px; top: 50%; transform: translateY(-50%); font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--hl-ink-on-amber); }
    .well.cold .fill .lvl, .well.cold .fill .handle { display: none; }
    .wellinput { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; -webkit-appearance: none; appearance: none; background: transparent; }
    .wellinput::-webkit-slider-thumb { -webkit-appearance: none; width: 44px; height: 44px; }
    .wellinput:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; border-radius: inherit; }

    .pills { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
    .pill { display: flex; align-items: stretch; width: 100%; border-radius: 12px; overflow: hidden; border: none; min-height: 42px;
      background: color-mix(in oklab, rgb(var(--hl-ember)) 5%, var(--card-background-color, #fff)); box-shadow: inset 0 1.5px 3px rgb(var(--hl-ember) / .07), inset 0 -1px 0 rgb(255 255 255 / .5);
      transition: background .28s var(--hl-settle), box-shadow .28s var(--hl-settle); }
    :host([dark]) .pill { background: color-mix(in oklab, black 20%, var(--card-background-color, #16181d)); box-shadow: inset 0 1.5px 3px rgb(0 0 0 / .35); }
    .pill.on { background: linear-gradient(180deg, color-mix(in oklab, var(--hl-amber) 22%, var(--card-background-color, #fff)), color-mix(in oklab, var(--hl-amber) 32%, var(--card-background-color, #fff)));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .5), 0 2px 6px rgb(184 124 0 / .22); }
    .pt { display: inline-flex; align-items: center; gap: 8px; flex: 1; min-width: 0; min-height: 42px; padding: 0 13px; font-size: 12.5px; font-weight: 550; color: color-mix(in srgb, var(--primary-text-color) 70%, transparent); transition: color .28s ease; }
    .pt .pn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pb { margin-left: auto; padding-left: 8px; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--hl-ink-on-amber); opacity: .8; flex: 0 0 auto; }
    :host([dark]) .pill.on .pb { color: color-mix(in srgb, var(--hl-amber) 60%, #fff); }
    .pt .pn { transition: color .28s ease; }
    .pill.on .pt, .pill.on .pt .pn { color: var(--hl-ink-on-amber); }
    :host([dark]) .pill.on .pt, :host([dark]) .pill.on .pt .pn { color: color-mix(in srgb, var(--hl-amber) 60%, #fff); }
    .dot { width: 8px; height: 8px; border-radius: 999px; box-sizing: border-box; border: 1.5px solid color-mix(in srgb, var(--primary-text-color) 30%, transparent); background: transparent; transition: background .3s linear, border-color .3s linear, box-shadow .3s ease, transform .22s ease; }
    .dot.sq { border-radius: 2.5px; }
    .pill.on .dot { background: var(--dot-color, var(--hl-amber)); border-color: transparent; box-shadow: 0 0 6px color-mix(in srgb, var(--dot-color, var(--hl-amber)) 60%, transparent); animation: settle .22s ease; }
    .tune { width: 40px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; border-left: 1px solid color-mix(in srgb, currentColor 14%, transparent); color: inherit; transition: background .22s ease; }
    .tune ha-icon { --mdc-icon-size: 15px; opacity: .55; }
    .tune.active { background: rgb(255 255 255 / .25); }
    .tune.active ha-icon { opacity: 1; }
    .pt:active, .tune:active { transform: scale(.96); }
    @keyframes settle { from { transform: scale(.6); } to { transform: scale(1); } }

    /* ---- Apple-style light-detail sheet (native <dialog>, top layer) ---- */
    dialog.sheet { border: none; padding: 0; margin: auto; background: transparent; max-width: none; max-height: none; overflow: visible; }
    dialog.sheet::backdrop { background: rgba(10,10,14,.45); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
    .sheet-body { width: min(300px, calc(100vw - 40px)); background: var(--ha-card-background, var(--card-background-color, #1b1d23)); border: 1px solid var(--hair);
      border-radius: 28px; padding: 16px 18px 20px; box-shadow: 0 30px 70px -24px rgba(0,0,0,.6); }
    dialog.sheet[open] .sheet-body { animation: sheetin .26s var(--hl-settle); }
    @keyframes sheetin { from { opacity: 0; transform: scale(.94) translateY(8px); } to { opacity: 1; transform: none; } }
    .sheet-head { display: flex; align-items: center; margin-bottom: 14px; }
    .sheet-name { flex: 1; font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
    .sheet-x { width: 28px; height: 28px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: var(--secondary-text-color); background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
    .sheet-x ha-icon { --mdc-icon-size: 17px; }

    .vbar { position: relative; height: 240px; border-radius: 26px; overflow: hidden; cursor: ns-resize; touch-action: none; user-select: none;
      background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
    .vfill { position: absolute; inset: auto 0 0 0; border-radius: 26px; background: linear-gradient(0deg, color-mix(in srgb, var(--fill) 78%, #000 6%), color-mix(in srgb, var(--fill) 92%, #fff 30%)); box-shadow: inset 0 1px 0 rgb(255 255 255 / .4); transition: height .12s ease; }
    .vbar:active .vfill, .sheet .vbar.dragging .vfill { transition: none; }
    .vmeta { position: absolute; inset: auto 0 16px 0; display: flex; flex-direction: column; align-items: center; gap: 3px; color: #1a1a1a; mix-blend-mode: multiply; pointer-events: none; }
    .vmeta ha-icon { --mdc-icon-size: 22px; }
    .vmeta span { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }

    .swatches { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; justify-content: center; }
    .sw { width: 30px; height: 30px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent); transition: transform .1s ease; }
    .sw:active { transform: scale(.9); }
    .sw.sel { outline: 2px solid color-mix(in srgb, var(--primary-text-color) 45%, transparent); outline-offset: 2px; }
    .sw.wheel { background: conic-gradient(from 0deg, #e8543f, #f59632, #e8d13f, #4fa863, #2fa8c7, #5b6fd4, #b45bd4, #e8543f); }
    .crow { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
    .link { display: inline-flex; align-items: center; gap: 2px; font-size: 13px; color: var(--secondary-text-color); }
    .link ha-icon { --mdc-icon-size: 17px; }
    .ct, .hue { flex: 1; width: 100%; height: 26px; border-radius: 13px; margin-top: 16px; cursor: pointer; -webkit-appearance: none; appearance: none; box-shadow: inset 0 0 0 1px var(--hair); }
    .crow .ct, .crow .hue { margin-top: 0; }
    .ct { background: linear-gradient(90deg, #ff9d3d, #ffd9a0, #fff4e0, #dceaf5); }
    .hue { background: linear-gradient(90deg, #ff4d4d, #ffd24d, #4dff4d, #4dffff, #4d4dff, #ff4dff, #ff4d4d); }
    .ct::-webkit-slider-thumb, .hue::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 999px; background: #fff; box-shadow: 0 1px 5px rgb(0 0 0 / .45); }

    .media { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 11px; padding: 7px 10px; border-radius: 12px; text-align: left; background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); font-size: 12px; }
    .eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
    .eq i { width: 2px; height: 70%; background: var(--secondary-text-color); border-radius: 1px; }
    .eq.live i { animation: eq 1.6s ease-in-out infinite alternate; }
    .eq.live i:nth-child(2) { animation-delay: .35s; } .eq.live i:nth-child(3) { animation-delay: .7s; }
    @keyframes eq { from { height: 30%; } to { height: 100%; } }
    .mt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: color-mix(in srgb, var(--primary-text-color) 72%, transparent); }

    button:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

    @media (prefers-reduced-motion: reduce) {
      ha-card, .fill, .ambient, .pill, .dot, .power, .eq.live i, .sheet-body, .vfill { animation: none !important; transition: opacity .12s linear !important; }
      ha-card { transition: none; }
    }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "homelab-room-card",
  name: "Room Card",
  description: "Calm room control: warm Lightwell, colour dots, Apple-style per-light detail sheet.",
  preview: true,
});
