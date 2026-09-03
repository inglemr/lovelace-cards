import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { stateStr, entityPicture, moreInfo } from "../../shared/ha";

interface PersonSpec {
  entity: string;
  name?: string;
  color?: string; // accent for the no-photo avatar / home ring
}
interface PresenceConfig extends LovelaceCardConfig {
  type: string;
  title?: string;
  people?: PersonSpec[];
}

const NAMED: Record<string, string> = {
  amber: "#f5b301",
  orange: "#fb8c00",
  teal: "#14b8a6",
  blue: "#38bdf8",
  purple: "#9c6ade",
  pink: "#ec4899",
  green: "#34d399",
};

// person.state is "home", "not_home", or a named zone ("Mater Hospital").
function isHome(s?: string): boolean {
  return (s ?? "").toLowerCase() === "home";
}
function placeLabel(s?: string): string {
  if (!s) return "Away";
  const l = s.toLowerCase();
  if (l === "home") return "Home";
  if (l === "not_home") return "Away";
  return s; // a named zone — show it verbatim ("Mater Hospital")
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}
function relSince(ms?: number): string | undefined {
  if (!ms) return undefined;
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

@customElement("presence-card")
export class PresenceCard extends LitElement {
  @state() private config!: PresenceConfig;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): PresenceConfig {
    return { type: "custom:presence-card", people: [] };
  }

  setConfig(config: PresenceConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = { ...config }; // title optional — omit for a header-less hero row
  }

  getCardSize(): number {
    return 1;
  }

  private get _people(): PersonSpec[] {
    return this.config.people ?? [];
  }

  private _accent(p: PersonSpec): string {
    const c = p.color ?? "amber";
    return NAMED[c] ?? c;
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const people = this._people.filter((p) => this._hass!.states[p.entity]);
    if (!people.length) return nothing;
    const homeCount = people.filter((p) => isHome(stateStr(this._hass, p.entity))).length;
    return html`
      <ha-card class=${classMap({ bare: !this.config.title })}>
        ${this.config.title
          ? html`<div class="head">
              <span class="title">${this.config.title}</span>
              <span class="spacer"></span>
              <span class="count">${homeCount ? `${homeCount} home` : "nobody home"}</span>
            </div>`
          : nothing}
        <div class="people">${people.map((p) => this._person(p))}</div>
      </ha-card>
    `;
  }

  private _person(p: PersonSpec): TemplateResult {
    const st = this._hass!.states[p.entity];
    const s = st?.state;
    const home = isHome(s);
    const name = p.name ?? st?.attributes.friendly_name ?? p.entity;
    const pic = entityPicture(this._hass, p.entity);
    const accent = this._accent(p);
    const since = relSince(st?.last_changed ? new Date(st.last_changed).getTime() : undefined);
    const place = placeLabel(s);
    const sub = home ? "Home" : since ? `${place} · ${since}` : place;
    const first = (name.trim().split(/\s+/)[0]) || name;
    return html`
      <button class=${classMap({ person: true, home })} @click=${() => moreInfo(this, p.entity)} style=${styleMap({ "--pc-accent": accent })}>
        <span class="avatar">
          ${pic
            ? html`<img src=${pic} alt=${name} @error=${(e: Event) => ((e.target as HTMLImageElement).style.display = "none")} />`
            : html`<span class="ini">${initials(name)}</span>`}
          <span class="ring"></span>
        </span>
        <span class="name">${first}</span>
        <span class="sub">${sub}</span>
      </button>
    `;
  }

  static styles = [hearth, css`
    ha-card {
      border-radius: var(--hl-r-card); padding: 12px 14px 14px;
      border: 1px solid var(--hl-hair);
      background: var(--ha-card-background, var(--card-background-color, #111318));
      box-shadow: var(--hl-e1);
    }
    /* header-less hero variant: blend into the greeting block above it */
    ha-card.bare { padding: 4px 4px 6px; background: none; border: none; box-shadow: none; }
    .head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
    .title { font-size: 15px; font-weight: 700; }
    .spacer { flex: 1; }
    .count { font-size: 11.5px; font-weight: 600; color: var(--hl-text-3); }

    .people { display: flex; gap: 6px; flex-wrap: wrap; }
    .person {
      -webkit-appearance: none; appearance: none; border: none; background: none;
      font-family: inherit; cursor: pointer; color: inherit;
      flex: 1 1 0; min-width: 74px;
      display: flex; flex-direction: column; align-items: center; gap: 5px;
      padding: 6px 4px; border-radius: var(--hl-r-inner);
      transition: background var(--hl-d2) var(--hl-settle), transform var(--hl-d1) var(--hl-shift);
    }
    .person:hover { background: var(--hl-wash-1); }
    .person:active { transform: scale(0.96); }

    .avatar { position: relative; width: 50px; height: 50px; }
    .avatar img, .avatar .ini {
      width: 50px; height: 50px; border-radius: 999px; object-fit: cover;
      display: flex; align-items: center; justify-content: center;
      font-size: 17px; font-weight: 700; box-sizing: border-box;
    }
    .avatar .ini {
      color: var(--pc-accent);
      background: color-mix(in srgb, var(--pc-accent) 16%, transparent);
    }
    /* the ring: warm + solid when home, thin + grey when away; photo desaturates away */
    .avatar .ring { position: absolute; inset: -3px; border-radius: 999px; pointer-events: none;
      box-shadow: 0 0 0 2px var(--hl-hair); transition: box-shadow var(--hl-d3) var(--hl-settle); }
    .person.home .avatar .ring {
      box-shadow: 0 0 0 2.5px var(--pc-accent), 0 0 14px -2px color-mix(in srgb, var(--pc-accent) 55%, transparent);
    }
    .person:not(.home) .avatar img { filter: grayscale(1) brightness(0.9); opacity: 0.7; }
    .person:not(.home) .avatar .ini { opacity: 0.55; }

    .name { font-size: 13px; font-weight: 700; line-height: 1; }
    .person:not(.home) .name { color: var(--hl-text-2); }
    .sub { font-size: 10.5px; font-weight: 600; line-height: 1.1; text-align: center;
      color: var(--hl-text-3); max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .person.home .sub { color: var(--pc-accent); }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "presence-card",
  name: "Presence Card",
  description: "Who's home — person avatars with a warm ring when home, greyed + location when away.",
  preview: true,
});
