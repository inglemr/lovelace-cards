import { LitElement, html, nothing, css } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo, stateNum, stateStr, isUnknown } from "../../shared/ha";

interface FeederConfig extends LovelaceCardConfig {
  type: string;
  name?: string;
  last_feed?: string;
  next_feed?: string;
  last_qty?: string;
  next_qty?: string;
  today_times?: string;
  today_qty?: string;
  food_status?: string; // binary, on = food low
  dispenser?: string; // binary, on = jam
  desiccant?: string; // days remaining
  portion?: string; // number entity (manual feed quantity)
  feed_now?: string; // button entity
  skip?: string; // button entity
}

const F = "sensor.granary_smart_camera_feeder_";
const FB = "binary_sensor.granary_smart_camera_feeder_";
const DEFAULTS = {
  name: "Feeder",
  last_feed: `${F}last_feed_time`,
  next_feed: `${F}next_feed_time`,
  last_qty: `${F}last_feed_quantity_weight`,
  next_qty: `${F}next_feed_quantity_weight`,
  today_times: `${F}today_s_feeding_times`,
  today_qty: `${F}today_s_feeding_quantity_weight`,
  food_status: `${FB}food_status`,
  dispenser: `${FB}food_dispenser`,
  desiccant: `${F}desiccant_remaining_days`,
  portion: "number.granary_smart_camera_feeder_manual_feed_quantity",
  feed_now: "button.granary_smart_camera_feeder_manual_feed",
  skip: "button.kitchen_granary_smart_camera_feeder_skip_selected_plan_today",
};

function relTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return undefined;
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function clockTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  const hh = d.getHours();
  const mm = d.getMinutes().toString().padStart(2, "0");
  const today = new Date();
  const tomorrow = d.getDate() !== today.getDate();
  return `${hh}:${mm}${tomorrow ? " tmrw" : ""}`;
}

