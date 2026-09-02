import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { classMap } from "lit/directives/class-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo, isUnknown } from "../../shared/ha";

interface EntitySpec {
  entity: string;
  name?: string;
}
interface BatteryFleetConfig extends LovelaceCardConfig {
  type: string;
  title?: string;
  entities?: (string | EntitySpec)[];
  warn?: number; // low threshold %
  critical?: number; // critical threshold %
  forecast_days?: number; // history window for drain-rate
}

type Row = {
  entity: string;
  name: string;
  level?: number; // undefined = offline/no data
  daysLeft?: number; // undefined = stable/unknown
  tone: "critical" | "low" | "ok" | "offline";
};

function cleanName(fn: string): string {
  return fn.replace(/\s*battery( level)?$/i, "").trim().replace(/^front door$/i, "Front Door") || fn;
}
function batteryIcon(level: number | undefined): string {
  if (level === undefined) return "mdi:battery-off-outline";
  if (level <= 10) return "mdi:battery-alert-variant-outline";
  const n = Math.round(level / 10) * 10;
  return n >= 100 ? "mdi:battery" : `mdi:battery-${n}`;
}

@customElement("battery-fleet-card")
export class BatteryFleetCard extends LitElement {
  @state() private config!: BatteryFleetConfig;
  @state() private forecast: Record<string, number | undefined> = {};
  private _loadedKey = "";
  private _loading = false;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): BatteryFleetConfig {
    return { type: "custom:battery-fleet-card" };
  }

  setConfig(config: BatteryFleetConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = {
      ...config,
      title: config.title ?? "Battery health",
      warn: config.warn ?? 30,
      critical: config.critical ?? 15,
      forecast_days: config.forecast_days ?? 21,
    };
  }

  getCardSize(): number {
    return 4;
  }

  private get _specs(): EntitySpec[] {
    return (this.config.entities ?? []).map((e) => (typeof e === "string" ? { entity: e } : e));
  }

  updated(): void {
    const key = `${this._specs.map((s) => s.entity).join(",")}:${this.config.forecast_days}`;
    if (this._hass && this._loadedKey !== key) this._loadForecast(key);
  }

  private async _loadForecast(key: string): Promise<void> {
    if (this._loading || !this._hass) return;
    const ids = this._specs.map((s) => s.entity);
    if (!ids.length) return;
    this._loading = true;
    this._loadedKey = key;
    const end = new Date();
    const start = new Date(end.getTime() - (this.config.forecast_days ?? 21) * 864e5);
    try {
      const res: any = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
      });
      const out: Record<string, number | undefined> = {};
      for (const id of ids) {
        const rows: any[] = res?.[id] ?? [];
        const pts = rows
          .map((p) => ({ t: (p.lu ?? p.last_updated) * 1000, v: Number(p.s ?? p.state) }))
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
        out[id] = this._daysLeft(pts);
      }
      this.forecast = out;
    } catch {
      this.forecast = {};
    } finally {
      this._loading = false;
    }
  }

  /** Estimate days-to-empty from a slow discharge; undefined if flat/charging. */
  private _daysLeft(pts: { t: number; v: number }[]): number | undefined {
    if (pts.length < 2) return undefined;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const days = (last.t - first.t) / 864e5;
    if (days < 1) return undefined;
    const drop = first.v - last.v; // positive = discharging
    const rate = drop / days; // %/day
    if (rate <= 0.05) return undefined; // stable or charging
    const left = last.v / rate;
    return left > 0 ? left : undefined;
  }

  private _rows(): Row[] {
    const hass = this._hass!;
    const warn = this.config.warn ?? 30;
    const crit = this.config.critical ?? 15;
    const rows: Row[] = this._specs.map((s) => {
      const st = hass.states[s.entity];
      const name = s.name ?? (st ? cleanName(st.attributes.friendly_name ?? s.entity) : s.entity);
      if (isUnknown(hass, s.entity)) return { entity: s.entity, name, tone: "offline" };
      const level = Number(st!.state);
      if (!Number.isFinite(level)) return { entity: s.entity, name, tone: "offline" };
      const tone: Row["tone"] = level <= crit ? "critical" : level <= warn ? "low" : "ok";
      return { entity: s.entity, name, level, daysLeft: this.forecast[s.entity], tone };
    });
    // rank: offline last, else by level ascending
    return rows.sort((a, b) => {
      if (a.tone === "offline" && b.tone !== "offline") return 1;
      if (b.tone === "offline" && a.tone !== "offline") return -1;
      return (a.level ?? 999) - (b.level ?? 999);
    });
  }

  private _summary(rows: Row[]): { text: string; tone: string } {
    const crit = rows.filter((r) => r.tone === "critical").length;
    const low = rows.filter((r) => r.tone === "low").length;
    const off = rows.filter((r) => r.tone === "offline").length;
    if (crit) return { text: `${crit} need${crit === 1 ? "s" : ""} replacing`, tone: "critical" };
    if (low) return { text: `${low} getting low`, tone: "low" };
    if (off) return { text: `all healthy · ${off} offline`, tone: "ok" };
    return { text: "all healthy", tone: "ok" };
  }

  private _color(tone: string): string {
    return tone === "critical" ? "var(--bf-red)" : tone === "low" ? "var(--bf-amber)" : tone === "offline" ? "var(--bf-grey)" : "var(--bf-green)";
  }

  private _fmtDays(d?: number): string {
    if (d === undefined) return "";
    if (d > 365) return "~1y+";
    if (d > 60) return `~${Math.round(d / 30)}mo`;
    return `~${Math.round(d)}d`;
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const rows = this._rows();
    const sum = this._summary(rows);
    return html`
      <ha-card>
        <div class="head">
          <ha-icon icon="mdi:battery-heart-variant"></ha-icon>
          <span class="title">${this.config.title}</span>
          <span class="spacer"></span>
          <span class="summary ${sum.tone}">${sum.tone === "ok" ? html`<ha-icon icon="mdi:check-circle"></ha-icon>` : nothing}${sum.text}</span>
        </div>
        ${rows.length ? html`<div class="list">${rows.map((r) => this._row(r))}</div>` : html`<div class="empty">No battery devices configured</div>`}
      </ha-card>
    `;
  }

  private _row(r: Row): TemplateResult {
    const color = this._color(r.tone);
    const days = this._fmtDays(r.daysLeft);
    return html`
      <div class="row" @click=${() => this._more(r.entity)}>
        <ha-icon class="bi" style=${styleMap({ color })} icon=${batteryIcon(r.level)}></ha-icon>
        <div class="mid">
          <div class="name">${r.name}</div>
          <div class="track"><div class="fill" style=${styleMap({ width: `${r.level ?? 0}%`, background: color })}></div></div>
        </div>
        <div class="right">
          <div class=${classMap({ pct: true, off: r.tone === "offline" })}>${r.level !== undefined ? `${Math.round(r.level)}%` : "offline"}</div>
          ${days ? html`<div class="days">${days} left</div>` : nothing}
        </div>
      </div>
    `;
  }

  private _more(e: string) {
    if (this._hass?.states[e]) moreInfo(this, e);
  }

  static styles = css`
    :host {
      --bf-red: #f87171;
      --bf-amber: #fbbf24;
      --bf-green: #34d399;
      --bf-grey: #6b7280;
    }
    ha-card {
      border-radius: 24px; padding: 14px 14px 10px;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent);
      background: var(--ha-card-background, var(--card-background-color, #111318));
      box-shadow: 0 16px 34px -22px rgba(0,0,0,.6);
    }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .head > ha-icon { --mdc-icon-size: 19px; color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); }
    .title { font-size: 15px; font-weight: 700; }
    .spacer { flex: 1; }
    .summary { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; }
    .summary ha-icon { --mdc-icon-size: 15px; }
    .summary.ok { color: var(--bf-green); }
    .summary.low { color: var(--bf-amber); }
    .summary.critical { color: var(--bf-red); }
    .empty { padding: 10px 2px 14px; font-size: 13px; color: color-mix(in srgb, var(--primary-text-color) 45%, transparent); }

    .list { display: flex; flex-direction: column; }
    .row { display: flex; align-items: center; gap: 12px; padding: 9px 2px; cursor: pointer; border-top: 1px solid color-mix(in srgb, var(--primary-text-color) 7%, transparent); }
    .row:first-child { border-top: none; }
    .bi { --mdc-icon-size: 24px; flex: 0 0 auto; }
    .mid { flex: 1; min-width: 0; }
    .name { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 5px; }
    .track { height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--primary-text-color) 10%, transparent); overflow: hidden; }
    .fill { height: 100%; border-radius: 999px; transition: width 0.8s cubic-bezier(0.22,1,0.36,1); }
    .right { text-align: right; flex: 0 0 auto; min-width: 52px; }
    .pct { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .pct.off { font-size: 12px; font-weight: 600; color: var(--bf-grey); }
    .days { font-size: 10.5px; font-weight: 600; color: color-mix(in srgb, var(--primary-text-color) 42%, transparent); }
  `;
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "battery-fleet-card",
  name: "Battery Fleet Card",
  description: "Ranked replaceable-battery health with drain-rate and days-left forecast.",
  preview: true,
});
