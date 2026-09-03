import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";

interface CalSpec { entity: string; color?: string; name?: string }
interface AgendaConfig extends LovelaceCardConfig {
  type: string;
  title?: string;
  calendars?: CalSpec[];
  days?: number; // window (default 2 = today + tomorrow)
  max?: number; // max events shown (default 5)
}

const NAMED: Record<string, string> = {
  amber: "#f5b301", teal: "#14b8a6", pink: "#ec4899", purple: "#9c6ade",
  blue: "#38bdf8", green: "#34d399", orange: "#fb8c00",
};

type Ev = { start: number; allDay: boolean; title: string; color: string };

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function fmtTime(ms: number): string {
  const d = new Date(ms);
  const hh = d.getHours();
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

@customElement("agenda-card")
export class AgendaCard extends LitElement {
  @state() private config!: AgendaConfig;
  @state() private events?: Ev[];
  private _loadedKey = "";
  private _loading = false;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.toggleAttribute("dark", !!(h?.themes as any)?.darkMode);
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): AgendaConfig {
    return { type: "custom:agenda-card", calendars: [] };
  }

  setConfig(config: AgendaConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = { title: "Agenda", days: 2, max: 5, ...config };
  }

  getCardSize(): number {
    return 3;
  }

  private get _cals(): CalSpec[] {
    return this.config.calendars ?? [];
  }
  private _color(c: CalSpec): string {
    const k = c.color ?? "amber";
    return NAMED[k] ?? k;
  }

  updated(): void {
    const key = `${this._cals.map((c) => c.entity).join(",")}:${this.config.days}`;
    if (this._hass && this._loadedKey !== key) this._load(key);
  }

  private async _load(key: string): Promise<void> {
    if (this._loading || !this._hass || !this._cals.length) return;
    this._loading = true;
    this._loadedKey = key;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + (this.config.days ?? 2) * 864e5);
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    try {
      const all: Ev[] = [];
      await Promise.all(
        this._cals.map(async (c) => {
          try {
            const res: any[] = await (this._hass as any).callApi(
              "GET",
              `calendars/${c.entity}?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`
            );
            for (const e of res ?? []) {
              const allDay = !!e.start?.date && !e.start?.dateTime;
              const iso = e.start?.dateTime ?? e.start?.date;
              const t = new Date(iso).getTime();
              if (Number.isFinite(t)) all.push({ start: t, allDay, title: e.summary || "(busy)", color: this._color(c) });
            }
          } catch { /* one calendar failing shouldn't kill the card */ }
        })
      );
      const now = Date.now();
      // keep all-day events for today onward, and timed events not yet finished-ish (>= now-1h)
      this.events = all
        .filter((e) => e.allDay || e.start >= now - 3600_000)
        .sort((a, b) => a.start - b.start);
    } catch {
      this.events = [];
    } finally {
      this._loading = false;
    }
  }

  private _dayLabel(ms: number): string {
    const d = new Date(ms);
    const today = new Date();
    const tom = new Date(today.getTime() + 864e5);
    if (dayKey(d) === dayKey(today)) return "Today";
    if (dayKey(d) === dayKey(tom)) return "Tomorrow";
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    return html`
      <ha-card>
        <div class="head">
          <ha-icon icon="mdi:calendar-blank-outline"></ha-icon>
          <span class="title">${this.config.title}</span>
        </div>
        ${this._body()}
      </ha-card>
    `;
  }

  private _body(): TemplateResult {
    if (!this.events) return html`<div class="empty">Loading…</div>`;
    if (!this.events.length)
      return html`<div class="empty warm"><ha-icon icon="mdi:white-balance-sunny"></ha-icon><div>Nothing on today</div><small>A clear day — enjoy it.</small></div>`;
    const shown = this.events.slice(0, this.config.max ?? 5);
    let lastDay = "";
    const rows: TemplateResult[] = [];
    for (const e of shown) {
      const label = this._dayLabel(e.start);
      if (label !== lastDay) {
        rows.push(html`<div class="daylabel">${label}</div>`);
        lastDay = label;
      }
      rows.push(html`
        <div class="ev">
          <span class="when ${classMap({ allday: e.allDay })}">${e.allDay ? "All day" : fmtTime(e.start)}</span>
          <span class="dot" style=${styleMap({ background: e.color, boxShadow: `0 0 6px ${e.color}` })}></span>
          <span class="what">${e.title}</span>
        </div>
      `);
    }
    const more = this.events.length - shown.length;
    if (more > 0) rows.push(html`<div class="more">+${more} more</div>`);
    return html`<div class="list">${rows}</div>`;
  }

  static styles = [hearth, css`
    ha-card {
      border-radius: var(--hl-r-card); padding: 14px 15px 12px;
      border: 1px solid var(--hl-hair);
      background: var(--ha-card-background, var(--card-background-color, #16181d));
      box-shadow: var(--hl-e1);
    }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .head ha-icon { --mdc-icon-size: 19px; color: var(--hl-text-2); }
    .title { font-size: 15px; font-weight: 700; }
    .empty { padding: 10px 2px 16px; font-size: 13px; color: var(--hl-text-3); }
    .empty.warm { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; padding: 20px 8px; }
    .empty.warm ha-icon { --mdc-icon-size: 30px; color: color-mix(in srgb, var(--hl-amber) 70%, var(--primary-text-color)); }
    .empty.warm div { font-size: 15px; font-weight: 700; color: var(--primary-text-color); }
    .empty.warm small { font-size: 12px; color: var(--hl-text-3); }

    .list { display: flex; flex-direction: column; }
    .daylabel { font-size: 11px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--hl-text-3); margin: 10px 0 4px; }
    .daylabel:first-child { margin-top: 0; }
    .ev { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
    .when { flex: 0 0 52px; font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--hl-text-2); }
    .when.allday { font-size: 11px; font-weight: 600; color: var(--hl-text-3); }
    .dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; }
    .what { font-size: 14px; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .more { font-size: 12px; font-weight: 600; color: var(--hl-text-3); padding: 8px 0 2px; }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "agenda-card",
  name: "Agenda Card",
  description: "Today/tomorrow across the family calendars with per-person colour dots and a warm empty state.",
  preview: true,
});
