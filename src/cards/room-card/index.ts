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
  media?: string | string[]; // one player, or candidates (Cast/Jellyfin/etc.) — picks the richest active one
  navigation_path?: string;
}

const POWER_PATH = "M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.92 6.92 0 0 1 19 12a7 7 0 1 1-11.83-5.06L5.76 5.51a9 9 0 1 0 12.07.66z";

@customElement("homelab-room-card")
export class RoomCard extends LitElement {
  @state() private config!: RoomCardConfig;
  @state() private _editEntity?: string;
  @state() private _editBri?: number;
  @state() private _custom = false;
  private _hass?: HomeAssistant;
  private _throttle = 0;
  private _vDrag = false;
  // chip slide-to-dim
  @state() private _optBri?: { entity: string; pct: number }; // optimistic brightness shown while sliding / until the light confirms
  private _slideEntity?: string;
  private _slideStartX = 0;
  private _slideMoved = false;
  private _sliding = false;
  private _slideThrottle = 0;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.toggleAttribute("dark", !!(h?.themes as any)?.darkMode);
    // drop the optimistic value once the light actually reports the dragged brightness (kills the jump-back)
    if (this._optBri && !this._sliding) {
      const st = h?.states[this._optBri.entity];
      if (!st || st.state !== "on" || Math.abs(this._briPct(this._optBri.entity) - this._optBri.pct) <= 3) this._optBri = undefined;
    }
    this.requestUpdate();
  }
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
  private _briPct(e: string): number { return Math.round(((this._attrs(e).brightness ?? 0) / 255) * 100); }
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
  // tactile spring 'pop' — restarts the animation, plays only on real user taps
  private _pop(el: Element | null) {
    if (!el) return;
    el.classList.remove("pop");
    void (el as HTMLElement).offsetWidth; // reflow to restart
    el.classList.add("pop");
    window.setTimeout(() => el.classList.remove("pop"), 460);
  }
  private _toggleAll(e: Event) { e.stopPropagation(); if (!this._hass) return; this._pop(e.currentTarget as HTMLElement); const ids = this._presentLights.map((l) => l.entity); if (ids.length) this._hass.callService("light", this._onLights.length ? "turn_off" : "turn_on", { entity_id: ids }); }
  private _toggleOne(entity: string, e: Event) {
    e.stopPropagation();
    if (this._slideMoved) { this._slideMoved = false; return; } // was a slide, not a tap
    this._pop((e.currentTarget as HTMLElement).closest(".pill"));
    this._hass?.callService("light", "toggle", { entity_id: entity });
  }
  // drag a dimmable chip horizontally to set its brightness (tap still toggles)
  private _chipDown(entity: string, e: PointerEvent) {
    if (!this._canTune(entity)) return;
    this._slideEntity = entity; this._slideStartX = e.clientX; this._slideMoved = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  private _chipMove(entity: string, e: PointerEvent) {
    if (this._slideEntity !== entity) return;
    if (!this._slideMoved && Math.abs(e.clientX - this._slideStartX) < 6) return;
    this._slideMoved = true; this._sliding = true;
    const pill = (e.currentTarget as HTMLElement).closest(".pill") as HTMLElement | null;
    if (!pill) return;
    const r = pill.getBoundingClientRect();
    const pct = clamp(Math.round(((e.clientX - r.left) / r.width) * 100), 1, 100);
    this._optBri = { entity, pct }; // reactive: the render shows THIS, never the light's lagging value
    const now = Date.now();
    if (now - this._slideThrottle > 160) { this._slideThrottle = now; this._hass?.callService("light", "turn_on", { entity_id: entity, brightness_pct: pct, transition: 0 }); }
  }
  private _chipUp(entity: string) {
    if (this._slideEntity !== entity) return;
    this._slideEntity = undefined; this._sliding = false;
    if (this._slideMoved && this._optBri?.entity === entity) {
      this._hass?.callService("light", "turn_on", { entity_id: entity, brightness_pct: this._optBri.pct, transition: 0 });
      // keep showing the optimistic value until the light confirms (or 1.6s safety)
      window.setTimeout(() => { if (this._optBri?.entity === entity) { this._optBri = undefined; } }, 1600);
    } else {
      this._optBri = undefined;
    }
  }

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
    const ambient = anyOn ? Math.max(0.15, (dark ? 0.9 : 0.45) * (onCount / Math.max(1, total)) * this._meanBriFrac()) : 0;

    return html`
      <ha-card class=${classMap({ lit: anyOn })} style=${styleMap({ "--rc-glow": this._glowColor(), "--ambient": String(ambient) })}>
        <div class="ambient" aria-hidden="true"></div>

        <div class="header">
          <button class="key ${classMap({ on: anyOn })}" @click=${(e: Event) => this._openRoom(e)} tabindex="-1" aria-hidden="true"><ha-icon icon=${c.icon!}></ha-icon></button>
          <button class="title" @click=${(e: Event) => this._openRoom(e)} aria-label="Open ${c.name}">
            <span class="name">${c.name}</span><ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>
            <div class="count">${anyOn ? `${onCount} of ${total} on` : "off"}</div>
          </button>
          ${total ? html`<button class="power ${classMap({ on: anyOn })}" @click=${(e: Event) => this._toggleAll(e)} aria-label="Toggle ${c.name} lights"><svg viewBox="0 0 24 24" width="16" height="16"><path d=${POWER_PATH} fill="currentColor"></path></svg></button>` : nothing}
        </div>

        ${this._mediaMode() === "hero" ? this._mediaHero() : nothing}

        ${this._lights.length ? html`<div class="pills">
          ${this._lights.map((l) => {
            const slid = this._optBri?.entity === l.entity;
            const on = slid || this._isOn(l.entity);
            const offline = !this._isPresent(l.entity);
            const active = this._editEntity === l.entity;
            const bri = slid ? this._optBri!.pct : (on ? (this._isSwitch(l.entity) ? 100 : this._briPct(l.entity)) : 100);
            return html`<div class="pill ${classMap({ on, offline, sliding: slid })}" role="group" style=${styleMap({ "--bri": `${bri}%` })}>
              <button class="pt" @click=${(e: Event) => this._toggleOne(l.entity, e)}
                @pointerdown=${(e: PointerEvent) => this._chipDown(l.entity, e)}
                @pointermove=${(e: PointerEvent) => this._chipMove(l.entity, e)}
                @pointerup=${() => this._chipUp(l.entity)}
                @pointercancel=${() => this._chipUp(l.entity)}>
                <span class="dot ${classMap({ sq: this._isSwitch(l.entity) })}" style=${styleMap(on ? { "--dot-color": this._dotColor(l.entity) } : {})}></span><span class="pn">${this._shortName(l)}</span>
                ${offline ? html`<span class="pb off">offline</span>` : slid ? html`<span class="pb">${this._optBri!.pct}%</span>` : on && this._canTune(l.entity) ? html`<span class="pb">${this._briPct(l.entity)}%</span>` : nothing}
              </button>
              ${!offline && this._canTune(l.entity) ? html`<button class="tune ${classMap({ active })}" @click=${(e: Event) => this._openEdit(l.entity, e)} aria-label="Tune ${this._shortName(l)}"><ha-icon icon="mdi:tune-variant"></ha-icon></button>` : nothing}
            </div>`;
          })}
        </div>` : nothing}

        ${this._mediaMode() === "strip" ? this._mediaStrip() : nothing}
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

  // media can be one entity or a list of candidates; pick the richest ACTIVE one
  private _mediaEntity(): string | undefined {
    const m = this.config.media; if (!m) return undefined;
    const list = (Array.isArray(m) ? m : [m]).filter((e) => this._hass?.states[e]);
    if (!list.length) return undefined;
    const active = list.filter((e) => { const st = this._hass!.states[e].state; return st === "playing" || st === "paused" || st === "buffering"; });
    const pool = active.length ? active : list;
    return pool.slice().sort((a, b) => this._mScore(b) - this._mScore(a))[0];
  }
  private _mScore(e: string): number {
    const a = this._hass!.states[e].attributes;
    return (a.entity_picture ? 4 : 0) + (a.media_title ? 2 : 0) + (a.media_duration ? 1 : 0);
  }
  // rooms without a `media` entity render nothing; playing → top hero, idle → bottom strip
  private _mediaMode(): "hero" | "strip" | null {
    const m = this._mediaEntity(); if (!m) return null;
    const st = this._hass!.states[m].state;
    if (st === "playing" || st === "paused" || st === "buffering") return "hero";
    if (st === "off" || st === "unavailable" || st === "standby") return null;
    return "strip";
  }
  private _clock(sec: number): string {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }
  private _mFields(m: string) {
    const s = this._hass!.states[m]; const a = s.attributes;
    const dur = Number(a.media_duration) || 0; const posv = Number(a.media_position) || 0;
    return {
      playing: s.state === "playing",
      art: a.entity_picture as string | undefined,
      title: a.media_title || (s.state === "idle" ? "Idle" : a.app_name || a.source || "On"),
      sub: a.media_artist || a.media_series_title || a.app_name || a.source || "",
      third: a.media_album_name || a.media_season || "",
      feat: Number(a.supported_features ?? 0),
      pos: posv, dur,
      prog: dur > 0 ? Math.min(100, Math.max(0, (posv / dur) * 100)) : undefined,
      time: dur > 0 ? `${this._clock(posv)} / ${this._clock(dur)}` : "",
    };
  }
  private _mCtl(m: string, f: { feat: number; playing: boolean }, cls: string) {
    return html`
      ${f.feat & 16 ? html`<button class="${cls}" @click=${() => this._mediaSvc(m, "media_previous_track")} aria-label="Previous"><ha-icon icon="mdi:skip-previous"></ha-icon></button>` : nothing}
      ${f.feat & 16385 ? html`<button class="${cls} play" @click=${() => this._mediaSvc(m, "media_play_pause")} aria-label="Play or pause"><ha-icon icon=${f.playing ? "mdi:pause" : "mdi:play"}></ha-icon></button>` : nothing}
      ${f.feat & 32 ? html`<button class="${cls}" @click=${() => this._mediaSvc(m, "media_next_track")} aria-label="Next"><ha-icon icon="mdi:skip-next"></ha-icon></button>` : nothing}`;
  }
  private _mediaHero(): TemplateResult | typeof nothing {
    const m = this._mediaEntity(); if (!m) return nothing;
    const f = this._mFields(m);
    const bg = f.art ? { backgroundImage: `linear-gradient(0deg, rgba(0,0,0,.85), rgba(0,0,0,.2) 58%, rgba(0,0,0,.45)), url("${f.art}")` } : {};
    return html`<div class="mhero ${classMap({ hasart: !!f.art })}" style=${styleMap(bg)}>
      ${f.art ? nothing : html`<span class="mhviz"><span class="eq live"><i></i><i></i><i></i><i></i><i></i></span></span>`}
      <button class="mhtap" @click=${() => moreInfo(this, m)} aria-label="Open media"></button>
      <div class="mhcontent">
        <div class="mhmeta">
          <div class="mhwhere"><span class="eq live"><i></i><i></i><i></i></span>Now playing${f.time ? html` · <span class="mhtime">${f.time}</span>` : nothing}</div>
          <div class="mht">${f.title}</div>
          ${f.sub ? html`<div class="mhsub">${f.sub}</div>` : nothing}
          ${f.third && f.third !== f.sub ? html`<div class="mhthird">${f.third}</div>` : nothing}
        </div>
        <div class="mhctl">${this._mCtl(m, f, "mhb")}</div>
      </div>
      ${f.prog !== undefined ? html`<div class="mhprog"><div class="mhpf" style=${styleMap({ width: `${f.prog}%` })}></div></div>` : nothing}
    </div>`;
  }
  private _mediaStrip(): TemplateResult | typeof nothing {
    const m = this._mediaEntity(); if (!m) return nothing;
    const f = this._mFields(m);
    return html`<div class="media">
      <button class="mart ph" @click=${() => moreInfo(this, m)}><span class="eq ${classMap({ live: f.playing })}"><i></i><i></i><i></i></span></button>
      <button class="mmeta" @click=${() => moreInfo(this, m)}><span class="mt">${f.title}</span>${f.sub ? html`<span class="msub">${f.sub}</span>` : nothing}</button>
      ${this._mCtl(m, f, "mctl")}
    </div>`;
  }
  private _mediaSvc(entity: string, service: string) { this._hass?.callService("media_player", service, { entity_id: entity }); }

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
    /* tactile toggle 'pop' — spring bounce on tap (added via JS, plays once) */
    @keyframes rc-pop { 0% { transform: scale(1); } 22% { transform: scale(.92); } 55% { transform: scale(1.045); } 100% { transform: scale(1); } }
    .pill.pop, .power.pop { animation: rc-pop .42s var(--hl-settle); }

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
    /* on-chip is a horizontal brightness gauge: bright amber up to --bri, dim amber beyond */
    .pill.on { background: linear-gradient(90deg,
        color-mix(in oklab, var(--hl-amber) 36%, #fff) 0, color-mix(in oklab, var(--hl-amber) 36%, #fff) var(--bri, 100%),
        color-mix(in oklab, var(--hl-amber) 12%, #fff) var(--bri, 100%));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .5), 0 2px 6px rgb(184 124 0 / .22); transition: background .35s var(--hl-settle), box-shadow .28s var(--hl-settle); }
    .pt { display: inline-flex; align-items: center; gap: 8px; flex: 1; min-width: 0; min-height: 42px; padding: 0 13px; font-size: 12.5px; font-weight: 550; color: color-mix(in srgb, var(--primary-text-color) 70%, transparent); transition: color .28s ease; touch-action: pan-y; }
    .pill.sliding { transition: none !important; }
    .pill.sliding .pt { color: var(--hl-ink-on-amber); }
    .pt .pn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pb { margin-left: auto; padding-left: 8px; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--hl-ink-on-amber); opacity: .8; flex: 0 0 auto; }
    .pb.off { color: var(--hl-text-3); font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; opacity: 1; }
    .pill.offline { opacity: .5; }
    .pill.offline .pt { color: var(--hl-text-3); }
    :host([dark]) .pill.on .pb { color: color-mix(in srgb, var(--hl-amber) 60%, #fff); }
    .pt .pn { transition: color .28s ease; }
    .pill.on .pt, .pill.on .pt .pn { color: var(--hl-ink-on-amber); }
    :host([dark]) .pill.on .pt, :host([dark]) .pill.on .pt .pn { color: color-mix(in srgb, var(--hl-amber) 60%, #fff); }
    .dot { width: 8px; height: 8px; border-radius: 999px; box-sizing: border-box; border: 1.5px solid color-mix(in srgb, var(--primary-text-color) 30%, transparent); background: transparent; transition: background .3s linear, border-color .3s linear, box-shadow .3s ease, transform .22s ease; }
    .dot.sq { border-radius: 2.5px; }
    .pill.on .dot { background: var(--dot-color, var(--hl-amber)); border-color: transparent; box-shadow: 0 0 6px color-mix(in srgb, var(--dot-color, var(--hl-amber)) 60%, transparent); animation: settle .22s ease; }
    /* dark: on/lit states must out-specify the :host([dark]) off-well rules (":host()" inflates specificity) */
    :host([dark]) ha-card.lit .key { background: linear-gradient(180deg, var(--hl-amber-hot), var(--hl-amber-deep)); box-shadow: inset 0 1px 0 rgb(255 255 255 / .35), 0 2px 8px rgb(184 124 0 / .35); }
    :host([dark]) ha-card.lit .key ha-icon { color: var(--hl-ink-on-amber); }
    :host([dark]) .power.on { background: linear-gradient(180deg, var(--hl-amber-hot), var(--hl-amber-deep)); color: var(--hl-ink-on-amber); box-shadow: inset 0 1px 0 rgb(255 255 255 / .35), 0 0 0 4px color-mix(in srgb, var(--hl-amber) 18%, transparent), 0 4px 12px rgb(245 179 1 / .4); }
    :host([dark]) .pill.on { background: linear-gradient(90deg,
        color-mix(in oklab, var(--hl-amber) 42%, var(--card-background-color, #16181d)) 0, color-mix(in oklab, var(--hl-amber) 42%, var(--card-background-color, #16181d)) var(--bri, 100%),
        color-mix(in oklab, var(--hl-amber) 12%, var(--card-background-color, #16181d)) var(--bri, 100%));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .1), 0 2px 8px rgb(245 179 1 / .18); }

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

    .vbar { position: relative; height: 224px; border-radius: 24px; overflow: hidden; cursor: ns-resize; touch-action: none; user-select: none;
      background: color-mix(in oklab, rgb(var(--hl-ember)) 6%, var(--card-background-color, #fff)); box-shadow: inset 0 2px 6px rgb(var(--hl-ember) / .12), inset 0 -1px 0 rgb(255 255 255 / .3); }
    :host([dark]) .vbar { background: color-mix(in oklab, black 32%, var(--card-background-color, #16181d)); box-shadow: inset 0 3px 10px rgb(0 0 0 / .5); }
    .vfill { position: absolute; inset: auto 0 0 0; border-radius: 24px; transition: height .12s ease;
      background: linear-gradient(0deg, color-mix(in srgb, var(--fill) 84%, #000 10%), color-mix(in srgb, var(--fill) 96%, #fff 22%));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .45), 0 0 26px -4px color-mix(in srgb, var(--fill) 55%, transparent); }
    .vbar:active .vfill, .sheet .vbar.dragging .vfill { transition: none; }
    /* value badge — readable on any fill/well (was dark multiply text, invisible in dark mode) */
    .vmeta { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 1px; pointer-events: none;
      padding: 7px 15px; border-radius: 16px; color: #fff; background: rgb(0 0 0 / .32); backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px); box-shadow: 0 2px 8px rgb(0 0 0 / .3); }
    .vmeta ha-icon { --mdc-icon-size: 21px; }
    .vmeta span { font-size: 21px; font-weight: 800; font-variant-numeric: tabular-nums; }

    .swatches { display: flex; flex-wrap: wrap; gap: 11px; margin-top: 18px; justify-content: center; }
    .sw { width: 34px; height: 34px; border-radius: 999px; border: none; cursor: pointer; box-shadow: inset 0 0 0 1px rgb(255 255 255 / .15), 0 2px 6px rgb(var(--hl-ember) / .3); transition: transform .12s var(--hl-shift); }
    .sw.sel { outline: 2.5px solid var(--hl-amber); outline-offset: 2px; }
    .sw:active { transform: scale(.88); }
    .sw.wheel { background: conic-gradient(from 0deg, #e8543f, #f59632, #e8d13f, #4fa863, #2fa8c7, #5b6fd4, #b45bd4, #e8543f); }
    .crow { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
    .link { display: inline-flex; align-items: center; gap: 2px; font-size: 13px; color: var(--secondary-text-color); }
    .link ha-icon { --mdc-icon-size: 17px; }
    .ct, .hue { flex: 1; width: 100%; height: 26px; border-radius: 13px; margin-top: 16px; cursor: pointer; -webkit-appearance: none; appearance: none; box-shadow: inset 0 0 0 1px var(--hair); }
    .crow .ct, .crow .hue { margin-top: 0; }
    .ct { background: linear-gradient(90deg, #ff9d3d, #ffd9a0, #fff4e0, #dceaf5); }
    .hue { background: linear-gradient(90deg, #ff4d4d, #ffd24d, #4dff4d, #4dffff, #4d4dff, #ff4dff, #ff4d4d); }
    .ct::-webkit-slider-thumb, .hue::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; border-radius: 999px; background: #fff; box-shadow: 0 1px 5px rgb(0 0 0 / .45); }

    .media { display: flex; align-items: center; gap: 10px; width: 100%; margin-top: 11px; padding: 8px; border-radius: 14px;
      background: color-mix(in oklab, rgb(var(--hl-ember)) 5%, var(--card-background-color, #fff)); box-shadow: inset 0 1.5px 3px rgb(var(--hl-ember) / .06), inset 0 -1px 0 rgb(255 255 255 / .5); }
    :host([dark]) .media { background: color-mix(in oklab, black 20%, var(--card-background-color, #16181d)); box-shadow: inset 0 1.5px 3px rgb(0 0 0 / .3); }
    .mart { width: 40px; height: 40px; flex: 0 0 auto; border-radius: 10px; background-size: cover; background-position: center; display: flex; align-items: center; justify-content: center;
      background-color: color-mix(in oklab, rgb(var(--hl-ember)) 8%, var(--card-background-color, #fff)); box-shadow: inset 0 0 0 1px rgb(255 255 255 / .08); transition: transform var(--hl-d1) var(--hl-shift); }
    .mart:active { transform: scale(.94); }
    .eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
    .eq i { width: 2.5px; height: 60%; background: color-mix(in srgb, var(--hl-amber) 70%, var(--primary-text-color)); border-radius: 1px; }
    .eq.live i { animation: eq 1.5s ease-in-out infinite alternate; }
    .eq.live i:nth-child(2) { animation-delay: .3s; } .eq.live i:nth-child(3) { animation-delay: .6s; }
    @keyframes eq { from { height: 25%; } to { height: 100%; } }
    .mmeta { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; text-align: left; background: none; border: none; padding: 0; cursor: pointer; color: inherit; line-height: 1.25; }
    .mt { font-size: 13px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .msub { font-size: 11px; color: color-mix(in srgb, var(--primary-text-color) 50%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .mctl { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; border: none; cursor: pointer; color: var(--primary-text-color);
      background: color-mix(in oklab, rgb(var(--hl-ember)) 6%, var(--card-background-color, #fff)); transition: transform var(--hl-d1) var(--hl-shift); }
    :host([dark]) .mctl { background: color-mix(in oklab, black 26%, var(--card-background-color, #16181d)); }
    .mctl ha-icon { --mdc-icon-size: 19px; }
    .mctl:active { transform: scale(.9); }
    .mctl.play { color: var(--hl-ink-on-amber); background: linear-gradient(180deg, var(--hl-amber-hot), var(--hl-amber-deep)); box-shadow: inset 0 1px 0 rgb(255 255 255 / .35), 0 3px 10px rgb(245 179 1 / .35); }
    .mctl.play ha-icon { --mdc-icon-size: 21px; }

    /* --- media HERO (top of card when playing) --- */
    .mhero { position: relative; overflow: hidden; width: 100%; height: 122px; margin: 11px 0 2px; border-radius: 16px; background-size: cover; background-position: center;
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / .08), 0 8px 20px -10px rgb(var(--hl-ember) / .5); animation: hl-fade var(--hl-d3) var(--hl-settle) both; }
    .mhero:not(.hasart) { background: linear-gradient(135deg, color-mix(in oklab, var(--hl-amber) 34%, #1a1206), color-mix(in oklab, var(--hl-amber) 12%, #0c0a06)); }
    .mhviz { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; opacity: .4; }
    .mhviz .eq { height: 48px; gap: 6px; }
    .mhviz .eq i { width: 6px; height: 45%; background: var(--hl-amber); border-radius: 2px; }
    .mhtap { position: absolute; inset: 0; width: 100%; height: 100%; background: none; border: none; cursor: pointer; }
    .mhcontent { position: absolute; left: 14px; right: 12px; bottom: 12px; display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; pointer-events: none; }
    .mhmeta { min-width: 0; }
    .mhwhere { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: color-mix(in srgb, var(--hl-amber) 62%, #fff); text-shadow: 0 1px 3px rgb(0 0 0 / .7); }
    .mhwhere .eq { height: 9px; gap: 1.5px; } .mhwhere .eq i { width: 2px; height: 50%; background: currentColor; border-radius: 1px; }
    .mhtime { font-variant-numeric: tabular-nums; font-weight: 700; opacity: .9; }
    .mht { font-size: 16px; font-weight: 750; letter-spacing: -.01em; color: #fff; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 4px rgb(0 0 0 / .7); }
    .mhsub { font-size: 12.5px; color: rgb(255 255 255 / .85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 3px rgb(0 0 0 / .7); }
    .mhthird { font-size: 11px; color: rgb(255 255 255 / .6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 3px rgb(0 0 0 / .7); }
    .mhctl { display: flex; align-items: center; gap: 7px; flex: 0 0 auto; pointer-events: auto; }
    .mhb { width: 36px; height: 36px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; border: none; cursor: pointer; color: #fff;
      background: rgb(255 255 255 / .16); backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px); transition: transform var(--hl-d1) var(--hl-shift); }
    .mhb ha-icon { --mdc-icon-size: 20px; }
    .mhb:active { transform: scale(.9); }
    .mhb.play { width: 46px; height: 46px; color: var(--hl-ink-on-amber); background: linear-gradient(180deg, var(--hl-amber-hot), var(--hl-amber-deep)); box-shadow: 0 4px 14px rgb(245 179 1 / .5); }
    .mhb.play ha-icon { --mdc-icon-size: 25px; }
    .mhprog { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgb(255 255 255 / .18); }
    .mhpf { height: 100%; background: var(--hl-amber); box-shadow: 0 0 8px var(--hl-amber); transition: width 1s linear; }

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
