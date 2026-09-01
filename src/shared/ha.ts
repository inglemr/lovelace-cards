import type { HomeAssistant } from "custom-card-helpers";

export type { HomeAssistant };

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

const UNKNOWN = new Set(["unknown", "unavailable", "none", "null", "", "undefined"]);

/** True when an entity id is missing or its state is a non-value. */
export function isUnknown(hass: HomeAssistant | undefined, entityId?: string): boolean {
  if (!hass || !entityId) return true;
  const s = hass.states[entityId];
  if (!s) return true;
  return UNKNOWN.has(String(s.state).toLowerCase());
}

/** Raw state string, or undefined if unknown/missing. */
export function stateStr(hass: HomeAssistant | undefined, entityId?: string): string | undefined {
  if (isUnknown(hass, entityId)) return undefined;
  return hass!.states[entityId!].state;
}

/** Numeric state, or undefined if not a finite number. */
export function stateNum(hass: HomeAssistant | undefined, entityId?: string): number | undefined {
  const s = stateStr(hass, entityId);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** An entity attribute, or undefined. */
export function attr(hass: HomeAssistant | undefined, entityId: string | undefined, name: string): any {
  if (!hass || !entityId) return undefined;
  return hass.states[entityId]?.attributes?.[name];
}

/** unit_of_measurement for an entity. */
export function unit(hass: HomeAssistant | undefined, entityId?: string): string {
  return attr(hass, entityId, "unit_of_measurement") ?? "";
}

/** Absolute URL for an entity's picture (image/camera/person), token included. */
export function entityPicture(hass: HomeAssistant | undefined, entityId?: string): string | undefined {
  return attr(hass, entityId, "entity_picture");
}

/** Fire a hass-more-info dialog for an entity. */
export function moreInfo(node: HTMLElement, entityId: string): void {
  node.dispatchEvent(
    new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
  );
}

/** Clamp a number to [0, 100]. */
export function pct(n: number | undefined): number {
  if (n === undefined) return 0;
  return Math.max(0, Math.min(100, n));
}
