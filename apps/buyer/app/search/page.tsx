"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@afrimart/api-client";
import { PageHeader, ProductCard, ProductGlyph, Badge, SearchIcon, SparkleIcon } from "@afrimart/ui";
import { glyphForCategory } from "../../lib/glyph";

/** AfriMart Buyer - Browse and Product.html's Search Results view — SRCH-1, resolves any name/spelling. */
export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const search = trpc.catalogue.search.useQuery({ query }, { enabled: query.trim().length > 0 });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <>
      <PageHeader back="/shop" eyebrow="Search" title="The market" />
      <div className="searchrow" style={{ paddingTop: 2 }}>
        <div className="sbar">
          <SearchIcon />
          <input
            ref={inputRef}
            placeholder="Search the market…"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {!query.trim() && (
        <div className="countline" style={{ fontSize: 15 }}>
          Search by name in any language — <b>garri</b>, <b>gari</b>, <b>berbere</b>.
        </div>
      )}

      {query.trim() && search.data?.hit && (
        <>
          <div className="resolved">
            Showing <b>{search.data.hit.name.toLowerCase()}</b>
            {search.data.matchedAliases?.length ? `, also known as ${search.data.matchedAliases.join(", ")}` : ""}
          </div>
          <div className="grid">
            {search.data.related.map((p) => (
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
        </>
      )}

      {query.trim() && search.data && !search.data.hit && (
        <div className="zero">
          <div className="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4M9 11h4" strokeLinecap="round" />
            </svg>
          </div>
          <h3 className="serif">We couldn&apos;t find &quot;{query}&quot;</h3>
          <p>The name may be spelled differently. Try the Cook agent — it can often place an unfamiliar name for you.</p>
          {/* AGT-1: the Cook agent is optional, additive here — search itself never depends on it. Cook ships in Prompt 4. */}
          <button type="button" className="ai" onClick={() => router.push("/cook")}>
            <SparkleIcon /> Ask our AI to find it
          </button>
        </div>
      )}
      <div style={{ height: 16 }} />
    </>
  );
}
