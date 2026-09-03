import { CookPotIcon, ArrowRightIcon } from "@afrimart/ui";

export interface UsedInKitchenProps {
  description: string;
  onCook: () => void;
}

/**
 * "How it's used" + Cook agent CTA. AGT-1: the Cook agent is optional and
 * additive here — this button never gates viewing or buying the product.
 * The Cook surface itself is Prompt 4.
 */
export function UsedInKitchen({ description, onCook }: UsedInKitchenProps) {
  return (
    <div className="used">
      <p className="eyebrow q" style={{ marginBottom: 8 }}>
        How it&apos;s used
      </p>
      <h3 className="serif">In the kitchen</h3>
      <p>{description}</p>
      <button type="button" className="cook" onClick={onCook}>
        <span className="l">
          <CookPotIcon /> Cook this with our AI agent
        </span>
        <ArrowRightIcon />
      </button>
    </div>
  );
}
