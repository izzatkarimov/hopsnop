import type { ComponentType, SVGProps } from "react";
import {
  ExploreIcon,
  HomeIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/ui/icons";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Whether the item appears in the mobile bottom bar. */
  inBottomNav: boolean;
};

export const navItems: NavItem[] = [
  { href: "/", label: "Home", icon: HomeIcon, inBottomNav: true },
  { href: "/explore", label: "Explore", icon: ExploreIcon, inBottomNav: true },
  { href: "/profile", label: "Profile", icon: UserIcon, inBottomNav: true },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    inBottomNav: false,
  },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
