import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const Icon = ({ children, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {children}
  </svg>
);

export const CheckIcon = (props: IconProps) => <Icon {...props}><path d="m5 12 4 4L19 6" /></Icon>;
export const BookmarkIcon = (props: IconProps) => <Icon {...props}><path d="M6.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16L12 17l-5.5 3.5Z" /></Icon>;
export const BanIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="8.5" /><path d="m6 18 12-12" /></Icon>;
export const CompareIcon = (props: IconProps) => <Icon {...props}><rect x="3.5" y="5" width="7" height="14" rx="1.5" /><rect x="13.5" y="5" width="7" height="14" rx="1.5" /><path d="M7 8v8M17 8v8" /></Icon>;
export const ClockIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></Icon>;
export const LockIcon = (props: IconProps) => <Icon {...props}><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon>;
export const VolumeIcon = (props: IconProps) => <Icon {...props}><path d="M5 10v4h3l4 3V7l-4 3Z" /><path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11" /></Icon>;
export const DocumentIcon = (props: IconProps) => <Icon {...props}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h6" /></Icon>;
export const PinIcon = (props: IconProps) => <Icon {...props}><path d="m9 3 6 0-.7 6 3.2 3H6.5l3.2-3Z" /><path d="M12 12v9" /></Icon>;
export const CloseIcon = (props: IconProps) => <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
export const RefreshIcon = (props: IconProps) => <Icon {...props}><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8A7 7 0 0 1 18.5 6L20 8M4 16l1.5 2A7 7 0 0 0 18 16" /></Icon>;
