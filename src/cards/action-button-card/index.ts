import { LitElement, html, nothing, css } from "lit";
import { hearth } from "../../shared/hearth";
import { customElement, state } from "lit/decorators.js";
import { handleAction, type LovelaceCardConfig, type ActionConfig } from "custom-card-helpers";
import type { HomeAssistant } from "../../shared/ha";

interface ActionButtonConfig extends LovelaceCardConfig {
  type: string;
  label: string;
  sublabel?: string;
  icon?: string;
  color?: string; // named or css colour
  variant?: "filled" | "outlined";
  entity?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

const NAMED: Record<string, string> = {
  amber: "#f59e0b",
  orange: "#fb8c00",
  blue: "#0ea5e9",
  teal: "#14b8a6",
  green: "#22c55e",
  red: "#ef4444",
  purple: "#8b5cf6",
  "deep-purple": "#7c4dff",
  grey: "#64748b",
  slate: "#64748b",
};

@customElement("action-button-card")
export class ActionButtonCard extends LitElement {
  @state() private config!: ActionButtonConfig;
  private _hass?: HomeAssistant;

  set hass(h: HomeAssistant) {
    this._hass = h;
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  static getStubConfig(): ActionButtonConfig {
    return { type: "custom:action-button-card", label: "Run", icon: "mdi:play", color: "blue", tap_action: { action: "none" } };
  }

  setConfig(config: ActionButtonConfig): void {
    if (!config || !config.label) throw new Error("action-button-card: 'label' is required");
    this.config = { variant: "filled", color: "blue", ...config };
  }

  getCardSize(): number {
    return 1;
  }

  private get _color(): string {
    const c = this.config.color ?? "blue";
    return NAMED[c] ?? c;
  }

  private _run(action: "tap" | "hold" | "double_tap") {
    if (!this._hass) return;
    handleAction(this, this._hass, this.config as any, action);
  }

  render() {
    if (!this.config) return nothing;
    const c = this.config;
    const outlined = c.variant === "outlined";
    return html`
      <button
        class=${outlined ? "btn outlined" : "btn filled"}
        style="--abc: ${this._color}"
        @click=${() => this._run("tap")}
      >
        ${c.icon ? html`<ha-icon icon=${c.icon}></ha-icon>` : nothing}
        <span class="labels">
          <span class="label">${c.label}</span>
          ${c.sublabel ? html`<span class="sub">${c.sublabel}</span>` : nothing}
        </span>
      </button>
    `;
  }

  static styles = [hearth, css`
    :host { display: block; height: 100%; }
    .btn {
      -webkit-appearance: none; appearance: none;
      width: 100%; height: 100%; min-height: 56px;
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 12px 14px; border-radius: var(--hl-r-inner); cursor: pointer;
      font-family: inherit; font-weight: 700; font-size: 15px; line-height: 1.1;
      transition: transform 0.07s ease, filter 0.12s ease, box-shadow 0.12s ease;
    }
    .btn ha-icon { --mdc-icon-size: 22px; flex: 0 0 auto; }
    .labels { display: flex; flex-direction: column; align-items: flex-start; }
    .sub { font-size: 11px; font-weight: 600; opacity: 0.85; margin-top: 1px; }

    .filled {
      border: none;
      color: #0b1220;
      background: linear-gradient(180deg, color-mix(in srgb, var(--abc) 82%, white 18%), var(--abc));
      box-shadow: 0 8px 18px -8px color-mix(in srgb, var(--abc) 85%, transparent);
    }
    .filled ha-icon { color: #0b1220; }
    .outlined {
      color: var(--abc);
      background: color-mix(in srgb, var(--abc) 10%, transparent);
      border: 1.5px solid color-mix(in srgb, var(--abc) 65%, transparent);
    }
    .outlined ha-icon { color: var(--abc); }

    .btn:hover { filter: brightness(1.05); }
    .btn:active { transform: translateY(1px) scale(0.985); filter: brightness(0.95); }
    .btn:focus-visible { outline: 2px solid var(--abc); outline-offset: 2px; }
  `];
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "action-button-card",
  name: "Action Button Card",
  description: "A real, pressable button (filled/outlined) that fires a Home Assistant action with native confirm.",
  preview: false,
});
