/**
 * Inline SVG icons.
 *
 * Unicode glyphs were the first attempt and were wrong: several of the obvious
 * choices (U+270E PENCIL, U+2715 MULTIPLICATION X) have emoji presentations, and
 * platform fonts pick them inconsistently - Segoe rendered a full-colour pencil
 * in the middle of a monochrome toolbar, and the U+FE0E variation selector did
 * not override it because the font has no text glyph to fall back to.
 *
 * These are drawn instead. They inherit `currentColor`, scale with the text, and
 * look identical on every platform. Each is a handful of path data; an icon
 * library would be a dependency and a download for the same result.
 *
 * All are `aria-hidden`: every icon in this application sits inside a control
 * that already carries an accessible name.
 */

export interface IconProps {
  readonly size?: number | undefined;
  readonly className?: string | undefined;
}

/** So callers can hold an icon in a variable without naming its implementation. */
export type IconComponent = (props: IconProps) => React.ReactElement;

function svg(path: React.ReactNode, { size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {path}
    </svg>
  );
}

export const EditIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>,
    props,
  );

export const MoveIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </>,
    props,
  );

export const DuplicateIcon = (props: IconProps) =>
  svg(
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>,
    props,
  );

export const ArchiveIcon = (props: IconProps) =>
  svg(
    <>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </>,
    props,
  );

export const RestoreIcon = (props: IconProps) =>
  svg(
    <>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M12 18v-6" />
      <path d="m9 15 3-3 3 3" />
    </>,
    props,
  );

export const DeleteIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </>,
    props,
  );

export const CloseIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>,
    props,
  );

export const PlusIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>,
    props,
  );

export const MinusIcon = (props: IconProps) => svg(<path d="M5 12h14" />, props);

export const MenuIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </>,
    props,
  );

/**
 * A speech bubble with a question in it: the ask button in the header.
 *
 * It is not a microphone, and that is the honest drawing. The header button
 * opens the sheet; the microphone is inside it, next to the box you can type
 * in, because on a phone with no offline speech pack the box is what works and
 * a header that promised to listen would be the interface overstating itself.
 *
 * Drawn here for the same reason as the rest - an icon font would be a network
 * request, and this application is not allowed to make one.
 */
export const AskIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 0 1 13 4a8 8 0 0 1 8 8Z" />
      <path d="M10.5 9.5a2.5 2.5 0 0 1 4.4 1.6c0 1.7-2.4 2-2.4 3.4" />
      <path d="M12.5 17.2h.01" />
    </>,
    props,
  );

/**
 * A microphone: capsule, stand, and the arc of the pickup pattern.
 *
 * On the one control that actually listens, inside the ask sheet. Drawn rather
 * than fetched, like the rest.
 */
export const MicIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </>,
    props,
  );

/* ---- Navigation ----------------------------------------------------------- */

export const DashboardIcon = (props: IconProps) =>
  svg(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>,
    props,
  );

export const InventoryIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M3 7h18" />
      <path d="M3 12h18" />
      <path d="M3 17h18" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </>,
    props,
  );

export const ExpiryIcon = (props: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
    props,
  );

export const ReplenishIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </>,
    props,
  );

export const CatalogIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M4 4h7v16H4z" />
      <path d="M13 4h7v16h-7z" />
      <path d="M6.5 8h2M15.5 8h2" />
    </>,
    props,
  );

export const LocationIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    </>,
    props,
  );

export const CategoryIcon = (props: IconProps) =>
  svg(
    <>
      <path d="m12 3 9 9-9 9-9-9Z" />
    </>,
    props,
  );

export const ReportsIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>,
    props,
  );

export const ContactsIcon = (props: IconProps) =>
  svg(
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </>,
    props,
  );

export const SettingsIcon = (props: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </>,
    props,
  );
