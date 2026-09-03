import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo, entityPicture } from "../../shared/ha";

interface CameraSrc {
  entity: string;
  room: string;
}
interface CatStyle {
  color?: string;
  icon?: string;
  photo?: string; // static url (e.g. /local/pets/tots.jpg)
  image_entity?: string; // image./person. entity with a picture (e.g. image.thor_avatar)
}
interface PetActivityConfig extends LovelaceCardConfig {
  type: string;
  title?: string;
  hours?: number;
  max?: number;
  cameras?: CameraSrc[];
  cats?: Record<string, CatStyle>;
}

const NAMED: Record<string, string> = { orange: "#fb8c00", "deep-purple": "#7c4dff", teal: "#14b8a6", blue: "#38bdf8", pink: "#ec4899", green: "#34d399" };

const DEFAULT_CAMERAS: CameraSrc[] = [
  { entity: "sensor.kitchen_kitchen_our_cats_object_classification", room: "Kitchen" },
  { entity: "sensor.living_room_living_room_our_cats_object_classification", room: "Living Room" },
  { entity: "sensor.laundry_room_laundry_room_our_cats_object_classification", room: "Laundry Room" },
  { entity: "sensor.upstairs_foyer_upstairs_our_cats_object_classification", room: "Upstairs" },
  { entity: "sensor.front_doorbell_our_cats_object_classification", room: "Front door" },
  { entity: "sensor.petlibro_feeder_our_cats_object_classification", room: "Feeder" },
];
const DEFAULT_CATS: Record<string, CatStyle> = {
  Thor: { color: "orange", icon: "mdi:cat", image_entity: "image.thor_avatar" },
  Tots: { color: "deep-purple", icon: "mdi:cat", photo: "/local/pets/tots.jpg?v=20260903" },
};

type Ev = { cat: string; room: string; t: number };

