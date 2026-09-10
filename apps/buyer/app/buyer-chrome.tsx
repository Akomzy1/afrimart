"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  TabBar,
  TabBarItem,
  DesktopNav,
  DesktopNavLink,
  HomeIcon,
  ShopBagIcon,
  CookPotIcon,
  OrdersIcon,
  AccountIcon,
} from "@afrimart/ui";
import { useCart } from "./cart-context";

const tabs = [
  { href: "/", label: "Home", icon: <HomeIcon /> },
  { href: "/shop", label: "Shop", icon: <ShopBagIcon /> },
  { href: "/cook", label: "Cook", icon: <CookPotIcon /> },
  { href: "/orders", label: "Orders", icon: <OrdersIcon /> },
  { href: "/account", label: "Account", icon: <AccountIcon /> },
];

/**
 * The prototype's desktop links, minus Boxes: Taste of Home is PRD SUB-1
 * (Phase 2) and deliberately unbuilt, so a nav entry pointing at /orders as a
 * stand-in would promise a screen that isn't there. Account replaces it — a
 * Phase 1 screen the mobile tab bar already carries.
 */
const desktopLinks = [
  { href: "/shop", label: "Shop", match: "/shop" },
  { href: "/cook", label: "Cook", match: "/cook" },
  { href: "/orders", label: "Orders", match: "/orders" },
  { href: "/account", label: "Account", match: "/account" },
];

/** Hidden on full-bleed screens (product detail, search) — matches every prototype page's `go()` logic. */
const HIDE_ON_PREFIXES = ["/product", "/search"];

export function BuyerChrome() {
  const pathname = usePathname();
  const hidden = HIDE_ON_PREFIXES.some((p) => pathname.startsWith(p));

  return (
    <TabBar hidden={hidden}>
      {tabs.map((tab) => (
        <TabBarItem key={tab.href} as={Link} href={tab.href} active={pathname === tab.href} icon={tab.icon} label={tab.label} />
      ))}
    </TabBar>
  );
}

/** Desktop-only chrome — rendered above the scroll area, unlike the tab bar. */
export function BuyerDesktopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { count } = useCart();

  return (
    <DesktopNav
      as={Link}
      cartCount={count}
      cartHref="/cart"
      onSearch={(q) => router.push(`/search?q=${encodeURIComponent(q)}`)}
    >
      {desktopLinks.map((link) => (
        <DesktopNavLink key={link.label} as={Link} href={link.href} active={pathname === link.match}>
          {link.label}
        </DesktopNavLink>
      ))}
    </DesktopNav>
  );
}
