import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo, stateNum, stateStr } from "../../shared/ha";

interface VacuumConfig extends LovelaceCardConfig {
  type: string;
  entity: string; // vacuum.*
  name?: string;
  room?: string; // sensor with current room name
  cleaning_time?: string; // sensor for elapsed minutes (also used to learn avg)
  cleaned_area?: string; // sensor for m² cleaned
}

const CLEANING = new Set(["cleaning", "room_cleaning", "zone_cleaning", "spot_cleaning", "segment_cleaning", "cruising", "mopping"]);

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
}

@customElement("homelab-vacuum-card")
export class VacuumCard extends LitElement {
  @state() private config!: VacuumConfig;
  @state() private avgMin?: number;
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

  static getStubConfig(): VacuumConfig {
    return { type: "custom:homelab-vacuum-card", entity: "vacuum.jervis", name: "Jervis", room: "sensor.jervis_current_room", cleaning_time: "sensor.jervis_cleaning_time", cleaned_area: "sensor.jervis_cleaned_area" };
  }

  setConfig(config: VacuumConfig): void {
    if (!config || !config.entity) throw new Error("vacuum-card: 'entity' is required");
    this.config = { name: "Vacuum", ...config };
  }

  getCardSize(): number {
    return 3;
  }

  private _st() {
    return this._hass?.states[this.config.entity];
  }
  private _attr(k: string): any {
    return this._st()?.attributes?.[k];
  }

