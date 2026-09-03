import type { ID, Timestamps } from "./common";

/** A supply metro anchoring a set of Stores for shipping origination. PRD 9: HubMetro. */
export interface HubMetro extends Timestamps {
  id: ID;
  name: string;
  state: string;
  active: boolean;
}
