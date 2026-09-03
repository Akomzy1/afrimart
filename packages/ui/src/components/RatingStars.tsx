import { StarIcon } from "../icons";

export interface RatingStarsProps {
  /** 0-5, may be fractional; rendered to the nearest whole star per the prototype. */
  value: number;
  count: number;
}

export function RatingStars({ value, count }: RatingStarsProps) {
  const filled = Math.round(value);
  return (
    <span className="rating">
      {Array.from({ length: 5 }, (_, i) => (
        <StarIcon key={i} fill={i < filled ? "currentColor" : "none"} stroke={i < filled ? "none" : "currentColor"} strokeWidth={i < filled ? 0 : 1.5} />
      ))}
      <span className="cnt">
        {value.toFixed(1)} · {count} reviews
      </span>
    </span>
  );
}
