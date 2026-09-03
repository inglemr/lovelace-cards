// Single entry point — importing a card registers its custom element(s).
// HACS installs the built bundle (homelab-cards.js) which provides all of these.
import "./cards/phev-vehicle-card";
import "./cards/pet-card";
import "./cards/pet-activity-card";
import "./cards/action-button-card";
import "./cards/battery-fleet-card";
import "./cards/needs-attention-card";
import "./cards/laundry-tracker-card";
import "./cards/vacuum-card";
import "./cards/feeder-card";
import "./cards/room-card";
import "./cards/presence-card";
import "./cards/litter-card";
import "./cards/nowplaying-card";
import "./cards/security-card";
import "./cards/hearth-tile";
import "./cards/camera-frame";
import "./cards/agenda-card";

const VERSION = "0.21.0";
// eslint-disable-next-line no-console
console.info(
  `%c HOMELAB-LOVELACE-CARDS %c v${VERSION} `,
  "color:#0b1220;background:#f5b301;font-weight:700;border-radius:4px 0 0 4px;padding:2px 6px",
  "color:#f5b301;background:#0b1220;font-weight:700;border-radius:0 4px 4px 0;padding:2px 6px"
);
