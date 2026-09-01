import { css } from "lit";

export const styles = css`
  :host {
    --pv-radius: 24px;
    --pv-elec: #34d399; /* emerald */
    --pv-elec-2: #10b981;
    --pv-fuel: #fbbf24; /* amber */
    --pv-fuel-2: #f59e0b;
    --pv-accent: #f5b301;
    --pv-good: #34d399;
    --pv-alert: #f87171;
    --pv-muted: color-mix(in srgb, var(--primary-text-color) 46%, transparent);
    --pv-hair: 1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent);
  }

  ha-card {
    position: relative;
    overflow: hidden;
    border-radius: var(--pv-radius);
    border: var(--pv-hair);
    padding: 16px 16px 14px;
    background:
      radial-gradient(120% 90% at 50% -10%, color-mix(in srgb, var(--pv-accent) 10%, transparent), transparent 60%),
      linear-gradient(180deg, color-mix(in srgb, var(--primary-text-color) 4%, transparent), transparent 40%),
      var(--ha-card-background, var(--card-background-color, #111318));
    box-shadow: 0 18px 40px -22px rgba(0, 0, 0, 0.65);
  }

  /* header */
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 2px;
  }
  .title {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.2px;
    line-height: 1;
  }
  .title .brand {
    color: var(--pv-accent);
    margin-right: 6px;
  }
  .header .spacer {
    flex: 1;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 9px;
    border-radius: 999px;
    border: var(--pv-hair);
    color: var(--pv-muted);
    background: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
    white-space: nowrap;
  }
  .pill ha-icon {
    --mdc-icon-size: 15px;
  }
  .pill.good {
    color: var(--pv-good);
    border-color: color-mix(in srgb, var(--pv-good) 40%, transparent);
    background: color-mix(in srgb, var(--pv-good) 12%, transparent);
  }
  .pill.alert {
    color: var(--pv-alert);
    border-color: color-mix(in srgb, var(--pv-alert) 45%, transparent);
    background: color-mix(in srgb, var(--pv-alert) 12%, transparent);
  }
  .pill.charge {
    color: #38bdf8;
    border-color: color-mix(in srgb, #38bdf8 45%, transparent);
    background: color-mix(in srgb, #38bdf8 12%, transparent);
  }
  .pill.charge ha-icon {
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  /* hero image */
  .hero {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 132px;
    margin: 2px 0 6px;
  }
  .hero::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 62%;
    width: 76%;
    height: 40px;
    transform: translate(-50%, 0);
    background: radial-gradient(closest-side, rgba(0, 0, 0, 0.5), transparent 78%);
    filter: blur(4px);
  }
  .hero img {
    max-height: 132px;
    max-width: 100%;
    object-fit: contain;
    filter: drop-shadow(0 12px 18px rgba(0, 0, 0, 0.45));
    cursor: pointer;
    z-index: 1;
  }
  .hero .noimg {
    color: var(--pv-muted);
    --mdc-icon-size: 96px;
  }

  /* gauges */
  .gauges {
    display: grid;
    gap: 10px;
    margin-top: 2px;
  }
  .gauge {
    cursor: pointer;
  }
  .gauge-top {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 5px;
  }
  .gauge-top ha-icon {
    --mdc-icon-size: 18px;
    position: relative;
    top: 3px;
  }
  .gauge .lbl {
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-text-color);
  }
  .gauge .sub {
    font-size: 12px;
    color: var(--pv-muted);
  }
  .gauge .spacer {
    flex: 1;
  }
  .gauge .val {
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .gauge .val small {
    font-size: 11px;
    font-weight: 600;
    color: var(--pv-muted);
    margin-left: 2px;
  }
  .track {
    position: relative;
    height: 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--primary-text-color) 10%, transparent);
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 999px;
    transition: width 0.9s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .fill.elec {
    background: linear-gradient(90deg, var(--pv-elec-2), var(--pv-elec));
    box-shadow: 0 0 14px -2px color-mix(in srgb, var(--pv-elec) 70%, transparent);
  }
  .fill.fuel {
    background: linear-gradient(90deg, var(--pv-fuel-2), var(--pv-fuel));
    box-shadow: 0 0 14px -2px color-mix(in srgb, var(--pv-fuel) 70%, transparent);
  }

  /* charging strip */
  .charge-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin: 12px 0 2px;
    padding: 9px 12px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, #38bdf8 30%, transparent);
    background: color-mix(in srgb, #38bdf8 8%, transparent);
    font-size: 12px;
  }
  .charge-strip .ci {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--primary-text-color);
  }
  .charge-strip .ci b {
    font-variant-numeric: tabular-nums;
  }
  .charge-strip .ci span {
    color: var(--pv-muted);
  }
  .charge-strip ha-icon {
    --mdc-icon-size: 15px;
    color: #38bdf8;
  }

  /* status row */
  .statuses {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 12px;
  }

  /* footer */
  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    padding-top: 11px;
    border-top: var(--pv-hair);
    font-size: 13px;
  }
  .footer .odo {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .footer .odo small {
    font-size: 11px;
    font-weight: 600;
    color: var(--pv-muted);
    margin-left: 3px;
  }
  .footer .spacer {
    flex: 1;
  }
  .footer .loc {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--pv-muted);
    font-weight: 600;
  }
  .footer .loc.home {
    color: var(--pv-good);
  }
  .footer .loc ha-icon {
    --mdc-icon-size: 16px;
  }
`;
