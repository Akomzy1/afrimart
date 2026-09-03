import { StarIcon } from "../icons";

export interface StarsProps {
  /** 0-5, may be fractional; rendered to the nearest whole star per the prototype. */
  value: number;
}

/** Bare 5-star row, no count — used inline in seller blocks and review items. */
export function Stars({ value }: StarsProps) {
  const filled = Math.round(value);
  return (
    <span className="stars">
      {Array.from({ length: 5 }, (_, i) => (
        <StarIcon
          key={i}
          fill={i < filled ? "currentColor" : "none"}
          stroke={i < filled ? "none" : "currentColor"}
          strokeWidth={i < filled ? 0 : 1.5}
        />
      ))}
    </span>
  );
}

export interface RatingStarsProps {
  value: number;
  count: number;
}

/** Stars plus "4.8 · 214 reviews" — the product/search-card rating summary. */
export function RatingStars({ value, count }: RatingStarsProps) {
  return (
    <span className="rating">
      <Stars value={value} />
      <span className="cnt">
        {value.toFixed(1)} · {count} reviews
      </span>
    </span>
  );
}
