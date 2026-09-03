import { LitElement, html, nothing, css } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { LovelaceCardConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";
import { moreInfo } from "../../shared/ha";

interface CameraFrameConfig extends LovelaceCardConfig {
  type: string;
  camera?: string;
  name?: string;
  motion?: string; // binary_sensor; on = motion now, last_changed = "last motion"
  aspect?: string; // e.g. "16/9" (default) or "4/3"
}

function rel(iso?: string): string | undefined {
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

@customElement("camera-frame")
export class CameraFrame extends LitElement {
  @state() private config!: CameraFrameConfig;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
    this.toggleAttribute("dark", !!(h?.themes as any)?.darkMode);
    this.requestUpdate();
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): CameraFrameConfig {
    return { type: "custom:camera-frame" };
  }

  setConfig(config: CameraFrameConfig): void {
    if (!config || !config.camera) throw new Error("camera-frame: 'camera' is required");
    this.config = { aspect: "16/9", ...config };
  }

  getCardSize(): number {
    return 3;
  }

  render() {
    if (!this.config || !this._hass) return nothing;
    const c = this.config;
    const cam = this._hass.states[c.camera!];
    if (!cam) return html`<ha-card class="missing">Camera unavailable</ha-card>`;
    const snap = cam.attributes.entity_picture;
    const name = c.name ?? cam.attributes.friendly_name ?? c.camera;
    const mo = c.motion ? this._hass.states[c.motion] : undefined;
    const moNow = mo?.state === "on";
    const lastMotion = mo ? rel(mo.last_changed) : undefined;
    const caption = moNow ? "Motion now" : lastMotion ? `Motion ${lastMotion}` : "";

    return html`
      <ha-card class=${classMap({ live: moNow })}>
        <button class="frame" style=${styleMap({ aspectRatio: c.aspect! })} @click=${() => moreInfo(this, c.camera!)}>
          ${snap ? html`<img src=${snap} alt=${name} />` : html`<ha-icon class="ph" icon="mdi:cctv"></ha-icon>`}
          <span class="scrim"></span>
          <span class="live-badge"><ha-icon icon="mdi:arrow-expand"></ha-icon>Live</span>
          <span class="foot">
            <span class="nm">${name}</span>
            ${caption ? html`<span class="cap ${classMap({ now: moNow })}">${moNow ? html`<span class="dot"></span>` : nothing}${caption}</span>` : nothing}
          </span>
        </button>
      </ha-card>
    `;
  }

  static styles = [hearth, css`
    ha-card { border-radius: var(--hl-r-card); padding: 6px; overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent);
      background: var(--ha-card-background, var(--card-background-color, #16181d)); box-shadow: var(--hl-e1);
      transition: border-color var(--hl-d4) var(--hl-settle), box-shadow var(--hl-d4) var(--hl-settle); }
    ha-card.live { border-color: color-mix(in srgb, var(--hl-amber) 45%, transparent); box-shadow: var(--hl-e1), 0 0 0 1px color-mix(in srgb, var(--hl-amber) 20%, transparent), 0 10px 30px -10px rgb(245 179 1 / .3); }
    ha-card.missing { padding: 24px; text-align: center; color: var(--hl-text-3); font-size: 13px; }
    button { -webkit-appearance: none; appearance: none; border: none; background: none; padding: 0; margin: 0; cursor: pointer; color: inherit; }
    .frame { position: relative; display: block; width: 100%; border-radius: 18px; overflow: hidden; background: color-mix(in oklab, rgb(var(--hl-ember)) 8%, var(--card-background-color, #16181d)); }
    .frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ph { position: absolute; inset: 0; margin: auto; --mdc-icon-size: 40px; color: var(--hl-text-3); }
    .scrim { position: absolute; inset: 0; background: linear-gradient(0deg, rgb(0 0 0 / .6), transparent 42%); pointer-events: none; }
    .live-badge { position: absolute; right: 9px; top: 9px; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: #fff;
      padding: 4px 9px; border-radius: 999px; background: rgb(0 0 0 / .4); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
    .live-badge ha-icon { --mdc-icon-size: 13px; }
    .foot { position: absolute; left: 12px; right: 12px; bottom: 10px; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; pointer-events: none; }
    .nm { color: #fff; font-size: 14px; font-weight: 700; text-shadow: 0 1px 3px rgb(0 0 0 / .5); }
    .cap { display: inline-flex; align-items: center; gap: 5px; color: rgb(255 255 255 / .8); font-size: 11.5px; font-weight: 600; text-shadow: 0 1px 3px rgb(0 0 0 / .5); }
    .cap.now { color: color-mix(in srgb, var(--hl-amber) 60%, #fff); }
    .cap .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--hl-amber); box-shadow: 0 0 6px var(--hl-amber); animation: cf-pulse 1.4s ease-in-out infinite; }
    @keyframes cf-pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "camera-frame",
  name: "Camera Frame",
  description: "A camera still in a warm Hearthlight frame with name + last-motion caption; tap for live.",
  preview: true,
});
