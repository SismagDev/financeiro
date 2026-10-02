import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="m3 3 18 18M10 5c7-1 12 7 12 7a18 18 0 0 1-4 4M6 6a18 18 0 0 0-4 6s3 7 10 7a13 13 0 0 0 5-1"/><path d="M9 9a4 4 0 0 0 6 6"/></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  arrows: <><path d="M7 7h13l-3-3"/><path d="m20 7-3 3M17 17H4l3 3"/><path d="m4 17 3-3"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  wallet: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 15h2"/><path d="M7 5V3h11"/></>,
  card: <><rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M2.5 9h19M6 15h4"/></>,
  bank: <><path d="m3 9 9-6 9 6M4 10h16M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M2 18h20"/></>,
  arrowDown: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 17v4h14v-4"/></>,
  arrowUp: <><path d="M12 21V9m-5 5 5-5 5 5"/><path d="M5 7V3h14v4"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/></>,
  chevron: <path d="m7 10 5 5 5-5"/>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  dots: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  trend: <><path d="m3 17 6-6 4 4 8-9"/><path d="M15 6h6v6"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  close: <><path d="m18 6-12 12M6 6l12 12"/></>,
  edit: <><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z"/></>,
  trash: <><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
}

export function Icon({ name, size = 19 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.grid}</svg>
}
