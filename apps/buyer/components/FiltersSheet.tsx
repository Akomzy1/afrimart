"use client";

import { SlideOver, FilterCheck, Button } from "@afrimart/ui";

export interface FacetOption {
  name: string;
  count: number;
}

export interface FiltersSheetProps {
  open: boolean;
  onClose: () => void;
  cuisines: FacetOption[];
  categories: FacetOption[];
  selectedCuisines: Set<string>;
  selectedCategories: Set<string>;
  verifiedOnly: boolean;
  onToggleCuisine: (name: string) => void;
  onToggleCategory: (name: string) => void;
  onToggleVerified: () => void;
  onClear: () => void;
  onApply: () => void;
}

/** The filters slide-over on the shop screen (AfriMart Buyer - Browse and Product.html). */
export function FiltersSheet({
  open,
  onClose,
  cuisines,
  categories,
  selectedCuisines,
  selectedCategories,
  verifiedOnly,
  onToggleCuisine,
  onToggleCategory,
  onToggleVerified,
  onClear,
  onApply,
}: FiltersSheetProps) {
  return (
    <SlideOver
      open={open}
      title="Filters"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="clear" onClick={onClear}>
            Clear
          </button>
          <Button
            variant="primary"
            className="apply"
            style={{ flex: 1, height: 50, borderRadius: "var(--r-sm)" }}
            onClick={() => {
              onApply();
              onClose();
            }}
          >
            Show results
          </Button>
        </>
      }
    >
      <div className="fgroup">
        <div className="gt">Cuisine</div>
        {cuisines.map((c) => (
          <FilterCheck key={c.name} label={c.name} count={c.count} checked={selectedCuisines.has(c.name)} onChange={() => onToggleCuisine(c.name)} />
        ))}
      </div>
      <div className="fgroup">
        <div className="gt">Category</div>
        {categories.map((c) => (
          <FilterCheck key={c.name} label={c.name} count={c.count} checked={selectedCategories.has(c.name)} onChange={() => onToggleCategory(c.name)} />
        ))}
      </div>
      <div className="fgroup" style={{ borderBottom: 0 }}>
        <div className="gt">Seller</div>
        <FilterCheck label="Verified sellers only" checked={verifiedOnly} onChange={onToggleVerified} />
      </div>
    </SlideOver>
  );
}
