"use client";

import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
  strokeWidth?: number;
};

function BaseIcon({
  children,
  className,
  size = 16,
  strokeWidth = 1.8,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {children}
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4.75A1.75 1.75 0 0 1 9.75 3h4.5A1.75 1.75 0 0 1 16 4.75V6" />
      <path d="M6.25 6 7 19.25A1.75 1.75 0 0 0 8.75 21h6.5A1.75 1.75 0 0 0 17 19.25L17.75 6" />
      <path d="M10 10.25v6.5" />
      <path d="M14 10.25v6.5" />
    </BaseIcon>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M14 3H8.75A1.75 1.75 0 0 0 7 4.75v14.5C7 20.22 7.78 21 8.75 21h6.5c.97 0 1.75-.78 1.75-1.75V8Z" />
      <path d="M14 3v5h5" />
      <path d="M10 13h4" />
      <path d="M10 16.5h4" />
    </BaseIcon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m6 9 6 6 6-6" />
    </BaseIcon>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m6 15 6-6 6 6" />
    </BaseIcon>
  );
}

export function MessageSquareIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6.75 18.5 3 21V6.75C3 5.78 3.78 5 4.75 5h14.5C20.22 5 21 5.78 21 6.75v8.5c0 .97-.78 1.75-1.75 1.75H8.25" />
      <path d="M7.5 10.25h9" />
      <path d="M7.5 13.75h5.5" />
    </BaseIcon>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 12 20 4 14 20l-2.9-5.1L4 12Z" />
      <path d="M11.1 14.9 20 4" />
    </BaseIcon>
  );
}
