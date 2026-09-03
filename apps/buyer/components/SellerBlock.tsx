import { SealIcon, Stars } from "@afrimart/ui";

export interface SellerBlockProps {
  sellerName: string;
  verified: boolean;
  rating: number;
  metro: string;
}

/** "Sold by" block on product detail. */
export function SellerBlock({ sellerName, verified, rating, metro }: SellerBlockProps) {
  return (
    <div className="block">
      <div className="bt">Sold by</div>
      <div className="seller-b">
        <div className="av">{sellerName[0]}</div>
        <div className="m">
          <div className="nm">
            {sellerName}
            {verified && <SealIcon className="seal" />}
          </div>
          <div className="sub">
            <Stars value={rating} /> {rating.toFixed(1)} · {metro}
          </div>
        </div>
        <span className="visit">Visit store</span>
      </div>
    </div>
  );
}
