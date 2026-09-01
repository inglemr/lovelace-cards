import { LitElement, html, svg, nothing, css, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { stateStr, stateNum, entityPicture, moreInfo, isUnknown } from "../../shared/ha";

interface PetChip {
  entity: string;
  name?: string;
  icon?: string;
}
interface PetCardConfig extends LovelaceCardConfig {
  type: string;
  name?: string;
  subtitle?: string;
  photo?: string; // static url (e.g. /local/pets/tots.jpg)
  image_entity?: string; // image./person. entity with a picture
  icon?: string; // fallback glyph
  accent?: string; // css colour or named
  weight?: string; // e.g. sensor.thor_weight (lb)
  weight_history?: string; // defaults to weight
  weight_range_days?: number; // default 30
  visits?: string; // litter visits today
  last_seen?: string; // frigate last camera
  extras?: PetChip[];
}

const NAMED: Record<string, string> = {
  orange: "#fb8c00",
  "deep-purple": "#7c4dff",
  purple: "#9c6ade",
  teal: "#14b8a6",
  blue: "#38bdf8",
  pink: "#ec4899",
  green: "#34d399",
};
type Pt = { t: number; v: number };

@customElement("pet-card")
export class PetCard extends LitElement {
  @state() private config!: PetCardConfig;
  @state() private hist?: { pts: Pt[]; key: string };
  @state() private imgFailed = false;
  private _histLoading = false;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): PetCardConfig {
    return { type: "custom:pet-card", name: "Thor", image_entity: "image.thor_avatar", accent: "orange", weight: "sensor.thor_weight", visits: "sensor.thor_visits_today", last_seen: "sensor.frigate_thor_last_camera" };
  }

  setConfig(config: PetCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = config;
    this.imgFailed = false;
  }

  getCardSize(): number {
    return 4;
  }

  private get _accent(): string {
    const a = this.config.accent ?? "orange";
    return NAMED[a] ?? a;
  }
  private get _rangeDays(): number {
    return this.config.weight_range_days ?? 30;
  }
  /** lb→kg factor from the source sensor's unit (1 if already metric). */
  private get _factor(): number {
    const e = this.config.weight_history ?? this.config.weight;
    const u = (e && this._hass?.states[e]?.attributes?.unit_of_measurement) || "";
    return /lb/i.test(String(u)) ? 0.453592 : 1;
  }
  private _relSeen(entity?: string): string | undefined {
    if (!entity) return undefined;
    const s = this._hass?.states[entity];
    if (!s?.last_changed) return undefined;
    const diff = Date.now() - new Date(s.last_changed).getTime();
    if (!Number.isFinite(diff) || diff < 0) return undefined;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  updated(): void {
    const wh = this.config.weight_history ?? this.config.weight;
    if (wh && this._hass && this.hist?.key !== `${wh}:${this._rangeDays}`) this._loadHistory();
  }

  private async _loadHistory(): Promise<void> {
    const wh = this.config.weight_history ?? this.config.weight;
    if (!wh || this._histLoading || !this._hass) return;
    this._histLoading = true;
    const key = `${wh}:${this._rangeDays}`;
    const end = new Date();
    const start = new Date(end.getTime() - this._rangeDays * 864e5);
    try {
      const res: any = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [wh],
        minimal_response: true,
        no_attributes: true,
      });
      const f = this._factor;
      const pts: Pt[] = ((res?.[wh] as any[]) ?? [])
        .map((p) => ({ t: (p.lu ?? p.last_updated) * 1000, v: Number(p.s ?? p.state) * f }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
      this.hist = { pts, key };
    } catch {
      this.hist = { pts: [], key };
    } finally {
      this._histLoading = false;
    }
  }

  private _more(e?: string) {
    if (e && this._hass?.states[e]) moreInfo(this, e);
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const c = this.config;
    const raw = stateNum(this._hass, c.weight);
    const weight = raw !== undefined ? raw * this._factor : undefined;
    const visits = stateNum(this._hass, c.visits);
    const seen = stateStr(this._hass, c.last_seen);
    const rel = this._relSeen(c.last_seen);
    const seenLabel = seen ? `${seen}${rel ? ` · ${rel}` : ""}` : undefined;
    return html`
      <ha-card style=${styleMap({ "--pet-accent": this._accent })}>
        <div class="top">
          ${this._renderAvatar()}
          <div class="id"><div class="name">${c.name ?? "Pet"}</div></div>
        </div>

        <div class="weight" @click=${() => this._more(c.weight)}>
          <span class="wv">${weight !== undefined ? weight.toFixed(1) : "–"}</span>
          <span class="wu">kg</span>
          ${this._renderTrend()}
        </div>
        ${this._renderSparkline()}

        <div class="chips">
          ${visits !== undefined ? this._chip("mdi:toilet", `${visits} litter visit${visits === 1 ? "" : "s"} today`, () => this._more(c.visits)) : nothing}
          ${seenLabel ? this._chip("mdi:map-marker", seenLabel, () => this._more(c.last_seen)) : nothing}
          ${(c.extras ?? []).map((x) => this._extraChip(x))}
        </div>
      </ha-card>
    `;
  }

  private _renderAvatar(): TemplateResult {
    const c = this.config;
    const pic = c.image_entity ? entityPicture(this._hass, c.image_entity) : c.photo;
    if (pic && !this.imgFailed) {
      return html`<div class="avatar"><img src=${pic} alt=${c.name ?? ""} @error=${() => (this.imgFailed = true)} @click=${() => this._more(c.image_entity)} /></div>`;
    }
    return html`<div class="avatar icon"><ha-icon icon=${c.icon ?? "mdi:cat"}></ha-icon></div>`;
  }

  private _renderTrend(): TemplateResult | typeof nothing {
    const pts = this.hist?.pts ?? [];
    if (pts.length < 2) return nothing;
    const d = pts[pts.length - 1].v - pts[0].v;
    if (Math.abs(d) < 0.05) return html`<span class="trend flat"><ha-icon icon="mdi:arrow-right"></ha-icon>steady</span>`;
    const up = d > 0;
    return html`<span class=${classMap({ trend: true, up, down: !up })}>
      <ha-icon icon=${up ? "mdi:arrow-top-right" : "mdi:arrow-bottom-right"}></ha-icon>${up ? "+" : ""}${d.toFixed(1)} · ${this._rangeDays}d
    </span>`;
  }

  private _renderSparkline(): TemplateResult {
    const pts = this.hist?.pts ?? [];
    if (this.hist?.key === undefined) return html`<div class="spark loading"></div>`;
    if (pts.length < 2) return html`<div class="spark empty">weighing in…</div>`;
    const vs = pts.map((p) => p.v);
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    if (hi - lo < 0.2) { const m = (hi + lo) / 2; lo = m - 0.12; hi = m + 0.12; } // kg scale: avoid a flat-looking line
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const xy = pts.map((p) => [((p.t - t0) / span) * 100, 100 - ((p.v - lo) / (hi - lo)) * 100]);
    const line = "M " + xy.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L ");
    const area = line + ` L 100,100 L 0,100 Z`;
    return html`<div class="spark">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="petG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--pet-accent)" stop-opacity="0.30" />
            <stop offset="100%" stop-color="var(--pet-accent)" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${svg`<path d=${area} fill="url(#petG)" stroke="none" />`}
        ${svg`<path d=${line} fill="none" stroke="var(--pet-accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />`}
      </svg>
    </div>`;
  }

  private _chip(icon: string, label: string, onClick?: () => void): TemplateResult {
    return html`<span class="chip" @click=${onClick ?? nothing}><ha-icon icon=${icon}></ha-icon>${label}</span>`;
  }
  private _extraChip(x: PetChip): TemplateResult | typeof nothing {
    if (isUnknown(this._hass, x.entity)) return nothing;
    const v = stateStr(this._hass, x.entity);
    return this._chip(x.icon ?? "mdi:information-outline", `${x.name ? x.name + ": " : ""}${v}`, () => this._more(x.entity));
  }

  static styles = css`
    :host { --pet-accent: #fb8c00; }
    ha-card {
      position: relative; overflow: hidden; border-radius: 24px; padding: 14px 16px 13px;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent);
      background:
        radial-gradient(120% 80% at 100% -20%, color-mix(in srgb, var(--pet-accent) 14%, transparent), transparent 55%),
        var(--ha-card-background, var(--card-background-color, #111318));
      box-shadow: 0 16px 34px -22px rgba(0,0,0,.6);
    }
    .top { display: flex; align-items: center; gap: 12px; }
    .avatar { width: 52px; height: 52px; border-radius: 999px; overflow: hidden; flex: 0 0 auto; box-shadow: 0 0 0 2px color-mix(in srgb, var(--pet-accent) 60%, transparent), 0 6px 14px -6px rgba(0,0,0,.5); }
    .avatar img { width: 100%; height: 100%; object-fit: cover; cursor: pointer; display: block; }
    .avatar.icon { display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--pet-accent) 16%, transparent); }
    .avatar.icon ha-icon { --mdc-icon-size: 30px; color: var(--pet-accent); }
    .id { flex: 1; min-width: 0; }
    .name { font-size: 19px; font-weight: 700; line-height: 1.1; }
    .sub { font-size: 12px; color: color-mix(in srgb, var(--primary-text-color) 50%, transparent); margin-top: 2px; }
    .paw { color: var(--pet-accent); --mdc-icon-size: 20px; opacity: .85; }

    .weight { display: flex; align-items: baseline; gap: 6px; margin: 12px 0 2px; cursor: pointer; }
    .wv { font-size: 30px; font-weight: 800; letter-spacing: -0.5px; font-variant-numeric: tabular-nums; }
    .wu { font-size: 13px; font-weight: 600; color: color-mix(in srgb, var(--primary-text-color) 50%, transparent); }
    .trend { margin-left: auto; display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: 999px; }
    .trend ha-icon { --mdc-icon-size: 14px; }
    .trend.up { color: #fca5a5; background: color-mix(in srgb, #f87171 14%, transparent); }
    .trend.down { color: #86efac; background: color-mix(in srgb, #34d399 14%, transparent); }
    .trend.flat { color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }

    .spark { height: 46px; margin: 4px 0 10px; }
    .spark svg { width: 100%; height: 100%; overflow: visible; }
    .spark.loading, .spark.empty { display: flex; align-items: center; justify-content: center; font-size: 11px; color: color-mix(in srgb, var(--primary-text-color) 40%, transparent); }

    .chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 4px 9px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent); color: color-mix(in srgb, var(--primary-text-color) 72%, transparent); background: color-mix(in srgb, var(--primary-text-color) 4%, transparent); cursor: pointer; }
    .chip ha-icon { --mdc-icon-size: 15px; color: var(--pet-accent); }
  `;
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "pet-card",
  name: "Pet Card",
  description: "Health-first pet hero: photo, weight + trend sparkline, litter visits and last-seen room.",
  preview: true,
});
