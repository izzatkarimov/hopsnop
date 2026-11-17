import type { SVGProps } from "react";

/* Decorative: the surrounding control provides the accessible name. */

export type IconProps = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  size?: number;
};

export function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      // Drawn 2px wide from 20px up and 1.5px below, at any size.
      strokeWidth={((size >= 20 ? 2 : 1.5) * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 18.8V16C10 14.895 10.895 14 12 14C13.105 14 14 14.895 14 16V18.8C14 19.463 14.537 20 15.2 20H17.6C18.925 20 20 18.925 20 17.6V10.089C20 9.397 19.701 8.739 19.18 8.283L13.58 3.383C12.676 2.591 11.324 2.591 10.42 3.383L4.82 8.283C4.299 8.739 4 9.397 4 10.089V17.6C4 18.925 5.075 20 6.4 20H8.8C9.463 20 10 19.463 10 18.8Z" />
    </Icon>
  );
}

export function IconHomeFilled(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        fill="currentColor"
        stroke="none"
        d="M13.976 2.4C12.844 1.41 11.156 1.41 10.024 2.4L4.024 7.65C3.373 8.219 3 9.042 3 9.908V18C3 19.657 4.343 21 6 21H8C9.105 21 10 20.105 10 19V16C10 14.895 10.895 14 12 14C13.105 14 14 14.895 14 16V19C14 20.105 14.895 21 16 21H18C19.657 21 21 19.657 21 18V9.908C21 9.042 20.627 8.219 19.976 7.65L13.976 2.4Z"
      />
    </Icon>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 11C18 14.866 14.866 18 11 18C7.134 18 4 14.866 4 11C4 7.134 7.134 4 11 4C14.866 4 18 7.134 18 11Z" />
      <path d="M20 20L16.05 16.05" />
    </Icon>
  );
}

export function IconSearchFilled(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        fill="currentColor"
        stroke="none"
        d="M11 15C13.209 15 15 13.209 15 11C15 8.791 13.209 7 11 7C8.791 7 7 8.791 7 11C7 13.209 8.791 15 11 15Z"
      />
      <path
        fill="currentColor"
        stroke="none"
        fillRule="evenodd"
        d="M11 5C7.686 5 5 7.686 5 11C5 14.314 7.686 17 11 17C14.314 17 17 14.314 17 11C17 7.686 14.314 5 11 5ZM3 11C3 6.582 6.582 3 11 3C15.418 3 19 6.582 19 11C19 12.849 18.373 14.551 17.32 15.906L20.707 19.293C21.098 19.683 21.098 20.317 20.707 20.707C20.317 21.098 19.683 21.098 19.293 20.707L15.906 17.32C14.551 18.373 12.849 19 11 19C6.582 19 3 15.418 3 11Z"
      />
    </Icon>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8.67L4 15.33C4 16.053 4.39 16.719 5.02 17.074L11.019 20.448C11.628 20.791 12.372 20.791 12.98 20.448L18.981 17.073C19.61 16.719 20 16.053 20 15.33V8.67C20 7.947 19.61 7.281 18.981 6.926L12.981 3.552C12.372 3.209 11.628 3.209 11.019 3.552L5.019 6.926C4.39 7.281 4 7.947 4 8.67Z" />
      <path d="M15 12C15 13.657 13.657 15 12 15C10.343 15 9 13.657 9 12C9 10.343 10.343 9 12 9C13.657 9 15 10.343 15 12Z" />
    </Icon>
  );
}

export function IconSettingsFilled(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        fill="currentColor"
        stroke="none"
        fillRule="evenodd"
        d="M3 8.67C3 7.586 3.585 6.586 4.529 6.055L10.529 2.68C11.442 2.167 12.558 2.167 13.471 2.68L19.471 6.055C20.415 6.586 21 7.586 21 8.67L21 15.33C21 16.414 20.415 17.414 19.471 17.945L13.471 21.32C12.558 21.834 11.442 21.834 10.529 21.32L4.529 17.946C3.585 17.414 3 16.415 3 15.331V8.67ZM8.5 12C8.5 10.067 10.067 8.5 12 8.5C13.933 8.5 15.5 10.067 15.5 12C15.5 13.933 13.933 15.5 12 15.5C10.067 15.5 8.5 13.933 8.5 12Z"
      />
    </Icon>
  );
}

export function IconUser(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 12C8.191 12 5.822 14.496 5.038 17.623C4.716 18.909 5.825 20 7.15 20H16.85C18.175 20 19.284 18.909 18.962 17.623C18.178 14.496 15.809 12 12 12Z" />
      <circle cx="12" cy="7.75" r="4.25" />
    </Icon>
  );
}

export function IconUserFilled(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        fill="currentColor"
        stroke="none"
        d="M16.224 12.122C18.266 13.357 19.55 15.478 20.03 17.811C20.409 19.655 18.834 21 17.25 21H6.75C5.165 21 3.591 19.655 3.969 17.811C4.449 15.478 5.733 13.357 7.774 12.122C8.906 13.105 10.383 13.7 12 13.7C13.616 13.7 15.092 13.104 16.224 12.122Z"
      />
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2.5C14.623 2.5 16.75 4.627 16.75 7.25C16.75 9.873 14.623 12 12 12C9.376 12 7.25 9.873 7.25 7.25C7.25 4.627 9.376 2.5 12 2.5Z"
      />
    </Icon>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5.5V12M12 12V18.5M12 12H5.5M12 12H18.5" />
    </Icon>
  );
}

