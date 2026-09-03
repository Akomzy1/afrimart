import type { ButtonHTMLAttributes } from "react";
import { CartIcon } from "../icons";

export interface CartButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  count: number;
}

export function CartButton({ count, ...props }: CartButtonProps) {
  return (
    <button type="button" className="iconbtn" aria-label="Cart" {...props}>
      <CartIcon />
      {count > 0 && <span className="dot">{count}</span>}
    </button>
  );
}
