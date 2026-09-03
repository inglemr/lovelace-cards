import { LitElement, html, nothing, css, type TemplateResult } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo } from "../../shared/ha";

interface NowPlayingConfig extends LovelaceCardConfig {
  type: string;
  players?: string[]; // candidate media_players; default = auto-detect all
  exclude?: string[]; // entity ids to ignore
}

const ACTIVE = new Set(["playing", "paused", "buffering"]);
// bit flags from media_player supported_features
const SF = { PAUSE: 1, PREV: 16, NEXT: 32, VOL_SET: 4, PLAY: 16384 };

@customElement("nowplaying-card")
export class NowPlayingCard extends LitElement {
  @state() private config!: NowPlayingConfig;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.toggleAttribute("dark", !!(h?.themes as any)?.darkMode);
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): NowPlayingConfig {
    return { type: "custom:nowplaying-card" };
  }

  setConfig(config: NowPlayingConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this.config = { ...config };
  }

  getCardSize(): number {
    return 3;
  }

  // pick the most-recently-changed active player
  private _active(): string | undefined {
    const hass = this._hass;
    if (!hass) return undefined;
    const exclude = new Set(this.config.exclude ?? []);
    let ids = this.config.players ?? Object.keys(hass.states).filter((e) => e.startsWith("media_player."));
    ids = ids.filter((e) => !exclude.has(e) && ACTIVE.has(hass.states[e]?.state));
    ids.sort((a, b) => new Date(hass.states[b].last_changed).getTime() - new Date(hass.states[a].last_changed).getTime());
    return ids[0];
  }

  private _svc(service: string, data: Record<string, unknown> = {}) {
    const e = this._active();
    if (!e || !this._hass) return;
    this._hass.callService("media_player", service, { entity_id: e, ...data });
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const id = this._active();
    if (!id) return this._empty();
    const st = this._hass.states[id];
    const a = st.attributes;
    const playing = st.state === "playing";
    const art = a.entity_picture || undefined; // relative /api/... resolves against origin in-browser
    const title = a.media_title || a.friendly_name || "Playing";
    const sub = a.media_artist || a.media_series_title || a.app_name || a.source || "";
    const feat = Number(a.supported_features ?? 0);
    const vol = typeof a.volume_level === "number" ? a.volume_level : undefined;

    return html`
      <ha-card>
        <div class="np">
          <button class="art ${classMap({ ph: !art })}" @click=${() => moreInfo(this, id)} style=${styleMap(art ? { backgroundImage: `url("${art}")` } : {})}>
            ${art ? nothing : html`<ha-icon icon="mdi:music"></ha-icon>`}
          </button>
          <div class="meta">
            <div class="where"><span class="eq"><i></i><i></i><i></i></span>${a.friendly_name ?? ""}</div>
            <div class="title">${title}</div>
            ${sub ? html`<div class="sub">${sub}</div>` : nothing}
            <div class="controls">
              ${feat & SF.PREV ? html`<button class="c" @click=${() => this._svc("media_previous_track")}><ha-icon icon="mdi:skip-previous"></ha-icon></button>` : nothing}
              <button class="c play" @click=${() => this._svc("media_play_pause")}>
                <ha-icon icon=${playing ? "mdi:pause" : "mdi:play"}></ha-icon>
              </button>
              ${feat & SF.NEXT ? html`<button class="c" @click=${() => this._svc("media_next_track")}><ha-icon icon="mdi:skip-next"></ha-icon></button>` : nothing}
              ${vol !== undefined && feat & SF.VOL_SET
                ? html`<div class="vol">
                    <ha-icon icon="mdi:volume-medium"></ha-icon>
                    <input type="range" min="0" max="100" .value=${String(Math.round(vol * 100))}
                      @change=${(e: Event) => this._svc("volume_set", { volume_level: Number((e.target as HTMLInputElement).value) / 100 })} />
                  </div>`
                : nothing}
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  private _empty(): TemplateResult {
    return html`<ha-card class="empty">
      <ha-icon icon="mdi:music-note-off-outline"></ha-icon>
      <div class="et">Nothing playing</div>
      <div class="es">Start something from a room below, or say the word.</div>
    </ha-card>`;
  }

  static styles = [hearth, css`
    ha-card {
      border-radius: var(--hl-r-card); padding: 14px;
      border: 1px solid color-mix(in srgb, var(--hl-amber) 18%, transparent);
      background: linear-gradient(180deg, color-mix(in oklab, var(--hl-amber) 5%, var(--card-background-color, #fff)), color-mix(in oklab, var(--hl-amber) 9%, var(--card-background-color, #fff)));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .7), 0 6px 16px rgb(var(--hl-ember) / .08), 0 24px 48px -24px rgb(var(--hl-ember) / .16);
    }
    :host([dark]) ha-card { background: linear-gradient(180deg, color-mix(in oklab, var(--hl-amber) 8%, var(--card-background-color, #16181d)), color-mix(in oklab, var(--hl-amber) 3%, var(--card-background-color, #16181d))); border-color: color-mix(in srgb, var(--hl-amber) 14%, transparent); box-shadow: 0 8px 24px rgb(0 0 0 / .35); }

    .np { display: flex; gap: 14px; align-items: stretch; }
    button { -webkit-appearance: none; appearance: none; font-family: inherit; border: none; background: none; padding: 0; margin: 0; cursor: pointer; color: inherit; }

    .art { width: 96px; height: 96px; flex: 0 0 auto; border-radius: 16px; background-size: cover; background-position: center;
      box-shadow: inset 0 0 0 1px rgb(255 255 255 / .1), 0 8px 20px -8px rgb(var(--hl-ember) / .4); transition: transform var(--hl-d1) var(--hl-shift); }
    .art:active { transform: scale(.97); }
    .art.ph { display: flex; align-items: center; justify-content: center;
      background: color-mix(in oklab, rgb(var(--hl-ember)) 6%, var(--card-background-color, #fff)); box-shadow: inset 0 1.5px 3px rgb(var(--hl-ember) / .1); }
    .art.ph ha-icon { --mdc-icon-size: 34px; color: var(--hl-text-3); }

    .meta { min-width: 0; flex: 1; display: flex; flex-direction: column; }
    .where { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase;
      color: color-mix(in srgb, var(--hl-amber) 55%, var(--primary-text-color)); }
    .eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 11px; }
    .eq i { width: 2px; height: 60%; background: currentColor; border-radius: 1px; animation: eq 1.5s ease-in-out infinite alternate; }
    .eq i:nth-child(2) { animation-delay: .3s; } .eq i:nth-child(3) { animation-delay: .6s; }
    @keyframes eq { from { height: 25%; } to { height: 100%; } }
    .title { font-size: 17px; font-weight: 700; letter-spacing: -.01em; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { font-size: 13px; color: var(--hl-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }

    .controls { display: flex; align-items: center; gap: 6px; margin-top: auto; padding-top: 10px; }
    .c { width: 38px; height: 38px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: var(--primary-text-color);
      background: color-mix(in oklab, rgb(var(--hl-ember)) 5%, var(--card-background-color, #fff)); box-shadow: inset 0 1px 2px rgb(var(--hl-ember) / .08), inset 0 -1px 0 rgb(255 255 255 / .5);
      transition: transform var(--hl-d1) var(--hl-shift); }
    :host([dark]) .c { background: color-mix(in oklab, black 20%, var(--card-background-color, #16181d)); box-shadow: inset 0 1.5px 3px rgb(0 0 0 / .35); }
    .c ha-icon { --mdc-icon-size: 20px; }
    .c:active { transform: scale(.9); }
    .c.play { width: 44px; height: 44px; color: var(--hl-ink-on-amber);
      background: linear-gradient(180deg, var(--hl-amber-hot), var(--hl-amber-deep));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .4), 0 4px 12px rgb(245 179 1 / .35); }
    .c.play ha-icon { --mdc-icon-size: 24px; }

    .vol { display: flex; align-items: center; gap: 6px; flex: 1; margin-left: 6px; min-width: 60px; }
    .vol ha-icon { --mdc-icon-size: 18px; color: var(--hl-text-3); }
    .vol input { flex: 1; -webkit-appearance: none; appearance: none; height: 6px; border-radius: 999px; cursor: pointer;
      background: color-mix(in oklab, rgb(var(--hl-ember)) 10%, var(--card-background-color, #fff)); }
    .vol input::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 999px; background: var(--hl-amber); box-shadow: 0 1px 4px rgb(var(--hl-ember) / .4); }

    ha-card.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 30px 18px; gap: 6px; }
    ha-card.empty ha-icon { --mdc-icon-size: 34px; color: var(--hl-text-3); }
    .et { font-size: 15px; font-weight: 700; }
    .es { font-size: 12.5px; color: var(--hl-text-3); max-width: 240px; }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "nowplaying-card",
  name: "Now Playing Card",
  description: "The active media player as a hero: album art, title/artist, transport + volume. Calm empty state.",
  preview: true,
});
