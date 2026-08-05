import type { ReactNode, SVGProps } from 'react';
import { cn } from '@/lib/cn';

export type IconName =
  | 'activity'
  | 'alert'
  | 'bot'
  | 'browser'
  | 'check'
  | 'chevron-right'
  | 'circle'
  | 'close'
  | 'code'
  | 'copy'
  | 'edit'
  | 'eye'
  | 'file'
  | 'fit'
  | 'folder'
  | 'home'
  | 'image'
  | 'layers'
  | 'map'
  | 'message'
  | 'network'
  | 'pause'
  | 'paste'
  | 'play'
  | 'plus'
  | 'report'
  | 'search'
  | 'send'
  | 'select-all'
  | 'server'
  | 'settings'
  | 'shield'
  | 'skip'
  | 'sparkles'
  | 'target'
  | 'terminal'
  | 'trash'
  | 'tool'
  | 'vulnerability'
  | 'window-maximize'
  | 'window-minimize'
  | 'window-restore'
  | 'zoom-in'
  | 'zoom-out';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16, className, ...props }: IconProps) {
  const paths = ICON_PATHS[name];

  return (
    <svg
      aria-hidden="true"
      className={cn('shrink-0', className)}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      >
        {paths}
      </g>
    </svg>
  );
}

const ICON_PATHS: Record<IconName, ReactNode> = {
  activity: (
    <>
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.8 19h18.4L12 3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  bot: (
    <>
      <rect height="12" rx="3" width="16" x="4" y="8" />
      <path d="M12 4v4M8 13h.01M16 13h.01M9 17h6M2 12h2M20 12h2" />
      <circle cx="12" cy="3" r="1" />
    </>
  ),
  browser: (
    <>
      <rect height="16" rx="2" width="20" x="2" y="4" />
      <path d="M2 8h20M6 6h.01M9 6h.01" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  circle: <circle cx="12" cy="12" r="7" />,
  close: (
    <>
      <path d="m7 7 10 10M17 7 7 17" />
    </>
  ),
  code: (
    <>
      <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 6l-4 12" />
    </>
  ),
  copy: (
    <>
      <rect height="13" rx="2" width="12" x="8" y="7" />
      <path d="M16 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4M12 20h8" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6V3Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  fit: (
    <>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      <path d="m3 8 5-5M21 8l-5-5M3 16l5 5M21 16l-5 5" />
    </>
  ),
  folder: (
    <>
      <path d="M3 6h7l2 2h9v11H3V6Z" />
    </>
  ),
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </>
  ),
  image: (
    <>
      <rect height="16" rx="2" width="20" x="2" y="4" />
      <circle cx="8" cy="9" r="2" />
      <path d="m4 18 5-5 3 3 2-2 6 5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  map: (
    <>
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
      <path d="M9 3v15M15 6v15" />
    </>
  ),
  message: (
    <>
      <path d="M4 5h16v11H8l-4 4V5Z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="18" r="2.5" />
      <circle cx="19" cy="18" r="2.5" />
      <path d="m10.8 7.2-4.6 8.6M13.2 7.2l4.6 8.6M7.5 18h9" />
    </>
  ),
  pause: (
    <>
      <path d="M8 6v12M16 6v12" />
    </>
  ),
  paste: (
    <>
      <path d="M9 5h6M9 3h6v4H9V3Z" />
      <path d="M8 5H6a2 2 0 0 0-2 2v13h12v-3M14 11h6v9h-6v-9Z" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  report: (
    <>
      <path d="M6 3h12v18H6V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </>
  ),
  send: (
    <>
      <path d="m3 4 18 8-18 8 4-8-4-8Z" />
      <path d="M7 12h14" />
    </>
  ),
  'select-all': (
    <>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      <path d="M8 8h8v8H8V8Z" />
    </>
  ),
  server: (
    <>
      <rect height="6" rx="1.5" width="18" x="3" y="4" />
      <rect height="6" rx="1.5" width="18" x="3" y="14" />
      <path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-5" />
    </>
  ),
  skip: (
    <>
      <path d="m5 7 6 5-6 5V7ZM12 7l6 5-6 5V7ZM19 7v10" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
      <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" />
      <path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  terminal: (
    <>
      <rect height="16" rx="2" width="20" x="2" y="4" />
      <path d="m6 9 3 3-3 3M12 15h5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 3h6l1 4H8l1-4Z" />
      <path d="m6 7 1 14h10l1-14M10 11v6M14 11v6" />
    </>
  ),
  tool: (
    <>
      <path d="M14.5 6.5a4 4 0 0 0-5-5L12 4l-3 3-2.5-2.5a4 4 0 0 0 5 5L19 17l2-2-6.5-8.5Z" />
      <path d="m4 20 5.5-5.5" />
    </>
  ),
  vulnerability: (
    <>
      <path d="M12 3 4 7v5c0 4 2.4 7.2 8 9 5.6-1.8 8-5 8-9V7l-8-4Z" />
      <path d="M12 8v5M12 17h.01" />
    </>
  ),
  'window-maximize': <rect height="11" width="11" x="6.5" y="6.5" />,
  'window-minimize': <path d="M6 16.5h12" />,
  'window-restore': (
    <>
      <path d="M8 8h10v10H8V8Z" />
      <path d="M6 15V6h9" />
    </>
  ),
  'zoom-in': (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M10.5 7.5v6M7.5 10.5h6M15.5 15.5 21 21" />
    </>
  ),
  'zoom-out': (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M7.5 10.5h6M15.5 15.5 21 21" />
    </>
  ),
};
