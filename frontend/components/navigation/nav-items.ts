import type { ComponentType } from "react";
import {
  IconHome,
  IconHomeFilled,
  IconSearch,
  IconSearchFilled,
  IconSettings,
  IconSettingsFilled,
  IconUser,
  IconUserFilled,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
  activeIcon: ComponentType<IconProps>;
  inBottomNav: boolean;
};

export const navItems: NavItem[] = [
  { href: "/", label: "Home", icon: IconHome, activeIcon: IconHomeFilled, inBottomNav: true },
  {
    href: "/search",
    label: "Search",
    icon: IconSearch,
    activeIcon: IconSearchFilled,
    inBottomNav: true,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: IconSettings,
    activeIcon: IconSettingsFilled,
    inBottomNav: false,
  },
  {
    href: "/profile",
    label: "Profile",
    icon: IconUser,
    activeIcon: IconUserFilled,
    inBottomNav: true,
  },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