@customElement("pet-activity-card")
export class PetActivityCard extends LitElement {
  @state() private config!: PetActivityConfig;
  @state() private events?: Ev[];
  private _loading = false;
  private _loadedKey = "";
  private _hass?: HomeAssistant;
  private _imgFailed = new Set<string>(); // avatar urls that 404'd — fall back to the icon

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): PetActivityConfig {
    return { type: "custom:pet-activity-card" };
  }

  setConfig(config: PetActivityConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = {
      ...config,
      title: config.title ?? "Recent activity",
      hours: config.hours ?? 24,
      max: config.max ?? 8,
      cameras: config.cameras ?? DEFAULT_CAMERAS,
      cats: config.cats ?? DEFAULT_CATS,
    };
  }

  getCardSize(): number {
    return 4;
  }

  private get _cats(): Record<string, CatStyle> {
    return this.config.cats ?? DEFAULT_CATS;
  }
  private _catKey(state: string): string | undefined {
    const lower = state.toLowerCase();
    return Object.keys(this._cats).find((k) => k.toLowerCase() === lower);
  }
  private _accent(cat: string): string {
    const c = this._cats[cat]?.color ?? "grey";
    return NAMED[c] ?? c;
  }
  private _catImg(cat: string): string | undefined {
    const st = this._cats[cat] ?? {};
    const src = st.image_entity ? entityPicture(this._hass, st.image_entity) : st.photo;
    return src && !this._imgFailed.has(src) ? src : undefined;
  }

  updated(): void {
    const key = `${this.config.hours}:${(this.config.cameras ?? []).length}`;
    if (this._hass && this._loadedKey !== key) this._load(key);
  }

  private async _load(key: string): Promise<void> {
    if (this._loading || !this._hass) return;
    this._loading = true;
    this._loadedKey = key;
    const cams = this.config.cameras ?? [];
    const end = new Date();
    const start = new Date(end.getTime() - (this.config.hours ?? 24) * 3600 * 1000);
    try {
      const res: any = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: cams.map((c) => c.entity),
        minimal_response: true,
        no_attributes: true,
      });
      const evs: Ev[] = [];
      for (const cam of cams) {
        const rows: any[] = res?.[cam.entity] ?? [];
        for (const p of rows) {
          const st = String(p.s ?? p.state ?? "");
          const cat = this._catKey(st);
          if (!cat) continue;
          const t = (p.lu ?? p.last_updated) * 1000;
          if (Number.isFinite(t)) evs.push({ cat, room: cam.room, t });
        }
      }
      evs.sort((a, b) => b.t - a.t);
      // collapse repeats of the same cat+room within 10 min
      const out: Ev[] = [];
      for (const e of evs) {
        const prev = out.find((o) => o.cat === e.cat && o.room === e.room);
        if (prev && Math.abs(prev.t - e.t) < 10 * 60 * 1000) continue;
        if (out.length && out[out.length - 1].cat === e.cat && out[out.length - 1].room === e.room && out[out.length - 1].t - e.t < 10 * 60 * 1000) continue;
        out.push(e);
        if (out.length >= (this.config.max ?? 8)) break;
      }
      this.events = out;
    } catch {
      this.events = [];
    } finally {
      this._loading = false;
    }
  }

  private _rel(t: number): string {
    const m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    return html`
      <ha-card>
        <div class="head">
          <ha-icon icon="mdi:paw"></ha-icon>
          <span class="title">${this.config.title}</span>
          <span class="spacer"></span>
          ${this.events?.length ? html`<span class="count">last ${this.config.hours}h</span>` : nothing}
        </div>
        ${this._renderBody()}
      </ha-card>
    `;
  }

  private _renderBody(): TemplateResult {
    if (!this.events) return html`<div class="empty">Loading…</div>`;
    if (!this.events.length) return html`<div class="empty">No cat sightings in the last ${this.config.hours}h</div>`;
    return html`<div class="feed">
      ${this.events.map((e) => {
        const st = this._cats[e.cat] ?? {};
        const img = this._catImg(e.cat);
        const accent = this._accent(e.cat);
        return html`<div class="row" @click=${() => this._more(e)}>
          <span class="dot ${img ? "has-img" : ""}" style=${styleMap({ background: `color-mix(in srgb, ${accent} 20%, transparent)`, color: accent, "--ring": accent })}>
            ${img
              ? html`<img src=${img} alt=${e.cat} @error=${() => { this._imgFailed.add(img); this.requestUpdate(); }} />`
              : html`<ha-icon icon=${st.icon ?? "mdi:cat"}></ha-icon>`}
          </span>
          <span class="who">${e.cat}</span>
          <span class="where"><ha-icon icon="mdi:map-marker"></ha-icon>${e.room}</span>
          <span class="spacer"></span>
          <span class="when">${this._rel(e.t)}</span>
        </div>`;
      })}
    </div>`;
  }

  private _more(e: Ev) {
    const cam = (this.config.cameras ?? []).find((c) => c.room === e.room);
    if (cam && this._hass?.states[cam.entity]) moreInfo(this, cam.entity);
  }

  static styles = [hearth, css`
    ha-card {
      border-radius: var(--hl-r-card); padding: 14px 14px 8px;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent);
      background: var(--ha-card-background, var(--card-background-color, #111318));
      box-shadow: var(--hl-e1);
    }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .head ha-icon { --mdc-icon-size: 18px; color: color-mix(in srgb, var(--primary-text-color) 55%, transparent); }
    .title { font-size: 15px; font-weight: 700; }
    .spacer { flex: 1; }
    .count { font-size: 11px; font-weight: 600; color: color-mix(in srgb, var(--primary-text-color) 45%, transparent); }
    .empty { padding: 14px 4px 18px; font-size: 13px; color: color-mix(in srgb, var(--primary-text-color) 45%, transparent); }
    .feed { display: flex; flex-direction: column; }
    .row { display: flex; align-items: center; gap: 10px; padding: 9px 4px; cursor: pointer; border-top: 1px solid color-mix(in srgb, var(--primary-text-color) 7%, transparent); }
    .row:first-child { border-top: none; }
    .dot { width: 30px; height: 30px; border-radius: 999px; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; overflow: hidden; }
    .dot ha-icon { --mdc-icon-size: 18px; }
    .dot.has-img { background: none !important; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ring, var(--hl-amber)) 60%, transparent); }
    .dot.has-img img { width: 100%; height: 100%; object-fit: cover; border-radius: 999px; display: block; }
    .who { font-size: 14px; font-weight: 700; }
    .where { display: inline-flex; align-items: center; gap: 3px; font-size: 13px; color: color-mix(in srgb, var(--primary-text-color) 62%, transparent); }
    .where ha-icon { --mdc-icon-size: 14px; }
    .when { font-size: 12px; font-weight: 600; color: color-mix(in srgb, var(--primary-text-color) 45%, transparent); font-variant-numeric: tabular-nums; }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "pet-activity-card",
  name: "Pet Activity Card",
  description: "Chronological feed of recent cat sightings (cat · room · time) from Frigate which-cat classifiers.",
  preview: true,
});
