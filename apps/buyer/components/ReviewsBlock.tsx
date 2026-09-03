import { Stars } from "@afrimart/ui";
import type { ReviewData } from "@afrimart/shared";

export interface ReviewsBlockProps {
  rating: number;
  reviewCount: number;
  reviews: ReviewData[];
}

export function ReviewsBlock({ rating, reviewCount, reviews }: ReviewsBlockProps) {
  return (
    <div className="rev">
      <div className="head">
        <div className="big">
          {rating.toFixed(1)} <span className="o">{<Stars value={rating} />}</span>
        </div>
        <div className="cnt">{reviewCount} reviews</div>
      </div>
      {reviews.map((r, i) => (
        <div className="item" key={i}>
          <div className="top">
            <div className="av">{r.buyerName[0]}</div>
            <div className="who">{r.buyerName}</div>
            <Stars value={r.rating} />
          </div>
          <p>{r.comment}</p>
        </div>
      ))}
    </div>
  );
}
