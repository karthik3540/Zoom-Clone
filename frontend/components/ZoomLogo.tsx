// The Zoom wordmark ("zoom" in Zoom blue), drawn as a vector so it stays crisp at any size.

const VIEW_WIDTH = 139;
const VIEW_HEIGHT = 36;

export default function ZoomLogo({ height = 26, className }: { height?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={(height * VIEW_WIDTH) / VIEW_HEIGHT}
      height={height}
      viewBox={`2 2 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="img"
      aria-label="Zoom"
      focusable="false"
    >
      <g fill="none" stroke="#0B5CFF" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round">
        {/* z */}
        <path d="M9 8.5H29L9 31.5H29" />
        {/* o o */}
        <circle cx={51} cy={20} r={11.5} />
        <circle cx={84} cy={20} r={11.5} />
        {/* m */}
        <path d="M106.5 31.5V16a7 7 0 0 1 14 0v15.5M120.5 16a7 7 0 0 1 14 0v15.5" />
      </g>
    </svg>
  );
}
