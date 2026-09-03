import type { ID, Timestamps } from "./common";

export interface Address {
  id: ID;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  isDefault: boolean;
}

/** A customer. PRD 9: Buyer. */
export interface Buyer extends Timestamps {
  id: ID;
  email: string;
  phone?: string;
  addresses: Address[];
}
