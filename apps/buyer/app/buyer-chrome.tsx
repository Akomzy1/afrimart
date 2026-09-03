"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TabBar, TabBarItem, HomeIcon, ShopBagIcon, CookPotIcon, OrdersIcon, AccountIcon } from "@afrimart/ui";

const tabs = [
  { href: "/", label: "Home", icon: <HomeIcon /> },
  { href: "/shop", label: "Shop", icon: <ShopBagIcon /> },
  { href: "/cook", label: "Cook", icon: <CookPotIcon /> },
  { href: "/orders", label: "Orders", icon: <OrdersIcon /> },
  { href: "/account", label: "Account", icon: <AccountIcon /> },
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
