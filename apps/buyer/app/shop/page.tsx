"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@afrimart/api-client";
import { PageHeader, CartButton, FiltersIcon, ProductCard, ProductGlyph, Badge } from "@afrimart/ui";
import { glyphForCategory } from "../../lib/glyph";
import { useCart } from "../cart-context";
import { FiltersSheet } from "../../components/FiltersSheet";

/** Wraps the shop screen so useSearchParams() (reading ?cuisine= from the home cuisine grid) has the Suspense boundary Next requires. */
export default function ShopPage() {
  return (
    <Suspense fallback={null}>
      <ShopScreen />
    </Suspense>
  );
}

function ShopScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { count } = useCart();

  const [activeChip, setActiveChip] = useState("All");
  const [selectedCuisines, setSelectedCuisines] = useState<Set<string>>(new Set());
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const cuisine = searchParams.get("cuisine");
    if (cuisine) setSelectedCuisines(new Set([cuisine]));
  }, [searchParams]);

  const facets = trpc.catalogue.facets.useQuery();
  const browse = trpc.catalogue.browse.useQuery({
    categories: activeChip === "All" ? undefined : [activeChip],
    cuisines: selectedCuisines.size ? Array.from(selectedCuisines) : undefined,
    verifiedOnly: verifiedOnly || undefined,
  });

  const chips = useMemo(() => ["All", ...(facets.data?.categories.map((c) => c.name) ?? [])], [facets.data]);
  const filterCount = selectedCuisines.size + (verifiedOnly ? 1 : 0);

  function toggleCuisine(name: string) {
    setSelectedCuisines((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  return (
    <>
      <PageHeader eyebrow="Shop" title="Everyday staples" right={<CartButton count={count} />} />

      <div className="searchrow">
        <button type="button" className="sbar" style={{ textAlign: "left" }} onClick={() => router.push("/search")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" strokeLinecap="round" />
          </svg>
          <span style={{ color: "var(--ink-3)" }}>Search garri, egusi, palm oil…</span>
        </button>
        <button type="button" className="filterbtn" onClick={() => setFiltersOpen(true)}>
          <FiltersIcon /> Filters
          {filterCount > 0 && <span className="fc">{filterCount}</span>}
        </button>
      </div>

      <div className="chips">
        {chips.map((chip) => (
          <button key={chip} type="button" className={`chip${chip === activeChip ? " on" : ""}`} onClick={() => setActiveChip(chip)}>
            {chip}
          </button>
        ))}
      </div>

      <div className="countline">
        <b>{browse.data?.length ?? 0}</b> staples, freshly stocked
      </div>

      <div className="grid">
        {browse.data?.length === 0 && (
          <div style={{ gridColumn: "1/-1", textAlign: "center", color: "var(--ink-3)", padding: "30px 0", fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17 }}>
            No staples match those filters.
          </div>
        )}
        {browse.data?.map((p) => (
          <ProductCard
            key={p.listingId}
            variant="browse"
            name={p.name}
            altNames={p.altNames}
            sellerName={p.sellerName}
            verified={p.sellerVerified}
            shippingNote={p.shippingDays}
            priceLabel={`$${(p.priceCents / 100).toFixed(2)}`}
            unitLabel={p.unitLabel}
            flag={p.freshnessGuarantee ? <Badge kind="fresh">Fresh</Badge> : undefined}
            image={<ProductGlyph kind={glyphForCategory(p.category)} />}
            onOpen={() => router.push(`/product/${p.listingId}`)}
          />
        ))}
      </div>
      <div style={{ height: 16 }} />

      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        cuisines={facets.data?.cuisines ?? []}
        categories={facets.data?.categories ?? []}
        selectedCuisines={selectedCuisines}
        selectedCategories={new Set(activeChip === "All" ? [] : [activeChip])}
        verifiedOnly={verifiedOnly}
        onToggleCuisine={toggleCuisine}
        onToggleCategory={(name) => setActiveChip((prev) => (prev === name ? "All" : name))}
        onToggleVerified={() => setVerifiedOnly((v) => !v)}
        onClear={() => {
          setSelectedCuisines(new Set());
          setVerifiedOnly(false);
          setActiveChip("All");
        }}
        onApply={() => {}}
      />
    </>
  );
}