export function IconEye(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 12C15 13.657 13.657 15 12 15C10.343 15 9 13.657 9 12C9 10.343 10.343 9 12 9C13.657 9 15 10.343 15 12Z" />
      <path d="M21.497 11.095C16.66 2.968 7.34 2.968 2.503 11.095C2.171 11.652 2.171 12.348 2.503 12.905C7.34 21.032 16.66 21.032 21.497 12.905C21.829 12.348 21.829 11.652 21.497 11.095Z" />
    </Icon>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12C5 10.895 5.895 10 7 10H17C18.105 10 19 10.895 19 12V19C19 20.105 18.105 21 17 21H7C5.895 21 5 20.105 5 19V12Z" />
      <path d="M16 9.5V7C16 4.791 14.209 3 12 3C9.791 3 8 4.791 8 7V9.5" />
      <path d="M12 14V17" />
    </Icon>
  );
}

export function IconMail(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M21 8.5L12.894 12.553C12.331 12.834 11.669 12.834 11.106 12.553L3 8.5" />
    </Icon>
  );
}

export function IconMailCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.288 8.644L11.105 12.553C11.669 12.834 12.331 12.834 12.894 12.553L20.447 8.776C20.786 8.607 21 8.261 21 7.882V7C21 5.895 20.105 5 19 5H5C3.895 5 3 5.895 3 7V17C3 18.105 3.895 19 5 19H11" />
      <path d="M22 14L18 19.5L16 17.5" />
    </Icon>
  );
}

export function IconShieldCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 7.177C20 6.323 19.458 5.564 18.65 5.286L12.65 3.224C12.229 3.079 11.771 3.079 11.35 3.223L5.35 5.286C4.542 5.564 4 6.323 4 7.177V11.912C4 16.885 8 19 12 21.158C16 19 20 16.885 20 11.912V7.177Z" />
      <path d="M9.5 11.75L11 13.25L14.5 9.75" />
    </Icon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 14.15L10.032 18L18 7" />
    </Icon>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 8V12L14.5 14.5M21 12C21 16.971 16.971 21 12 21C7.029 21 3 16.971 3 12C3 7.029 7.029 3 12 3C16.971 3 21 7.029 21 12Z" />
    </Icon>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 12C21 16.971 16.971 21 12 21C7.029 21 3 16.971 3 12C3 7.029 7.029 3 12 3C16.971 3 21 7.029 21 12Z" />
      <path d="M11 11H12V16" />
      <circle cx="12" cy="8" r="0.75" fill="currentColor" />
    </Icon>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 6L4 12L10 18" />
      <path d="M5 12H20" />
    </Icon>
  );
}

export function IconWarning(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.275 15.998L10.277 3.99C11.046 2.67 12.954 2.67 13.724 3.99L20.725 15.998C21.501 17.329 20.542 19 19.002 19H4.998C3.458 19 2.499 17.329 3.275 15.998Z" />
      <path d="M12 9.02V12.014" />
      <path d="M12 15H12.01" />
    </Icon>
  );
}

export function IconKey(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11.014 9.019A5 5 0 1 0 11.014 14.981Q11.371 14.5 11.908 14.5H14L16 13.5L18 14.5H20.019A1 1 0 0 0 20.8 14.124L22 12.624A1 1 0 0 0 22 11.376L20.8 9.876A1 1 0 0 0 20.019 9.5H11.908Q11.371 9.5 11.014 9.019Z" />
      <circle cx="7" cy="12" r="0.75" fill="currentColor" />
    </Icon>
  );
}

export function IconDoor(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 21H21" />
      <path d="M5 21V5C5 3.895 5.895 3 7 3H17C18.105 3 19 3.895 19 5V21" />
      <path d="M8 12H9" />
    </Icon>
  );
}

export function IconBubble(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.002 4H19.002C20.106 4 21.002 4.895 21.002 6V16C21.002 17.105 20.106 18 19.002 18H12.002L7.002 21V18H5.002C3.897 18 3.002 17.105 3.002 16V6C3.002 4.895 3.897 4 5.002 4Z" />
    </Icon>
  );
}

export function IconRepost(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 13V7C4 5.895 4.895 5 6 5H15" />
      <path d="M13 2L16 5L13 8" />
      <path d="M20 11V17C20 18.105 19.105 19 18 19H9" />
      <path d="M11 22L8 19L11 16" />
    </Icon>
  );
}

export function IconHeart(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 10C21 15.75 12.75 20 12 20C11.25 20 3 15.75 3 10C3 6 5.5 4 8 4C10.5 4 12 5.5 12 5.5C12 5.5 13.5 4 16 4C18.5 4 21 6 21 10Z" />
    </Icon>
  );
}

