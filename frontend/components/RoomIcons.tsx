// Line icons for the live meeting room (24x24, drawn with currentColor).

import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const BackIcon = (p: IconProps) => <Icon {...p}><path d="M15 5l-7 7 7 7" /></Icon>;
export const ForwardIcon = (p: IconProps) => <Icon {...p}><path d="M9 5l7 7-7 7" /></Icon>;
export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 4v4h4" /><path d="M12 8v4.5l3 2" /></Icon>
);
export const SearchIcon = (p: IconProps) => <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></Icon>;
export const BellIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></Icon>
);

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 10.5L12 4l8 6.5V20h-5.5v-5.5h-5V20H4z" /></Icon>
);
export const ChatIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 4h14a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-9.5L5 21v-3.5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></Icon>
);
export const MeetingsIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="6.5" width="12.5" height="11" rx="2.5" /><path d="M15.5 10.5l5-3v9l-5-3" /></Icon>
);
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5l1.6 2.2 2.7-.5.8 2.6 2.5 1.2-.9 2.6 1.4 2.4-2.3 1.5-.2 2.7-2.7.1L12 20.5l-1.9-2.2-2.7-.1-.2-2.7-2.3-1.5 1.4-2.4-.9-2.6 2.5-1.2.8-2.6 2.7.5z" />
  </Icon>
);

/** Zoom's red slash across the Mic and Video icons when they are off. */
const OFF_SLASH = "#f2384c";

const micShape = (
  <>
    <rect x="9" y="2.75" width="6" height="11.5" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21M8.5 21h7" />
  </>
);
export const MicIcon = (p: IconProps) => <Icon {...p}>{micShape}</Icon>;
export const MicOffIcon = (p: IconProps) => (
  <Icon {...p}>{micShape}<path d="M4.5 21L19.5 3" stroke={OFF_SLASH} strokeWidth={2} /></Icon>
);
const videoShape = (
  <><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="M15.5 10.2l5.5-3.2v10l-5.5-3.2" /></>
);
export const VideoIcon = (p: IconProps) => <Icon {...p}>{videoShape}</Icon>;
export const VideoOffIcon = (p: IconProps) => (
  <Icon {...p}>{videoShape}<path d="M3 20.5L20.5 3.5" stroke={OFF_SLASH} strokeWidth={2} /></Icon>
);
export const ParticipantsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.3" /><path d="M3 19.5v-.5c0-2.8 2.4-4.8 6-4.8s6 2 6 4.8v.5z" />
    <path d="M15.5 4.9a3.3 3.3 0 0 1 0 6.3" /><path d="M17.5 14.4c2.2.6 3.5 2.2 3.5 4.6v.5" />
  </Icon>
);
export const ReactIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 20.3l-1.2-1.1C6.4 15.3 3.5 12.7 3.5 9.4a4.7 4.7 0 0 1 4.8-4.8c1.5 0 3 .7 3.7 1.9.7-1.2 2.2-1.9 3.7-1.9a4.7 4.7 0 0 1 4.8 4.8c0 3.3-2.9 5.9-7.3 9.8z" />
  </Icon>
);
export const ShareIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M12 15.5V9M9 11.5l3-3 3 3" /></Icon>
);
/** The solid arrow on Share's green square. */
export const ShareArrowIcon = ({ size = 18, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
    <path d="M12 3l8 8h-5v9.5H9V11H4z" fill="currentColor" />
  </svg>
);
export const HostToolsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.8l7.8 3v6c0 4.6-3.2 8.2-7.8 9.6-4.6-1.4-7.8-5-7.8-9.6v-6z" />
    <path d="M12 6.4l-4.5 1.7v3.7c0 2.8 1.8 5.1 4.5 6.2z" fill="currentColor" stroke="none" />
    <path d="M12 6.4l4.5 1.7v3.7c0 2.8-1.8 5.1-4.5 6.2" strokeWidth={1.3} />
  </Icon>
);
export const MoreIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9.5" /><path d="M7.8 12h.01M12 12h.01M16.2 12h.01" strokeWidth={2.6} /></Icon>
);
export const InfoIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.6h.01" strokeWidth={2.4} /></Icon>
);
/** The green shield in the meeting header: the meeting is encrypted. */
export const SecureIcon = ({ size = 22, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
    <path d="M12 2.5l8 3v6.2c0 4.7-3.3 8.4-8 9.8-4.7-1.4-8-5.1-8-9.8V5.5z" fill="#2fbe55" />
    <path d="M8.3 12.2l2.6 2.6 4.9-5" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const ViewIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="7.5" height="6" rx="1" fill="currentColor" />
    <rect x="13" y="5" width="7.5" height="6" rx="1" fill="currentColor" />
    <rect x="3.5" y="13" width="17" height="6" rx="1" />
  </Icon>
);
export const BackgroundsIcon = (p: IconProps) => (
  <Icon {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="12" cy="10.5" r="2.6" /><path d="M7 19.5c.7-2.7 2.6-4.2 5-4.2s4.3 1.5 5 4.2" /></Icon>
);

// Meeting Chat panel
export const PopOutIcon = (p: IconProps) => (
  <Icon {...p}><path d="M19.5 13.5v4a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h4" /><path d="M14 4.5h5.5V10M19.5 4.5L11 13" /></Icon>
);
export const CloseIcon = (p: IconProps) => <Icon {...p}><path d="M5.5 5.5l13 13M18.5 5.5l-13 13" /></Icon>;
export const WhoCanSeeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="7.5" r="3.3" /><path d="M3.5 19.5c.4-3.5 3-5.5 6.5-5.5 1.1 0 2.1.2 3 .6" />
    <circle cx="17.5" cy="17" r="3.3" fill="#4b96f1" stroke="none" />
  </Icon>
);
export const FormatIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 5.5h10M9 5.5v13" /><path d="M14.5 19.5l1-3.2 4.3-4.3a1.6 1.6 0 0 1 2.2 2.2l-4.3 4.3z" /></Icon>
);
export const FileIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6.5 3.5h7.5l4.5 4.5v10.5a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" /><path d="M14 3.5V8h4.5" /></Icon>
);
export const EmojiIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" /><path d="M8.5 14c.8 1.2 2 1.9 3.5 1.9s2.7-.7 3.5-1.9" />
    <path d="M9.3 10h.01M14.7 10h.01" strokeWidth={2.4} />
  </Icon>
);
export const DotsIcon = (p: IconProps) => <Icon {...p}><path d="M5.5 12h.01M12 12h.01M18.5 12h.01" strokeWidth={2.6} /></Icon>;
export const SendIcon = ({ size = 20, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
    <path d="M3 4.5l18-1.5-6.5 18-3.2-7.3z" fill="currentColor" />
  </svg>
);
export const CaretUpIcon = (p: IconProps) => <Icon size={12} strokeWidth={2.2} {...p}><path d="M6 15l6-6 6 6" /></Icon>;
/** The meeting toolbar's End button: a red hexagon with a white cross. */
export const EndIcon = ({ size = 26, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false" {...rest}>
    <path d="M7.2 3.2h9.6l5 8.8-5 8.8H7.2l-5-8.8z" stroke="#f0466a" strokeWidth={2} />
    <path d="M9.4 9.4l5.2 5.2M14.6 9.4l-5.2 5.2" stroke="#fff" strokeWidth={2.2} />
  </svg>
);
