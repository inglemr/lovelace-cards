import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo, stateNum } from "../../shared/ha";

interface ApplianceSpec {
  name: string;
  power: string;
  icon?: string;
  threshold?: number; // W above which it's "running"
  min_cycle_min?: number; // ignore blips shorter than this
}
interface LaundryConfig extends LovelaceCardConfig {
  type: string;
  title?: string;
  appliances?: ApplianceSpec[];
  history_days?: number; // bars window (default 7)
}

const DEFAULT_APPLIANCES: ApplianceSpec[] = [
  { name: "Washer", power: "sensor.washing_machine_current_power", icon: "mdi:washing-machine", threshold: 10, min_cycle_min: 10 },
  { name: "Dryer", power: "sensor.dryer_current_power", icon: "mdi:tumble-dryer", threshold: 10, min_cycle_min: 10 },
];

type Pt = { t: number; v: number };
type Cycle = { start: number; end: number };
type Computed = {
  running: boolean;
  runStart?: number; // ms, if running
  lastEnd?: number; // ms, most recent completed cycle end
  avgMs?: number; // learned average cycle duration
  days: boolean[]; // last N days, true = a cycle that day (oldest→newest)
};

function fmtDur(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtPower(w: number): string {
  return w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;
}

@customElement("laundry-tracker-card")
export class LaundryTrackerCard extends LitElement {
  @state() private config!: LaundryConfig;
  @state() private computed: Record<string, Computed> = {};
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

  static getStubConfig(): LaundryConfig {
    return { type: "custom:laundry-tracker-card" };
  }

  setConfig(config: LaundryConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = {
      ...config,
      title: config.title ?? "Laundry",
      appliances: config.appliances ?? DEFAULT_APPLIANCES,
      history_days: config.history_days ?? 7,
    };
  }

  getCardSize(): number {
    return 4;
  }

  private get _appliances(): ApplianceSpec[] {
    return this.config.appliances ?? DEFAULT_APPLIANCES;
  }
  private get _days(): number {
    return this.config.history_days ?? 7;
  }
  private get _window(): number {
    return Math.max(this._days, 14); // learn from ≥14d, show _days bars
  }

  updated(): void {
    const key = `${this._appliances.map((a) => a.power).join(",")}:${this._window}`;
    if (this._hass && this._loadedKey !== key) this._load(key);
  }

  private async _load(key: string): Promise<void> {
    if (this._loading || !this._hass) return;
    this._loading = true;
    this._loadedKey = key;
    const end = new Date();
    const start = new Date(end.getTime() - this._window * 864e5);
    try {
      const res: any = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: this._appliances.map((a) => a.power),
        minimal_response: true,
        no_attributes: true,
      });
      const out: Record<string, Computed> = {};
      for (const a of this._appliances) {
        const rows: any[] = res?.[a.power] ?? [];
        const pts: Pt[] = rows
          .map((p) => ({ t: (p.lu ?? p.last_updated) * 1000, v: Number(p.s ?? p.state) }))
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
        out[a.power] = this._analyse(pts, a);
      }
      this.computed = out;
    } catch {
      this.computed = {};
    } finally {
      this._loading = false;
    }
  }

  private _analyse(pts: Pt[], a: ApplianceSpec): Computed {
    const threshold = a.threshold ?? 10;
    const minMs = (a.min_cycle_min ?? 10) * 60000;
    const cycles: Cycle[] = [];
    let aboveStart: number | null = null;
    for (const p of pts) {
      const above = p.v > threshold;
      if (above && aboveStart === null) aboveStart = p.t;
      else if (!above && aboveStart !== null) {
        cycles.push({ start: aboveStart, end: p.t });
        aboveStart = null;
      }
    }
    const running = aboveStart !== null;
    const runStart = aboveStart ?? undefined;
    const completed = cycles.filter((c) => c.end - c.start >= minMs);
    const durs = completed.slice(-10).map((c) => c.end - c.start);
    const avgMs = durs.length >= 2 ? durs.reduce((s, d) => s + d, 0) / durs.length : undefined;
    const lastEnd = completed.length ? completed[completed.length - 1].end : undefined;

    // last N calendar days, oldest→newest
    const days: boolean[] = [];
    const now = new Date();
    for (let i = this._days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const ran =
        completed.some((c) => c.start >= d.getTime() && c.start < dEnd.getTime()) ||
        (running && runStart !== undefined && runStart >= d.getTime() && runStart < dEnd.getTime());
      days.push(ran);
    }
    return { running, runStart, lastEnd, avgMs, days };
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    return html`
      <ha-card>
        <div class="head">
          <ha-icon icon="mdi:washing-machine"></ha-icon>
          <span class="title">${this.config.title}</span>
        </div>
        <div class="appliances">${this._appliances.map((a) => this._appliance(a))}</div>
        ${this._renderHistory()}
      </ha-card>
    `;
  }

  private _appliance(a: ApplianceSpec): TemplateResult {
    const c = this.computed[a.power];
    const power = stateNum(this._hass, a.power) ?? 0;
    const running = c?.running ?? power > (a.threshold ?? 10);
    let detail: string;
    if (running) {
      const elapsed = c?.runStart ? Date.now() - c.runStart : 0;
      if (c?.avgMs) {
        const left = c.avgMs - elapsed;
        detail = left > 60000 ? `running ${fmtDur(elapsed)} · ~${fmtDur(left)} left` : `running ${fmtDur(elapsed)} · finishing…`;
      } else {
        detail = elapsed ? `running ${fmtDur(elapsed)} · learning how long it takes…` : `running · learning how long it takes…`;
      }
    } else if (c?.lastEnd) {
      detail = `idle · last run ${fmtDur(Date.now() - c.lastEnd)} ago`;
    } else {
      detail = "idle";
    }
    return html`
      <div class="appliance ${classMap({ running })}" @click=${() => this._more(a.power)}>
        <ha-icon class="ai" icon=${a.icon ?? "mdi:washing-machine"}></ha-icon>
        <div class="mid">
          <div class="topline">
            <span class="name">${a.name}</span>
            <span class="state ${classMap({ running })}">${running ? "RUNNING" : "IDLE"}</span>
            ${running ? html`<span class="pw">${fmtPower(power)}</span>` : nothing}
          </div>
          <div class="detail">${detail}</div>
        </div>
      </div>
    `;
  }

  private _renderHistory(): TemplateResult {
    if (!Object.keys(this.computed).length) return nothing as unknown as TemplateResult;
    const labels = this._dayLabels();
    return html`
      <div class="hist">
        <div class="hist-head">Last ${this._days} days</div>
        ${this._appliances.map((a) => {
          const days = this.computed[a.power]?.days ?? [];
          return html`<div class="hrow">
            <span class="hname">${a.name}</span>
            <div class="cells">
              ${days.map((ran, i) => html`<div class=${classMap({ cell: true, on: ran, today: i === days.length - 1 })} title=${labels[i]}></div>`)}
            </div>
          </div>`;
        })}
      </div>
    `;
  }

  private _dayLabels(): string[] {
    const out: string[] = [];
    const now = new Date();
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = this._days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      out.push(dow[d.getDay()]);
    }
    return out;
  }

  private _more(e: string) {
    if (this._hass?.states[e]) moreInfo(this, e);
  }

  static styles = [hearth, css`
    :host { --lt-blue: #38bdf8; }
    ha-card {
      border-radius: var(--hl-r-card); padding: 14px 14px 12px;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent);
      background: var(--ha-card-background, var(--card-background-color, #111318));
      box-shadow: var(--hl-e1);
    }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .head > ha-icon { --mdc-icon-size: 19px; color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); }
    .title { font-size: 15px; font-weight: 700; }

    .appliances { display: flex; flex-direction: column; gap: 8px; }
    .appliance { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 16px; cursor: pointer;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent);
      background: color-mix(in srgb, var(--primary-text-color) 4%, transparent); }
    .appliance.running { border-color: color-mix(in srgb, var(--lt-blue) 40%, transparent); background: color-mix(in srgb, var(--lt-blue) 9%, transparent); }
    .ai { --mdc-icon-size: 26px; flex: 0 0 auto; color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); }
    .appliance.running .ai { color: var(--lt-blue); animation: spin 3.5s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .mid { flex: 1; min-width: 0; }
    .topline { display: flex; align-items: baseline; gap: 8px; }
    .name { font-size: 15px; font-weight: 700; }
    .state { font-size: 10px; font-weight: 800; letter-spacing: 0.6px; padding: 2px 6px; border-radius: 999px;
      color: color-mix(in srgb, var(--primary-text-color) 45%, transparent); background: color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
    .state.running { color: var(--lt-blue); background: color-mix(in srgb, var(--lt-blue) 15%, transparent); }
    .pw { margin-left: auto; font-size: 13px; font-weight: 700; color: var(--lt-blue); font-variant-numeric: tabular-nums; }
    .detail { font-size: 12px; color: color-mix(in srgb, var(--primary-text-color) 52%, transparent); margin-top: 3px; }

    .hist { margin-top: 12px; padding-top: 11px; border-top: 1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent); }
    .hist-head { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: color-mix(in srgb, var(--primary-text-color) 40%, transparent); margin-bottom: 7px; }
    .hrow { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .hname { width: 58px; flex: 0 0 auto; font-size: 12px; font-weight: 600; color: color-mix(in srgb, var(--primary-text-color) 62%, transparent); }
    .cells { display: flex; gap: 5px; flex: 1; }
    .cell { flex: 1; height: 12px; border-radius: 4px; background: color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
    .cell.on { background: var(--lt-blue); box-shadow: 0 0 10px -3px color-mix(in srgb, var(--lt-blue) 80%, transparent); }
    .cell.today { outline: 1.5px solid color-mix(in srgb, var(--primary-text-color) 22%, transparent); outline-offset: 1px; }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "laundry-tracker-card",
  name: "Laundry Tracker Card",
  description: "Detects washer/dryer cycles from power, shows running state, finish estimate and a 7-day history.",
  preview: true,
});
