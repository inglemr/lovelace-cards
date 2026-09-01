import { LitElement, html, svg, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { HomeAssistant } from "../../shared/ha";
import { stateStr, stateNum, entityPicture, moreInfo, pct, isUnknown } from "../../shared/ha";
import { DEFAULTS, type PhevVehicleCardConfig, type StatusChipConfig, type TabId } from "./config";
import { styles } from "./styles";

const STATE_LABELS: Record<string, string> = {
  chargingended: "Charge complete",
  chargingfinished: "Charge complete",
  fullycharged: "Fully charged",
  notcharging: "Not charging",
  charging: "Charging",
  chargingactive: "Charging",
  chargingpaused: "Paused",
  chargingstopped: "Stopped",
  error: "Error",
  invalid: "—",
};
function prettyState(s: string): string {
  const k = s.toLowerCase().replace(/[\s_]/g, "");
  return STATE_LABELS[k] ?? s.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase());
}
function isCharging(s?: string): boolean {
  if (!s) return false;
  const l = s.toLowerCase();
  if (l.includes("ended") || l.includes("finished") || l.includes("complete")) return false;
  return l.includes("charging") && !l.includes("not");
}
function isSecured(s?: string): boolean {
  const l = (s ?? "").toLowerCase();
  return l === "secured" || l === "locked" || l === "closed";
}
function isOpen(s?: string): boolean {
  const l = (s ?? "").toLowerCase();
  return l === "on" || l === "open" || l === "opened";
}
function fmtDur(mins?: number): string | undefined {
  if (mins === undefined || mins <= 0) return undefined;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type Pt = { t: number; v: number };
const TONE_COLOR: Record<string, string> = { good: "var(--pv-good)", amber: "var(--pv-fuel)", alert: "var(--pv-alert)", grey: "var(--pv-grey)" };

const RANGES: { key: number; label: string }[] = [
  { key: 24, label: "24h" },
  { key: 168, label: "7d" },
  { key: 720, label: "30d" },
];

@customElement("phev-vehicle-card")
export class PhevVehicleCard extends LitElement {
  static styles = styles;

  @state() private config!: PhevVehicleCardConfig;
  @state() private tab: TabId = "overview";
  @state() private rangeHours = 168;
  @state() private hist?: { elec: Pt[]; fuel: Pt[]; key: string };
  private _histLoading = false;
  private _hass?: HomeAssistant;

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
      stream_status: config.stream_status ?? DEFAULTS.stream_status,
      charging: { ...DEFAULTS.charging, ...(config.charging ?? {}) },
      tyres: { ...DEFAULTS.tyres, ...(config.tyres ?? {}) },
      trips: { ...DEFAULTS.trips, ...(config.trips ?? {}) },
      history: { ...DEFAULTS.history, ...(config.history ?? {}) },
      statuses: config.statuses ?? (DEFAULTS.statuses as StatusChipConfig[]),
      doors: config.doors ?? DEFAULTS.doors,
      windows: config.windows ?? DEFAULTS.windows,
    };
    this.tab = config.default_tab ?? DEFAULTS.default_tab;
  }

  getCardSize(): number {
    return 8;
  }

  updated(): void {
    if (this.tab === "history" && this._hass && this.hist?.key !== String(this.rangeHours)) {
      this._loadHistory();
    }
  }

  private async _loadHistory(): Promise<void> {
    if (this._histLoading || !this._hass) return;
    const c = this.config;
    const elecE = c.history?.electric;
    const fuelE = c.history?.fuel;
    if (!elecE && !fuelE) return;
    this._histLoading = true;
    const key = String(this.rangeHours);
    const end = new Date();
    const start = new Date(end.getTime() - this.rangeHours * 3600 * 1000);
    try {
      const ids = [elecE, fuelE].filter(Boolean) as string[];
      const res: any = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
      });
      const parse = (id?: string): Pt[] => {
        if (!id || !res?.[id]) return [];
        return (res[id] as any[])
          .map((p) => ({ t: (p.lu ?? p.last_updated) * 1000, v: Number(p.s ?? p.state) }))
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
      };
      this.hist = { elec: parse(elecE), fuel: parse(fuelE), key };
    } catch (e) {
      this.hist = { elec: [], fuel: [], key };
    } finally {
      this._histLoading = false;
    }
  }

  private _more(entityId?: string) {
    if (entityId && this._hass?.states[entityId]) moreInfo(this, entityId);
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const c = this.config;
    const chargeState = stateStr(this._hass, c.charging?.state);
    const charging = isCharging(chargeState);

    return html`
      <ha-card>
        ${this._renderHeader(charging)}
        ${this._renderHero()}
        <div class="gauges">${this._renderElectric()}${this._renderFuel()}</div>
        ${charging ? this._renderChargeStrip() : nothing}
        ${this._renderTabs()}
        <div class="tabpane">${this._renderPane()}</div>
        ${this._renderFooter()}
      </ha-card>
    `;
  }

  // ---- header ----
  private _renderHeader(charging: boolean): TemplateResult {
    const c = this.config;
    const plug = stateStr(this._hass, c.charging?.plug);
    const plugged = plug ? plug.toLowerCase() === "connected" : false;
    const lock = stateStr(this._hass, c.lock);
    const secured = isSecured(lock);
    return html`
      <div class="header">
        <div class="title"><span class="brand">BMW</span>${c.name}</div>
        <div class="spacer"></div>
        ${charging
          ? html`<span class="pill charge"><ha-icon icon="mdi:flash"></ha-icon>Charging</span>`
          : plugged
            ? html`<span class="pill charge"><ha-icon icon="mdi:power-plug"></ha-icon>Plugged in</span>`
            : nothing}
        ${lock !== undefined
          ? html`<span class=${classMap({ pill: true, good: secured, alert: !secured })}>
              <ha-icon icon=${secured ? "mdi:lock" : "mdi:lock-open-variant"}></ha-icon>${secured ? "Secured" : "Unlocked"}
            </span>`
          : nothing}
      </div>
    `;
  }

  private _renderHero(): TemplateResult {
    const c = this.config;
    const pic = c.image_entity ? entityPicture(this._hass, c.image_entity) : c.image;
    return html`<div class="hero">
      ${pic
        ? html`<img src=${pic} alt=${c.name ?? "vehicle"} @click=${() => this._more(c.image_entity)} />`
        : html`<ha-icon class="noimg" icon="mdi:car-sports"></ha-icon>`}
    </div>`;
  }

  // ---- gauges ----
  private _renderElectric(): TemplateResult {
    const c = this.config;
    const soc = stateNum(this._hass, c.electric?.soc);
    const range = stateNum(this._hass, c.electric?.range);
    return html`<div class="gauge" @click=${() => this._more(c.electric?.soc)}>
      <div class="gauge-top">
        <ha-icon icon="mdi:lightning-bolt" style="color:var(--pv-elec)"></ha-icon>
        <span class="lbl">${c.electric?.name ?? "Electric"}</span>
        ${range !== undefined ? html`<span class="sub">· ${Math.round(range)} km range</span>` : nothing}
        <span class="spacer"></span>
        <span class="val">${soc !== undefined ? Math.round(soc) : "–"}<small>%</small></span>
      </div>
      <div class="track"><div class="fill elec" style=${styleMap({ width: `${pct(soc)}%` })}></div></div>
    </div>`;
  }

  private _renderFuel(): TemplateResult {
    const c = this.config;
    const level = stateNum(this._hass, c.fuel?.level);
    const litres = stateNum(this._hass, c.fuel?.litres);
    let range = stateNum(this._hass, c.fuel?.range);
    if (range === undefined) {
      const total = stateNum(this._hass, c.total_range);
      const ev = stateNum(this._hass, c.electric?.range);
      if (total !== undefined && ev !== undefined) range = Math.max(0, total - ev);
    }
    const sub = [litres !== undefined ? `${Math.round(litres)} L` : undefined, range !== undefined ? `${Math.round(range)} km range` : undefined]
      .filter(Boolean)
      .join(" · ");
    return html`<div class="gauge" @click=${() => this._more(c.fuel?.level)}>
      <div class="gauge-top">
        <ha-icon icon="mdi:gas-station" style="color:var(--pv-fuel)"></ha-icon>
        <span class="lbl">${c.fuel?.name ?? "Fuel"}</span>
        ${sub ? html`<span class="sub">· ${sub}</span>` : nothing}
        <span class="spacer"></span>
        <span class="val">${level !== undefined ? Math.round(level) : "–"}<small>%</small></span>
      </div>
      <div class="track"><div class="fill fuel" style=${styleMap({ width: `${pct(level)}%` })}></div></div>
    </div>`;
  }

  private _renderChargeStrip(): TemplateResult {
    const c = this.config;
    const ttf = fmtDur(stateNum(this._hass, c.charging?.time_to_full));
    const amps = stateNum(this._hass, c.charging?.ac_current);
    const volts = stateNum(this._hass, c.charging?.ac_voltage);
    const kw = amps !== undefined && volts && volts > 0 ? (amps * volts * 3) / 1000 : undefined;
    const items: TemplateResult[] = [];
    if (kw !== undefined && kw > 0.1) items.push(html`<span class="ci"><ha-icon icon="mdi:flash"></ha-icon><b>${kw.toFixed(1)}</b> <span>kW</span></span>`);
    else if (amps) items.push(html`<span class="ci"><ha-icon icon="mdi:flash"></ha-icon><b>${amps.toFixed(0)}</b> <span>A</span></span>`);
    if (ttf) items.push(html`<span class="ci"><ha-icon icon="mdi:timer-sand"></ha-icon><b>${ttf}</b> <span>to full</span></span>`);
    return html`<div class="charge-strip"><span class="ci"><ha-icon icon="mdi:ev-station"></ha-icon><b>Charging</b></span>${items}</div>`;
  }

  // ---- tabs ----
  private _renderTabs(): TemplateResult {
    const tabs: { id: TabId; icon: string; label: string }[] = [
      { id: "overview", icon: "mdi:view-dashboard-outline", label: "Overview" },
      { id: "tyres", icon: "mdi:tire", label: "Tyres" },
      { id: "charging", icon: "mdi:ev-station", label: "Charging" },
      { id: "history", icon: "mdi:chart-line", label: "History" },
    ];
    return html`<div class="tabs">
      ${tabs.map(
        (t) => html`<div class=${classMap({ tab: true, active: this.tab === t.id })} @click=${() => (this.tab = t.id)}>
          <ha-icon icon=${t.icon}></ha-icon><span class="txt">${t.label}</span>
        </div>`
      )}
    </div>`;
  }

  private _renderPane() {
    switch (this.tab) {
      case "tyres": return this._paneTyres();
      case "charging": return this._paneCharging();
      case "history": return this._paneHistory();
      default: return this._paneOverview();
    }
  }

  // ---- overview pane: clear status chips ----
  private _chip(icon: string, label: string, tone: "good" | "alert" | "info" | "muted", onClick?: () => void): TemplateResult {
    return html`<span class=${classMap({ pill: true, good: tone === "good", alert: tone === "alert", info: tone === "info" })} @click=${onClick ?? nothing}>
      <ha-icon icon=${icon}></ha-icon>${label}
    </span>`;
  }

  private _summaryChip(entities: string[] | undefined, label: string, iconClosed: string, iconOpen: string): TemplateResult | typeof nothing {
    if (!entities?.length) return nothing;
    const present = entities.filter((e) => !isUnknown(this._hass, e));
    if (!present.length) return nothing;
    const open = present.filter((e) => isOpen(stateStr(this._hass, e)));
    return open.length
      ? this._chip(iconOpen, `${open.length} ${label.toLowerCase()} open`, "alert")
      : this._chip(iconClosed, `${label} closed`, "good");
  }

  private _statusChip(cfg: StatusChipConfig): TemplateResult | typeof nothing {
    if (isUnknown(this._hass, cfg.entity)) return nothing;
    const raw = stateStr(this._hass, cfg.entity)!;
    if (cfg.kind === "onoff") {
      const on = raw.toLowerCase() === "on";
      return this._chip(cfg.icon ?? "mdi:information-outline", on ? cfg.on_label ?? `${cfg.name} on` : cfg.off_label ?? `${cfg.name} off`, on ? "info" : "muted", () => this._more(cfg.entity));
    }
    // opening
    const open = isOpen(raw);
    const icon = open ? cfg.on_icon ?? cfg.icon ?? "mdi:alert-circle-outline" : cfg.icon ?? "mdi:check-circle-outline";
    return this._chip(icon, `${cfg.name} ${open ? "open" : "closed"}`, open ? "alert" : "good", () => this._more(cfg.entity));
  }

  private _paneOverview(): TemplateResult {
    const c = this.config;
    return html`<div class="statuses">
      ${this._summaryChip(c.doors, "Doors", "mdi:car-door-lock", "mdi:car-door")}
      ${this._summaryChip(c.windows, "Windows", "mdi:car-windshield", "mdi:window-open-variant")}
      ${(c.statuses ?? []).map((s) => this._statusChip(s))}
    </div>`;
  }

  // ---- tyres pane: top-down diagram ----
  private _tyreTone(corner?: { pressure?: string; target?: string }): { p?: number; d?: number; color: string } {
    const p = stateNum(this._hass, corner?.pressure);
    const t = stateNum(this._hass, corner?.target);
    if (p === undefined || p === 0) return { p, color: TONE_COLOR.grey };
    if (t === undefined) return { p, color: TONE_COLOR.good };
    const d = Math.round(p - t);
    const ad = Math.abs(d);
    const tone = ad <= 20 ? "good" : ad <= 35 ? "amber" : "alert";
    return { p, d, color: TONE_COLOR[tone] };
  }

  private _paneTyres(): TemplateResult {
    const t = this.config.tyres ?? {};
    const fl = this._tyreTone(t.front_left);
    const fr = this._tyreTone(t.front_right);
    const rl = this._tyreTone(t.rear_left);
    const rr = this._tyreTone(t.rear_right);
    const tyre = (x: number, y: number, c: { color: string }) => svg`<rect class="tyre" x=${x} y=${y} width="16" height="40" rx="5" fill=${c.color} />`;
    const label = (x: number, y: number, anchor: string, c: { p?: number; d?: number; color: string }) => svg`
      <text class="tyre-p" x=${x} y=${y} text-anchor=${anchor}>${c.p !== undefined ? Math.round(c.p) : "–"}<tspan class="u"> kPa</tspan></text>
      ${c.d !== undefined ? svg`<text class="tyre-d" x=${x} y=${y + 14} text-anchor=${anchor} fill=${c.color}>${c.d >= 0 ? "+" : ""}${c.d} vs target</text>` : nothing}
    `;
    return html`<div class="tyre-wrap">
      <svg class="tyre-svg" viewBox="0 0 340 200">
        <rect class="tyre-body" x="130" y="16" width="80" height="168" rx="30" />
        <rect class="tyre-glass" x="142" y="52" width="56" height="44" rx="14" />
        <rect class="tyre-glass" x="142" y="104" width="56" height="40" rx="14" />
        ${tyre(112, 44, fl)} ${tyre(212, 44, fr)}
        ${tyre(112, 116, rl)} ${tyre(212, 116, rr)}
        ${label(104, 60, "end", fl)} ${label(236, 60, "start", fr)}
        ${label(104, 132, "end", rl)} ${label(236, 132, "start", rr)}
      </svg>
    </div>`;
  }

  // ---- charging pane ----
  private _stat(icon: string, k: string, v: TemplateResult | string, wide = false, entity?: string): TemplateResult {
    return html`<div class=${classMap({ stat: true, wide })} @click=${entity ? () => this._more(entity) : nothing} style=${entity ? "cursor:pointer" : ""}>
      <ha-icon icon=${icon} style="color:var(--pv-muted)"></ha-icon>
      <div><div class="k">${k}</div><div class="v">${v}</div></div>
    </div>`;
  }
  private _kwh(entity?: string): TemplateResult {
    const n = stateNum(this._hass, entity);
    return html`${n !== undefined ? n.toFixed(n < 10 ? 2 : 1) : "–"}<small>kWh</small>`;
  }

  private _paneCharging(): TemplateResult {
    const c = this.config;
    const st = stateStr(this._hass, c.charging?.state);
    const plug = stateStr(this._hass, c.charging?.plug);
    const plugged = plug ? plug.toLowerCase() === "connected" : false;
    const target = stateNum(this._hass, c.charging?.target_soc);
    const phases = stateStr(this._hass, c.charging?.phases);
    const statusLine = `${plugged ? "Plugged in" : "Unplugged"}${st ? " · " + prettyState(st) : ""}`;
    return html`<div class="stats">
      ${this._stat("mdi:ev-station", "Status", statusLine, true, c.charging?.state)}
      ${this._stat("mdi:battery-charging", "This session", this._kwh(c.charging?.session_energy), false, c.charging?.session_energy)}
      ${this._stat("mdi:calendar-month", "This month", this._kwh(c.charging?.month_energy), false, c.charging?.month_energy)}
      ${this._stat("mdi:counter", "Total charged", this._kwh(c.charging?.total_energy), false, c.charging?.total_energy)}
      ${target !== undefined ? this._stat("mdi:target", "Charge target", html`${Math.round(target)}<small>%</small>`, false, c.charging?.target_soc) : nothing}
      ${phases ? this._stat("mdi:sine-wave", "Supply", phases.replace(/-/g, " "), false, c.charging?.phases) : nothing}
    </div>`;
  }

  // ---- trips/history pane ----
  private _paneHistory(): TemplateResult {
    const c = this.config;
    const avg = stateStr(this._hass, c.trips?.avg_consumption);
    const eShare = stateNum(this._hass, c.trips?.electric_share);
    const health = stateStr(this._hass, c.trips?.battery_health);
    const hv = stateNum(this._hass, c.trips?.hv_energy);
    return html`
      <div class="graph-head">
        <span class="legend"><span class="dot" style="background:var(--pv-elec)"></span>Electric</span>
        <span class="legend"><span class="dot" style="background:var(--pv-fuel)"></span>Fuel</span>
        <span class="spacer"></span>
        <div class="range-toggle">
          ${RANGES.map((r) => html`<span class=${classMap({ r: true, active: this.rangeHours === r.key })} @click=${() => (this.rangeHours = r.key)}>${r.label}</span>`)}
        </div>
      </div>
      ${this._renderGraph()}
      <div class="stats" style="margin-top:12px">
        ${avg ? this._stat("mdi:lightning-bolt-circle", "Avg consumption", html`${avg}<small>kWh/100km</small>`, false, c.trips?.avg_consumption) : nothing}
        ${eShare !== undefined ? this._stat("mdi:ev-plug-type2", "Electric share", html`${Math.round(eShare)}<small>% last trip</small>`, false, c.trips?.electric_share) : nothing}
        ${hv !== undefined ? this._stat("mdi:battery-heart-variant", "Usable battery", html`${hv.toFixed(1)}<small>kWh</small>`, false, c.trips?.hv_energy) : nothing}
        ${health ? this._stat("mdi:heart-pulse", "Battery health", health, false, c.trips?.battery_health) : nothing}
      </div>
    `;
  }

  private _path(pts: Pt[], t0: number, t1: number, area: boolean): string {
    if (pts.length === 0 || t1 <= t0) return "";
    if (pts.length === 1) {
      // A single recorded point → draw a flat line at its value so the series
      // still reads as present (common early on when a value rarely changes).
      const y = (100 - pct(pts[0].v)).toFixed(2);
      return area ? `M 0,${y} L 100,${y} L 100,100 L 0,100 Z` : `M 0,${y} L 100,${y}`;
    }
    const span = t1 - t0;
    const xy = pts.map((p) => [((p.t - t0) / span) * 100, 100 - pct(p.v)]);
    let d = `M ${xy[0][0].toFixed(2)},${xy[0][1].toFixed(2)}`;
    for (let i = 1; i < xy.length; i++) d += ` L ${xy[i][0].toFixed(2)},${xy[i][1].toFixed(2)}`;
    if (area) d += ` L ${xy[xy.length - 1][0].toFixed(2)},100 L ${xy[0][0].toFixed(2)},100 Z`;
    return d;
  }
  private _downsample(pts: Pt[], max = 160): Pt[] {
    if (pts.length <= max) return pts;
    const step = Math.ceil(pts.length / max);
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  }

  private _renderGraph(): TemplateResult {
    if (this.hist?.key !== String(this.rangeHours)) {
      return html`<div class="graph"><div class="empty">Loading history…</div></div>`;
    }
    const elec = this._downsample(this.hist.elec);
    const fuel = this._downsample(this.hist.fuel);
    if (!elec.length && !fuel.length) {
      return html`<div class="graph"><div class="empty">No history recorded yet</div></div>`;
    }
    const t1 = Date.now();
    const t0 = t1 - this.rangeHours * 3600 * 1000;
    const lastV = (p: Pt[]) => (p.length ? p[p.length - 1].v : undefined);
    const le = lastV(elec);
    const lf = lastV(fuel);
    return html`<div class="graph">
      ${le !== undefined ? html`<span class="gpt elec" style=${styleMap({ top: `${100 - pct(le)}%` })}>${Math.round(le)}%</span>` : nothing}
      ${lf !== undefined ? html`<span class="gpt fuel" style=${styleMap({ top: `${100 - pct(lf)}%` })}>${Math.round(lf)}%</span>` : nothing}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="pvElecG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--pv-elec)" stop-opacity="0.34" />
            <stop offset="100%" stop-color="var(--pv-elec)" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="pvFuelG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--pv-fuel)" stop-opacity="0.28" />
            <stop offset="100%" stop-color="var(--pv-fuel)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line class="grid" x1="0" y1="0" x2="100" y2="0" vector-effect="non-scaling-stroke" />
        <line class="grid" x1="0" y1="50" x2="100" y2="50" vector-effect="non-scaling-stroke" />
        <line class="grid" x1="0" y1="100" x2="100" y2="100" vector-effect="non-scaling-stroke" />
        ${fuel.length ? svg`<path d=${this._path(fuel, t0, t1, true)} fill="url(#pvFuelG)" stroke="none" />` : nothing}
        ${elec.length ? svg`<path d=${this._path(elec, t0, t1, true)} fill="url(#pvElecG)" stroke="none" />` : nothing}
        ${fuel.length ? svg`<path d=${this._path(fuel, t0, t1, false)} fill="none" stroke="var(--pv-fuel)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />` : nothing}
        ${elec.length ? svg`<path d=${this._path(elec, t0, t1, false)} fill="none" stroke="var(--pv-elec)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />` : nothing}
      </svg>
    </div>`;
  }

  // ---- footer ----
  private _renderFooter(): TemplateResult {
    const c = this.config;
    const odo = stateNum(this._hass, c.odometer);
    const loc = stateStr(this._hass, c.location);
    const atHome = loc ? loc.toLowerCase() === "home" : false;
    const locLabel = loc ? (atHome ? "Home" : loc.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase())) : undefined;
    return html`<div class="footer">
      ${odo !== undefined ? html`<span class="odo" @click=${() => this._more(c.odometer)}>${odo.toLocaleString()}<small>km</small></span>` : nothing}
      <span class="spacer"></span>
      ${locLabel !== undefined
        ? html`<span class=${classMap({ loc: true, home: atHome })} @click=${() => this._more(c.location)}><ha-icon icon=${atHome ? "mdi:home" : "mdi:map-marker"}></ha-icon>${locLabel}</span>`
        : nothing}
    </div>`;
  }
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "phev-vehicle-card",
  name: "PHEV Vehicle Card",
  description: "Tabbed plug-in-hybrid card: image, dual gauges, tyres, charging & gas/electric history.",
  preview: true,
});
