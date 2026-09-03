import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo } from "../../shared/ha";

interface ConsumableSpec {
  entity: string;
  name?: string;
  icon?: string;
  warn?: number; // show when value <= warn
  critical?: number;
  unit?: string;
}
interface OfflineSpec {
  entity: string;
  name?: string;
  icon?: string;
}
interface NeedsAttentionConfig extends LovelaceCardConfig {
  type: string;
  title?: string;
  updates?: boolean; // scan update.* == on
  update_exclude?: string[]; // entity_id substrings to ignore
  consumables?: ConsumableSpec[];
  offline?: OfflineSpec[]; // curated watch-list of always-on devices
  show_ok?: boolean; // show a "nothing needs attention" state (default true)
}

type Item = {
  key: string;
  icon: string;
  label: string;
  value: string;
  tone: "critical" | "low";
  entity?: string;
  sub?: string;
};

@customElement("needs-attention-card")
export class NeedsAttentionCard extends LitElement {
  @state() private config!: NeedsAttentionConfig;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): NeedsAttentionConfig {
    return { type: "custom:needs-attention-card" };
  }

  setConfig(config: NeedsAttentionConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = { title: "Needs attention", updates: true, show_ok: true, ...config };
  }

  getCardSize(): number {
    return 3;
  }

  private _updateItems(): { count: number; names: string[] } {
    if (!this.config.updates || !this._hass) return { count: 0, names: [] };
    const excl = this.config.update_exclude ?? [];
    const on = Object.values(this._hass.states).filter(
      (s) =>
        s.entity_id.startsWith("update.") &&
        s.state === "on" &&
        !excl.some((x) => s.entity_id.includes(x))
    );
    const names = on
      .map((s) => (s.attributes.friendly_name ?? s.entity_id).replace(/\s*update$/i, "").trim())
      .sort();
    return { count: on.length, names };
  }

  private _consumableItems(): Item[] {
    if (!this._hass) return [];
    const out: Item[] = [];
    for (const c of this.config.consumables ?? []) {
      const st = this._hass.states[c.entity];
      if (!st) continue;
      const v = Number(st.state);
      if (!Number.isFinite(v)) continue;
      const warn = c.warn ?? 20;
      if (v > warn) continue; // not low enough to surface
      const crit = c.critical ?? warn / 2;
      const unit = c.unit ?? st.attributes.unit_of_measurement ?? "";
      out.push({
        key: c.entity,
        icon: c.icon ?? "mdi:alert-circle-outline",
        label: c.name ?? (st.attributes.friendly_name ?? c.entity),
        value: `${Math.round(v)}${unit}`,
        tone: v <= crit ? "critical" : "low",
        entity: c.entity,
      });
    }
    // most-urgent first
    return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "critical" ? -1 : 1));
  }

  private _offlineItems(): Item[] {
    if (!this._hass) return [];
    const out: Item[] = [];
    for (const o of this.config.offline ?? []) {
      const st = this._hass.states[o.entity];
      // connectivity sensors report 'on' when connected; everything else is
      // online unless its state is a non-value.
      const online =
        st &&
        (st.attributes.device_class === "connectivity"
          ? st.state === "on"
          : st.state !== "unavailable" && st.state !== "unknown");
      if (online) continue;
      out.push({
        key: o.entity,
        icon: o.icon ?? "mdi:wifi-off",
        label: o.name ?? (st?.attributes.friendly_name ?? o.entity),
        value: "offline",
        tone: "critical",
        entity: o.entity,
      });
    }
    return out;
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const upd = this._updateItems();
    const cons = this._consumableItems();
    const offline = this._offlineItems();
    const total = (upd.count ? 1 : 0) + cons.length + offline.length;

    return html`
      <ha-card>
        <div class="head">
          <ha-icon icon="mdi:bell-alert-outline"></ha-icon>
          <span class="title">${this.config.title}</span>
          <span class="spacer"></span>
          ${total
            ? html`<span class="badge">${total} item${total === 1 ? "" : "s"}</span>`
            : html`<span class="ok"><ha-icon icon="mdi:check-circle"></ha-icon>all clear</span>`}
        </div>
        ${total
          ? html`<div class="list">
              ${offline.map((i) => this._consRow(i))}
              ${upd.count ? this._updateRow(upd) : nothing}
              ${cons.map((i) => this._consRow(i))}
            </div>`
          : this.config.show_ok !== false
            ? html`<div class="empty">Nothing needs attention right now.</div>`
            : nothing}
      </ha-card>
    `;
  }

  private _updateRow(upd: { count: number; names: string[] }): TemplateResult {
    const shown = upd.names.slice(0, 4).join(" · ");
    const more = upd.names.length > 4 ? ` +${upd.names.length - 4} more` : "";
    return html`
      <div class="row info">
        <ha-icon class="ic" icon="mdi:package-up"></ha-icon>
        <div class="mid">
          <div class="label">${upd.count} update${upd.count === 1 ? "" : "s"} available</div>
          <div class="sub">${shown}${more}</div>
        </div>
      </div>
    `;
  }

  private _consRow(i: Item): TemplateResult {
    return html`
      <div class="row ${i.tone}" @click=${() => i.entity && this._more(i.entity)}>
        <ha-icon class="ic" icon=${i.icon}></ha-icon>
        <div class="mid"><div class="label">${i.label}</div></div>
        <div class="val">${i.value}</div>
      </div>
    `;
  }

  private _more(e: string) {
    if (this._hass?.states[e]) moreInfo(this, e);
  }

  static styles = [hearth, css`
    :host {
      --na-red: #f87171;
      --na-amber: #fbbf24;
      --na-blue: #38bdf8;
    }
    ha-card {
      border-radius: var(--hl-r-card); padding: 14px 14px 10px;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent);
      background: var(--ha-card-background, var(--card-background-color, #111318));
      box-shadow: var(--hl-e1);
    }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .head > ha-icon { --mdc-icon-size: 19px; color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); }
    .title { font-size: 15px; font-weight: 700; }
    .spacer { flex: 1; }
    .badge { font-size: 12px; font-weight: 700; color: var(--na-amber); background: color-mix(in srgb, var(--na-amber) 14%, transparent); padding: 3px 9px; border-radius: 999px; }
    .ok { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; color: #34d399; }
    .ok ha-icon { --mdc-icon-size: 15px; }
    .empty { padding: 6px 2px 12px; font-size: 13px; color: color-mix(in srgb, var(--primary-text-color) 45%, transparent); }

    .list { display: flex; flex-direction: column; }
    .row { display: flex; align-items: center; gap: 12px; padding: 9px 2px; border-top: 1px solid color-mix(in srgb, var(--primary-text-color) 7%, transparent); }
    .row:first-child { border-top: none; }
    .row.critical, .row.low { cursor: pointer; }
    .ic { --mdc-icon-size: 21px; flex: 0 0 auto; }
    .row.critical .ic, .row.critical .val { color: var(--na-red); }
    .row.low .ic, .row.low .val { color: var(--na-amber); }
    .row.info .ic { color: var(--na-blue); }
    .mid { flex: 1; min-width: 0; }
    .label { font-size: 13.5px; font-weight: 600; }
    .sub { font-size: 11px; color: color-mix(in srgb, var(--primary-text-color) 45%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
    .val { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "needs-attention-card",
  name: "Needs Attention Card",
  description: "Actionable maintenance digest: pending updates + consumables below threshold.",
  preview: true,
});