@customElement("feeder-card")
export class FeederCard extends LitElement {
  @state() private config!: FeederConfig;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): FeederConfig {
    return { type: "custom:feeder-card" };
  }

  setConfig(config: FeederConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = { ...DEFAULTS, ...config };
  }

  getCardSize(): number {
    return 4;
  }

  private _num(e?: string): number | undefined {
    return stateNum(this._hass, e);
  }

  private _press(entity?: string) {
    if (!entity || !this._hass) return;
    const domain = entity.split(".")[0];
    this._hass.callService(domain, "press", { entity_id: entity });
  }
  private _setPortion(delta: number) {
    const e = this.config.portion;
    if (!e || !this._hass) return;
    const st = this._hass.states[e];
    if (!st) return;
    const cur = Number(st.state);
    const step = Number(st.attributes.step ?? 1);
    const min = Number(st.attributes.min ?? 1);
    const max = Number(st.attributes.max ?? 100);
    const next = Math.min(max, Math.max(min, cur + delta * step));
    this._hass.callService("number", "set_value", { entity_id: e, value: next });
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const c = this.config;
    const foodLow = c.food_status ? this._hass.states[c.food_status]?.state === "on" : false;
    const jam = c.dispenser ? this._hass.states[c.dispenser]?.state === "on" : false;
    const desiccant = this._num(c.desiccant);

    const nextIso = stateStr(this._hass, c.next_feed);
    const nextClock = clockTime(nextIso);
    const nextQty = this._num(c.next_qty);
    const lastRel = relTime(stateStr(this._hass, c.last_feed));
    const lastQty = this._num(c.last_qty);
    const todayN = this._num(c.today_times);
    const todayQty = this._num(c.today_qty);
    const portion = this._num(c.portion);

    const statusPill = jam
      ? html`<span class="pill alert"><ha-icon icon="mdi:alert"></ha-icon>Dispenser jam</span>`
      : foodLow
        ? html`<span class="pill alert"><ha-icon icon="mdi:alert"></ha-icon>Food low</span>`
        : html`<span class="pill good"><ha-icon icon="mdi:check-circle"></ha-icon>Food OK</span>`;

    return html`
      <ha-card>
        <div class="head">
          <ha-icon icon="mdi:bowl-mix"></ha-icon>
          <span class="title">${c.name}</span>
          <span class="spacer"></span>
          ${statusPill}
        </div>

        <div class="next" @click=${() => this._more(c.next_feed)}>
          <ha-icon icon="mdi:clock-outline"></ha-icon>
          <div>
            <div class="k">Next feed</div>
            <div class="v">${nextClock ?? "—"}${nextQty !== undefined ? html` <small>· ${Math.round(nextQty)} g</small>` : nothing}</div>
          </div>
        </div>

        <div class="stats">
          <div class="stat" @click=${() => this._more(c.last_feed)}>
            <div class="sk">Last fed</div>
            <div class="sv">${lastRel ?? "—"}${lastQty !== undefined ? html` <small>· ${Math.round(lastQty)} g</small>` : nothing}</div>
          </div>
          <div class="stat" @click=${() => this._more(c.today_times)}>
            <div class="sk">Today</div>
            <div class="sv">${todayN !== undefined ? `${Math.round(todayN)} feed${todayN === 1 ? "" : "s"}` : "—"}${todayQty !== undefined ? html` <small>· ${Math.round(todayQty)} g</small>` : nothing}</div>
          </div>
          ${desiccant !== undefined
            ? html`<div class="stat" @click=${() => this._more(c.desiccant)}>
                <div class="sk">Desiccant</div>
                <div class=${classMap({ sv: true, warn: desiccant < 14 })}>${Math.round(desiccant)} <small>days</small></div>
              </div>`
            : nothing}
        </div>

        ${portion !== undefined && !isUnknown(this._hass, c.portion)
          ? html`<div class="portion">
              <span class="pk">Manual portion</span>
              <div class="stepper">
                <button @click=${() => this._setPortion(-1)}><ha-icon icon="mdi:minus"></ha-icon></button>
                <span class="pv">${Math.round(portion)} g</span>
                <button @click=${() => this._setPortion(1)}><ha-icon icon="mdi:plus"></ha-icon></button>
              </div>
            </div>`
          : nothing}

        <div class="actions">
          ${c.feed_now ? html`<button class="act primary" @click=${() => this._press(c.feed_now)}><ha-icon icon="mdi:food-drumstick"></ha-icon>Feed now</button>` : nothing}
          ${c.skip ? html`<button class="act" @click=${() => this._press(c.skip)}><ha-icon icon="mdi:calendar-remove"></ha-icon>Skip today</button>` : nothing}
        </div>
      </ha-card>
    `;
  }

  private _more(e?: string) {
    if (e && this._hass?.states[e]) moreInfo(this, e);
  }

  static styles = [hearth, css`
    :host { --fd-amber: #fbbf24; --fd-green: #34d399; --fd-red: #f87171; }
    ha-card {
      border-radius: var(--hl-r-card); padding: 14px;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent);
      background: var(--ha-card-background, var(--card-background-color, #111318));
      box-shadow: var(--hl-e1);
    }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .head > ha-icon { --mdc-icon-size: 20px; color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); }
    .title { font-size: 16px; font-weight: 700; }
    .spacer { flex: 1; }
    .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
    .pill ha-icon { --mdc-icon-size: 14px; }
    .pill.good { color: var(--fd-green); background: color-mix(in srgb, var(--fd-green) 13%, transparent); }
    .pill.alert { color: var(--fd-red); background: color-mix(in srgb, var(--fd-red) 14%, transparent); }

    .next { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 16px; cursor: pointer;
      border: 1px solid color-mix(in srgb, var(--fd-amber) 30%, transparent); background: color-mix(in srgb, var(--fd-amber) 8%, transparent); }
    .next > ha-icon { --mdc-icon-size: 26px; color: var(--fd-amber); }
    .next .k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: color-mix(in srgb, var(--primary-text-color) 45%, transparent); }
    .next .v { font-size: 20px; font-weight: 800; }
    .next .v small { font-size: 13px; font-weight: 600; color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); }

    .stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 10px; }
    .stat { padding: 9px 11px; border-radius: 13px; cursor: pointer; border: 1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent); background: color-mix(in srgb, var(--primary-text-color) 4%, transparent); }
    .sk { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; color: color-mix(in srgb, var(--primary-text-color) 45%, transparent); }
    .sv { font-size: 14px; font-weight: 700; margin-top: 2px; }
    .sv small { font-size: 11px; font-weight: 600; color: color-mix(in srgb, var(--primary-text-color) 50%, transparent); }
    .sv.warn { color: var(--fd-amber); }

    .portion { display: flex; align-items: center; margin-top: 12px; }
    .pk { font-size: 13px; font-weight: 600; color: color-mix(in srgb, var(--primary-text-color) 70%, transparent); }
    .stepper { margin-left: auto; display: flex; align-items: center; gap: 10px; }
    .stepper button { -webkit-appearance: none; appearance: none; width: 32px; height: 32px; border-radius: 999px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; color: var(--primary-text-color);
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent); background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
    .stepper button ha-icon { --mdc-icon-size: 18px; }
    .stepper button:active { transform: scale(.92); }
    .pv { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; min-width: 44px; text-align: center; }

    .actions { display: flex; gap: 8px; margin-top: 13px; }
    .act { -webkit-appearance: none; appearance: none; flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      padding: 12px; border-radius: 15px; cursor: pointer; font-family: inherit; font-size: 14px; font-weight: 700;
      color: var(--primary-text-color); border: 1px solid color-mix(in srgb, var(--primary-text-color) 12%, transparent);
      background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); transition: transform .07s, filter .12s; }
    .act ha-icon { --mdc-icon-size: 19px; }
    .act.primary { color: #1a1205; border: none; background: linear-gradient(180deg, color-mix(in srgb, var(--fd-amber) 85%, white 15%), var(--fd-amber)); }
    .act.primary ha-icon { color: #1a1205; }
    .act:hover { filter: brightness(1.05); }
    .act:active { transform: translateY(1px) scale(.985); }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "feeder-card",
  name: "Feeder Card",
  description: "Pet feeder detail: next/last feed, today's total, food & desiccant status, portion stepper and feed/skip actions.",
  preview: true,
});