  private _phase(): { key: string; label: string; active: boolean; docked: boolean } {
    const s = (this._st()?.state ?? "").toLowerCase();
    if (CLEANING.has(s) || this._attr("running")) return { key: "cleaning", label: "Cleaning", active: true, docked: false };
    if (s === "paused" || this._attr("paused")) return { key: "paused", label: "Paused", active: true, docked: false };
    if (s === "returning" || this._attr("returning")) return { key: "returning", label: "Returning to dock", active: true, docked: false };
    if (s === "error") return { key: "error", label: "Error", active: false, docked: false };
    if (s === "docked" || this._attr("charging")) {
      return { key: "docked", label: this._attr("charging") ? "Charging" : "Docked", active: false, docked: true };
    }
    return { key: "idle", label: s ? s.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase()) : "Idle", active: false, docked: true };
  }

  updated(): void {
    const ct = this.config.cleaning_time;
    if (ct && this._hass && this._loadedKey !== ct) this._learn(ct);
  }

  private async _learn(ct: string): Promise<void> {
    if (this._loading || !this._hass) return;
    this._loading = true;
    this._loadedKey = ct;
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 864e5);
    try {
      const res: any = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [ct],
        minimal_response: true,
        no_attributes: true,
      });
      const vals: number[] = ((res?.[ct] as any[]) ?? [])
        .map((p) => Number(p.s ?? p.state))
        .filter((v) => Number.isFinite(v));
      // a job's duration = the peak cleaning_time reached before it resets toward 0
      const jobs: number[] = [];
      let peak = 0;
      for (const v of vals) {
        if (v + 3 < peak) {
          if (peak >= 5) jobs.push(peak); // ignore tiny blips
          peak = v;
        } else {
          peak = Math.max(peak, v);
        }
      }
      const recent = jobs.slice(-8);
      this.avgMin = recent.length >= 2 ? recent.reduce((s, d) => s + d, 0) / recent.length : undefined;
    } catch {
      this.avgMin = undefined;
    } finally {
      this._loading = false;
    }
  }

  private _svc(service: string) {
    if (!this._hass) return;
    this._hass.callService("vacuum", service, { entity_id: this.config.entity });
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const ph = this._phase();
    const c = this.config;
    const battery = this._attr("battery_level");
    const room = c.room ? stateStr(this._hass, c.room) : this._attr("current_room");
    const elapsed = c.cleaning_time ? stateNum(this._hass, c.cleaning_time) : this._attr("cleaning_time");
    const area = c.cleaned_area ? stateNum(this._hass, c.cleaned_area) : this._attr("cleaned_area");
    const err = this._attr("error");

    let detail = "";
    if (ph.active && ph.key !== "returning") {
      const bits: string[] = [];
      if (elapsed !== undefined) bits.push(`${fmtMin(elapsed)} elapsed`);
      if (area) bits.push(`${Math.round(area)} m²`);
      if (ph.key === "cleaning" && this.avgMin && elapsed !== undefined) {
        const left = this.avgMin - elapsed;
        bits.push(left > 1 ? `~${fmtMin(left)} left` : "finishing…");
      } else if (ph.key === "cleaning" && elapsed !== undefined && !this.avgMin) {
        bits.push("learning cycle length…");
      }
      detail = bits.join(" · ");
    } else if (ph.key === "docked") {
      detail = room ? `at dock · last in ${room}` : "at dock";
    } else if (ph.key === "error") {
      detail = typeof err === "string" && err && err !== "none" ? err : "needs attention";
    }

    return html`
      <ha-card class=${classMap({ active: ph.active })}>
        <div class="top" @click=${() => this._more(c.entity)}>
          <ha-icon class="vi ${classMap({ spin: ph.key === "cleaning" })}" icon="mdi:robot-vacuum"></ha-icon>
          <div class="mid">
            <div class="topline">
              <span class="name">${c.name}</span>
              <span class="state ${classMap({ on: ph.active, err: ph.key === "error" })}">${ph.label}${ph.active && room && ph.key === "cleaning" ? ` · ${room}` : ""}</span>
            </div>
            ${detail ? html`<div class="detail">${detail}</div>` : nothing}
          </div>
          ${battery !== undefined && battery !== null ? html`<div class="batt"><ha-icon icon=${this._battIcon(battery, !!this._attr("charging"))}></ha-icon>${Math.round(battery)}%</div>` : nothing}
        </div>
        <div class="controls">${this._controls(ph)}</div>
      </ha-card>
    `;
  }

  private _battIcon(level: number, charging: boolean): string {
    if (charging) return "mdi:battery-charging";
    const n = Math.round(level / 10) * 10;
    return n >= 100 ? "mdi:battery" : n <= 0 ? "mdi:battery-outline" : `mdi:battery-${n}`;
  }

  private _btn(icon: string, label: string, service: string, primary = false): TemplateResult {
    return html`<button class=${classMap({ ctl: true, primary })} @click=${() => this._svc(service)}>
      <ha-icon icon=${icon}></ha-icon><span>${label}</span>
    </button>`;
  }

  private _controls(ph: { key: string; active: boolean; docked: boolean }): TemplateResult {
    if (ph.key === "cleaning") {
      return html`${this._btn("mdi:pause", "Pause", "pause")}${this._btn("mdi:home-import-outline", "Send home", "return_to_base")}`;
    }
    if (ph.key === "paused") {
      return html`${this._btn("mdi:play", "Resume", "start", true)}${this._btn("mdi:home-import-outline", "Send home", "return_to_base")}`;
    }
    if (ph.key === "returning") {
      return html`${this._btn("mdi:play", "Resume clean", "start")}${this._btn("mdi:stop", "Stop", "stop")}`;
    }
    // docked / idle / error
    return html`${this._btn("mdi:broom", "Start clean", "start", true)}${this._btn("mdi:crosshairs-gps", "Locate", "locate")}`;
  }

  private _more(e: string) {
    if (this._hass?.states[e]) moreInfo(this, e);
  }

  static styles = css`
    :host { --vc-blue: #38bdf8; --vc-green: #34d399; }
    ha-card {
      border-radius: 22px; padding: 12px 14px;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent);
      background: var(--ha-card-background, var(--card-background-color, #111318));
      box-shadow: 0 16px 34px -22px rgba(0,0,0,.6);
    }
    ha-card.active { border-color: color-mix(in srgb, var(--vc-blue) 40%, transparent); background: color-mix(in srgb, var(--vc-blue) 8%, transparent); }
    .top { display: flex; align-items: center; gap: 12px; cursor: pointer; }
    .vi { --mdc-icon-size: 30px; flex: 0 0 auto; color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); }
    ha-card.active .vi { color: var(--vc-blue); }
    .vi.spin { animation: spin 3.5s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .mid { flex: 1; min-width: 0; }
    .topline { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .name { font-size: 16px; font-weight: 700; }
    .state { font-size: 12px; font-weight: 700; color: color-mix(in srgb, var(--primary-text-color) 48%, transparent); }
    .state.on { color: var(--vc-blue); }
    .state.err { color: #f87171; }
    .detail { font-size: 12px; color: color-mix(in srgb, var(--primary-text-color) 52%, transparent); margin-top: 3px; }
    .batt { display: flex; align-items: center; gap: 3px; font-size: 13px; font-weight: 700; color: color-mix(in srgb, var(--primary-text-color) 60%, transparent); flex: 0 0 auto; font-variant-numeric: tabular-nums; }
    .batt ha-icon { --mdc-icon-size: 18px; }

    .controls { display: flex; gap: 8px; margin-top: 12px; }
    .ctl { -webkit-appearance: none; appearance: none; flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 10px; border-radius: 14px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 700;
      color: var(--primary-text-color); border: 1px solid color-mix(in srgb, var(--primary-text-color) 12%, transparent);
      background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); transition: transform .07s, filter .12s; }
    .ctl ha-icon { --mdc-icon-size: 19px; }
    .ctl.primary { color: #0b1220; border: none; background: linear-gradient(180deg, color-mix(in srgb, var(--vc-blue) 82%, white 18%), var(--vc-blue)); }
    .ctl.primary ha-icon { color: #0b1220; }
    .ctl:hover { filter: brightness(1.06); }
    .ctl:active { transform: translateY(1px) scale(.985); }
  `;
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "homelab-vacuum-card",
  name: "Vacuum Card",
  description: "Robot vacuum status, live progress with learned ETA, battery and contextual controls.",
  preview: true,
});
