import { css } from "lit";

/**
 * "Hearthlight" — the house-wide design language shared by every card.
 * The dashboard is a warm, quiet hearth: neutral chrome, amber earned only for
 * life (a light on, charging, an animal active), touch (primary action, focus)
 * and now (the active tab). Movement settles (ease-out, small, once); light
 * fades (linear opacity, slower). Compose into a card with:
 *     static styles = [hearth, css`…`];
 * Tokens are :host custom properties so an HA theme can retune them.
 */
export const hearth = css`
  :host {
    --hl-amber: #f5b301;
    --hl-glow: color-mix(in srgb, var(--hl-amber) 22%, transparent);
    --hl-hair: color-mix(in srgb, var(--primary-text-color) 9%, transparent);
    --hl-wash-1: color-mix(in srgb, var(--primary-text-color) 4%, transparent);
    --hl-wash-2: color-mix(in srgb, var(--primary-text-color) 7%, transparent);
    --hl-text-2: color-mix(in srgb, var(--primary-text-color) 62%, transparent);
    --hl-text-3: color-mix(in srgb, var(--primary-text-color) 45%, transparent);

    /* radius */
    --hl-r-card: 24px;
    --hl-r-inner: 16px;
    --hl-r-tile: 12px;
    --hl-r-sheet: 28px;

    /* elevation (never animated on cards) */
    --hl-shadow-a: 0.5;
    --hl-e1: 0 16px 34px -22px rgb(0 0 0 / var(--hl-shadow-a));
    --hl-e2: 0 8px 18px -8px rgb(0 0 0 / calc(var(--hl-shadow-a) * 0.8));
    --hl-e3: 0 30px 70px -24px rgb(0 0 0 / calc(var(--hl-shadow-a) + 0.05));

    /* motion */
    --hl-settle: cubic-bezier(0.22, 1, 0.36, 1); /* entrances, values, fills */
    --hl-shift: cubic-bezier(0.65, 0, 0.35, 1); /* things travelling between positions */
    --hl-d1: 100ms; /* touch feedback */
    --hl-d2: 250ms; /* state changes, exits */
    --hl-d3: 450ms; /* data: fills, gauges, entrances */
    --hl-d4: 700ms; /* ambient: glow, border warming */
  }

  /* every card settles in on load (cards that set their own animation override) */
  ha-card { animation: hl-rise var(--hl-d3) var(--hl-settle) both; }

  @keyframes hl-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes hl-settle-dot { from { transform: scale(0.6); } to { transform: scale(1); } }
  @keyframes hl-sheet-in { from { opacity: 0; transform: scale(0.94) translateY(8px); } to { opacity: 1; transform: none; } }

  @media (prefers-reduced-motion: reduce) {
    :host, :host * { animation: none !important; transition-duration: 1ms !important; }
  }
`;
