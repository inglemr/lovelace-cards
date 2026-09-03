import { css } from "lit";

export const styles = css`
  :host {
    --pv-radius: var(--hl-r-card);
    --pv-elec: #34d399;
    --pv-elec-2: #10b981;
    --pv-fuel: #fbbf24;
    --pv-fuel-2: #f59e0b;
    --pv-accent: #f5b301;
    --pv-blue: #38bdf8;
    --pv-good: #34d399;
    --pv-alert: #f87171;
    --pv-grey: #6b7280;
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
    box-shadow: var(--hl-e1);
  }

  /* header */
  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
  .title { font-size: 20px; font-weight: 700; letter-spacing: 0.2px; line-height: 1; }
  .title .brand { color: var(--pv-accent); margin-right: 6px; }
  .header .spacer { flex: 1; }

  .pill {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 12px; font-weight: 600; padding: 4px 9px;
    border-radius: 999px; border: var(--pv-hair); color: var(--pv-muted);
    background: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
    white-space: nowrap; cursor: default;
  }
  .pill ha-icon { --mdc-icon-size: 15px; }
  .pill.good { color: var(--pv-good); border-color: color-mix(in srgb, var(--pv-good) 40%, transparent); background: color-mix(in srgb, var(--pv-good) 12%, transparent); }
  .pill.alert { color: var(--pv-alert); border-color: color-mix(in srgb, var(--pv-alert) 45%, transparent); background: color-mix(in srgb, var(--pv-alert) 12%, transparent); }
  .pill.info { color: var(--pv-blue); border-color: color-mix(in srgb, var(--pv-blue) 45%, transparent); background: color-mix(in srgb, var(--pv-blue) 12%, transparent); }
  .pill.charge { color: var(--pv-blue); border-color: color-mix(in srgb, var(--pv-blue) 45%, transparent); background: color-mix(in srgb, var(--pv-blue) 12%, transparent); }
  .pill.charge ha-icon { animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

  /* hero image */
  .hero { position: relative; display: flex; justify-content: center; align-items: center; height: 128px; margin: 2px 0 6px; }
  .hero::before { content: ""; position: absolute; left: 50%; top: 62%; width: 76%; height: 38px; transform: translate(-50%, 0); background: radial-gradient(closest-side, rgba(0,0,0,.5), transparent 78%); filter: blur(4px); }
  .hero img { max-height: 128px; max-width: 100%; object-fit: contain; filter: drop-shadow(0 12px 18px rgba(0,0,0,.45)); cursor: pointer; z-index: 1; }
  .hero .noimg { color: var(--pv-muted); --mdc-icon-size: 92px; }

  /* gauges */
  .gauges { display: grid; gap: 10px; }
  .gauge { cursor: pointer; }
  .gauge-top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
  .gauge-top ha-icon { --mdc-icon-size: 18px; position: relative; top: 3px; }
  .gauge .lbl { font-size: 13px; font-weight: 600; color: var(--primary-text-color); }
  .gauge .sub { font-size: 12px; color: var(--pv-muted); }
  .gauge .spacer { flex: 1; }
  .gauge .val { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .gauge .val small { font-size: 11px; font-weight: 600; color: var(--pv-muted); margin-left: 2px; }
  .track { position: relative; height: 12px; border-radius: 999px; background: color-mix(in srgb, var(--primary-text-color) 10%, transparent); overflow: hidden; }
  .fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; transform-origin: left center; transition: width 0.9s var(--hl-settle); animation: hl-grow-x var(--hl-d3) var(--hl-settle) both; }
  .fill.elec { background: linear-gradient(90deg, var(--pv-elec-2), var(--pv-elec)); box-shadow: 0 0 14px -2px color-mix(in srgb, var(--pv-elec) 70%, transparent); }
  .fill.fuel { background: linear-gradient(90deg, var(--pv-fuel-2), var(--pv-fuel)); box-shadow: 0 0 14px -2px color-mix(in srgb, var(--pv-fuel) 70%, transparent); }

  /* live charging strip (only while charging) */
  .charge-strip { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 12px 0 2px; padding: 9px 12px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--pv-blue) 30%, transparent); background: color-mix(in srgb, var(--pv-blue) 8%, transparent); font-size: 12px; }
  .charge-strip .ci { display: inline-flex; align-items: center; gap: 5px; color: var(--primary-text-color); }
  .charge-strip .ci b { font-variant-numeric: tabular-nums; }
  .charge-strip .ci span { color: var(--pv-muted); }
  .charge-strip ha-icon { --mdc-icon-size: 15px; color: var(--pv-blue); }

  /* tab bar */
  .tabs { display: flex; gap: 4px; margin: 14px 0 12px; padding: 4px; border-radius: 14px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 4px; border-radius: 10px; font-size: 12.5px; font-weight: 600; color: var(--pv-muted); cursor: pointer; user-select: none; transition: background 0.18s, color 0.18s; }
  .tab ha-icon { --mdc-icon-size: 17px; }
  .tab:hover { color: var(--primary-text-color); }
  .tab.active { color: var(--primary-text-color); background: var(--ha-card-background, var(--card-background-color, #1b1f27)); box-shadow: 0 4px 12px -6px rgba(0, 0, 0, 0.6); }
  .tab .txt { display: inline; }
  @media (max-width: 420px) { .tab .txt { display: none; } .tab { padding: 8px 4px; } }

  .tabpane { animation: fade 0.22s ease; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

  /* status chips row */
  .statuses { display: flex; flex-wrap: wrap; gap: 7px; }

  /* stat grid (charging / trips) */
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .stat { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; border: var(--pv-hair); background: color-mix(in srgb, var(--primary-text-color) 4%, transparent); }
  .stat.wide { grid-column: 1 / -1; }
  .stat ha-icon { --mdc-icon-size: 20px; flex: 0 0 auto; }
  .stat .k { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; color: var(--pv-muted); line-height: 1.3; }
  .stat .v { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.2; }
  .stat .v small { font-size: 11px; font-weight: 600; color: var(--pv-muted); margin-left: 3px; }

  /* tyre diagram */
  .tyre-wrap { display: flex; justify-content: center; padding: 2px 0 4px; }
  .tyre-svg { width: 100%; max-width: 320px; height: auto; }
  .tyre-body { fill: color-mix(in srgb, var(--primary-text-color) 8%, transparent); stroke: color-mix(in srgb, var(--primary-text-color) 16%, transparent); stroke-width: 1.5; }
  .tyre-glass { fill: color-mix(in srgb, var(--primary-text-color) 12%, transparent); }
  .tyre { rx: 5; }
  .tyre-p { font-size: 15px; font-weight: 700; fill: var(--primary-text-color); }
  .tyre-p tspan.u { font-size: 9px; fill: var(--pv-muted); }
  .tyre-d { font-size: 10px; font-weight: 600; }

  /* history graph */
  .graph-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .legend { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--pv-muted); font-weight: 600; }
  .legend .dot { width: 9px; height: 9px; border-radius: 999px; }
  .graph-head .spacer { flex: 1; }
  .range-toggle { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .range-toggle .r { padding: 4px 9px; border-radius: 7px; font-size: 11.5px; font-weight: 600; color: var(--pv-muted); cursor: pointer; }
  .range-toggle .r.active { color: var(--primary-text-color); background: var(--ha-card-background, var(--card-background-color, #1b1f27)); }
  .graph { position: relative; width: 100%; height: 132px; }
  .graph .gpt { position: absolute; right: 3px; transform: translateY(-50%); font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums; padding: 0 3px; border-radius: 5px; background: color-mix(in srgb, var(--card-background-color, #111318) 70%, transparent); pointer-events: none; z-index: 1; }
  .graph .gpt.elec { color: var(--pv-elec); }
  .graph .gpt.fuel { color: var(--pv-fuel); }
  .graph svg { width: 100%; height: 100%; overflow: visible; }
  .graph path.line { stroke-dasharray: 1; stroke-dashoffset: 0; animation: hl-draw var(--hl-d4) var(--hl-settle) both; }
  .graph path.area { animation: hl-fade var(--hl-d3) var(--hl-settle) both; }
  .graph .grid { stroke: color-mix(in srgb, var(--primary-text-color) 10%, transparent); stroke-width: 1; stroke-dasharray: 3 4; }
  .graph .axis { font-size: 9px; fill: var(--pv-muted); }
  .graph .empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--pv-muted); font-size: 13px; }

  /* footer */
  .footer { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding-top: 11px; border-top: var(--pv-hair); font-size: 13px; }
  .footer .odo { font-weight: 700; font-variant-numeric: tabular-nums; cursor: pointer; }
  .footer .odo small { font-size: 11px; font-weight: 600; color: var(--pv-muted); margin-left: 3px; }
  .footer .spacer { flex: 1; }
  .footer .fresh { font-size: 11px; color: var(--pv-muted); }
  .footer .loc { display: inline-flex; align-items: center; gap: 5px; color: var(--pv-muted); font-weight: 600; cursor: pointer; }
  .footer .loc.home { color: var(--pv-good); }
  .footer .loc ha-icon { --mdc-icon-size: 16px; }
`;