export function IconHeartFilled(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        fill="currentColor"
        stroke="none"
        d="M12.584 3.872C12.362 3.993 12.166 4.115 12 4.228C11.833 4.115 11.639 3.993 11.416 3.872C10.619 3.437 9.454 3 8 3C6.482 3 4.965 3.609 3.833 4.816C2.696 6.029 2 7.786 2 10C2 13.345 4.373 16.102 6.582 17.927C7.713 18.862 8.867 19.606 9.792 20.12C10.254 20.377 10.669 20.582 11.004 20.725C11.171 20.797 11.329 20.858 11.471 20.903C11.578 20.938 11.784 21 12 21C12.216 21 12.422 20.938 12.529 20.903C12.671 20.858 12.829 20.797 12.996 20.725C13.331 20.582 13.746 20.377 14.208 20.12C15.133 19.606 16.287 18.862 17.418 17.927C19.627 16.102 22 13.345 22 10C22 7.786 21.304 6.029 20.167 4.816C19.035 3.609 17.518 3 16 3C14.545 3 13.381 3.437 12.584 3.872Z"
      />
    </Icon>
  );
}

export function IconShare(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.619 10.861L21 4.554M9.047 10.904L4.101 5.688C3.496 5.051 3.948 4 4.826 4H20.251C21.025 4 21.505 4.84 21.113 5.507L13.19 18.976C12.743 19.736 11.603 19.588 11.365 18.739L9.285 11.322C9.241 11.166 9.159 11.022 9.047 10.904Z" />
    </Icon>
  );
}

export function IconMore(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 13C12.552 13 13 12.552 13 12C13 11.448 12.552 11 12 11C11.448 11 11 11.448 11 12C11 12.552 11.448 13 12 13Z" />
      <path d="M20 13C20.552 13 21 12.552 21 12C21 11.448 20.552 11 20 11C19.448 11 19 11.448 19 12C19 12.552 19.448 13 20 13Z" />
      <path d="M4 13C4.552 13 5 12.552 5 12C5 11.448 4.552 11 4 11C3.448 11 3 11.448 3 12C3 12.552 3.448 13 4 13Z" />
    </Icon>
  );
}

export function IconLink(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 18L10.914 20.086C10.133 20.867 8.867 20.867 8.086 20.086L3.914 15.914C3.133 15.133 3.133 13.867 3.914 13.086L6 11" />
      <path d="M11 6L13.086 3.914C13.867 3.133 15.133 3.133 15.914 3.914L20.086 8.085C20.867 8.867 20.867 10.133 20.086 10.914L18 13" />
      <path d="M9 15L15 9" />
    </Icon>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 9V4.25C15 3.56 14.44 3 13.75 3H4.25C3.56 3 3 3.56 3 4.25V13.75C3 14.44 3.56 15 4.25 15H9" />
      <path d="M19.75 9H10.25C9.56 9 9 9.56 9 10.25V19.75C9 20.44 9.56 21 10.25 21H19.75C20.44 21 21 20.44 21 19.75V10.25C21 9.56 20.44 9 19.75 9Z" />
    </Icon>
  );
}

export function IconPerson(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15.5 6.5C15.5 8.433 13.933 10 12 10C10.067 10 8.5 8.433 8.5 6.5C8.5 4.567 10.067 3 12 3C13.933 3 15.5 4.567 15.5 6.5Z" />
      <path d="M12.001 13C8.61 13 6.037 15.014 4.984 17.863C4.575 18.968 5.519 20 6.698 20H17.304C18.483 20 19.427 18.968 19.019 17.863C17.965 15.014 15.392 13 12.001 13Z" />
    </Icon>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18.414 3.914L20.086 5.586C20.867 6.367 20.867 7.633 20.086 8.414L18 10.5L7.793 20.707C7.605 20.895 7.351 21 7.086 21H3V16.914C3 16.649 3.105 16.395 3.293 16.207L13.5 6L15.586 3.914C16.367 3.133 17.633 3.133 18.414 3.914Z" />
      <path d="M13.5 6L18 10.5" />
    </Icon>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 6.5L5.872 19.138C5.944 20.186 6.816 21 7.867 21H16.133C17.184 21 18.056 20.186 18.128 19.138L19 6.5" />
      <path d="M10 11V16" />
      <path d="M14 11V16" />
      <path d="M3.5 6H20.5" />
      <path d="M8.071 5.746C8.423 3.897 10.048 2.5 12 2.5C13.951 2.5 15.576 3.897 15.929 5.746" />
    </Icon>
  );
}

/* Older icons, still used by screens that haven't moved to the ones above. */

type LegacyIconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: LegacyIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function TrashIcon(props: LegacyIconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Svg>
  );
}

export function CloseIcon(props: LegacyIconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function ChevronLeftIcon(props: LegacyIconProps) {
  return (
    <Svg {...props}>
      <path d="m15 5-7 7 7 7" />
    </Svg>
  );
}

export function ChevronRightIcon(props: LegacyIconProps) {
  return (
    <Svg {...props}>
      <path d="m9 5 7 7-7 7" />
    </Svg>
  );
}
