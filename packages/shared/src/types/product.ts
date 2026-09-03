import type { ID, TemperatureClass, Timestamps } from "./common";

/** PRD CAT-2 — languages the knowledge graph resolves alternate names from. */
export type AliasLanguage =
  | "yoruba"
  | "igbo"
  | "twi"
  | "amharic"
  | "swahili"
  | "french"
  | "phonetic-english"
  | "other";

/** A product in the master registry. PRD 9: CanonicalProduct / CAT-1. */
export interface CanonicalProduct extends Timestamps {
  id: ID;
  canonicalName: string;
  category: string;
  cuisine: string;
  packSize: string;
  images: string[];
  temperatureClass: TemperatureClass;
  shippingWeightOz: number;
}

/** An alternate name/spelling/language mapped to a CanonicalProduct. PRD CAT-2. */
export interface NameAlias {
  id: ID;
  canonicalProductId: ID;
  alias: string;
  language: AliasLanguage;
  /** Confidence from entity resolution (CAT-3); below threshold routes to manual review (CAT-6). */
  confidence: number;
}
