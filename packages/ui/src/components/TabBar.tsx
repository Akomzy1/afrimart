import type { AnchorHTMLAttributes, ElementType, ReactNode } from "react";

export interface TabBarProps {
  children: ReactNode;
  /** Hide entirely on full-bleed screens (product detail, search) — matches every prototype page. */
  hidden?: boolean;
}

export function TabBar({ children, hidden }: TabBarProps) {
  return <nav className={`tabbar${hidden ? " hide" : ""}`}>{children}</nav>;
}

export interface TabBarItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  active?: boolean;
  icon: ReactNode;
  label: string;
  /** Pass Next's Link (or any anchor-compatible component) to get client-side navigation. Defaults to a plain `<a>`. */
  as?: ElementType;
}

/** One tab — Home/Shop/Cook/Orders/Account (buyer) or Camera/Orders/Messages (merchant). */
export function TabBarItem({ active, icon, label, as: Comp = "a", ...props }: TabBarItemProps) {
  return (
    <Comp className={`tab${active ? " on" : ""}`} {...props}>
      <span className="pip" />
      {icon}
      <span className="t">{label}</span>
    </Comp>
  );
}
