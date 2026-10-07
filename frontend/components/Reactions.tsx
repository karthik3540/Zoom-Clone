"use client";

// The meeting toolbar's React menu, as in Zoom: emoji reactions, nonverbal feedback
// (Yes, No, Slow down, Speed up, Coffee), Raise Hand and Be right back. Reactions are
// shown on this browser's own screen only; nothing is sent to other participants.

import { forwardRef, useState } from "react";

export const REACTION_EMOJIS = ["👏", "👍", "😂", "😮", "❤️", "🎉"];
const MORE_EMOJIS = ["😀", "😊", "😍", "🤔", "😢", "😡", "🙏", "👋", "👎", "🔥", "💯", "✨"];

export type Feedback = "yes" | "no" | "slower" | "faster" | "coffee";
export const FEEDBACK: ReadonlyArray<{ id: Feedback; label: string }> = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
  { id: "slower", label: "Slow down" },
  { id: "faster", label: "Speed up" },
  { id: "coffee", label: "Coffee" },
];

/** A nonverbal feedback icon: a coloured circle with a white mark (the coffee cup is an emoji). */
export function FeedbackIcon({ kind, size = 20 }: { kind: Feedback; size?: number }) {
  if (kind === "coffee") {
    return <span className="zrx-coffee" style={{ fontSize: size * 0.9 }} aria-hidden="true">☕</span>;
  }
  const fill = { yes: "#16a34a", no: "#e5484d", slower: "#6b7280", faster: "#0e72ed" }[kind];
  const mark = {
    yes: <path d="M7 12.3l3.3 3.2L17 8.8" />,
    no: <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />,
    slower: <path d="M12.5 8l-4 4 4 4M17 8l-4 4 4 4" />,
    faster: <path d="M7 8l4 4-4 4M11.5 8l4 4-4 4" />,
  }[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" fill={fill} />
      <g fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">{mark}</g>
    </svg>
  );
}

type Props = {
  position: { left: number; bottom: number };
  feedback: Feedback | null;
  handRaised: boolean;
  beRightBack: boolean;
  onEmoji: (emoji: string) => void;
  onFeedback: (kind: Feedback) => void;
  onRaiseHand: () => void;
  onBeRightBack: () => void;
};

const ReactionsMenu = forwardRef<HTMLDivElement, Props>(function ReactionsMenu(
  { position, feedback, handRaised, beRightBack, onEmoji, onFeedback, onRaiseHand, onBeRightBack },
  ref,
) {
  const [showMore, setShowMore] = useState(false);
  return (
    <div
      ref={ref}
      className="zrx-menu"
      role="menu"
      aria-label="Reactions"
      style={{ left: position.left, bottom: position.bottom }}
    >
      <div className="zrx-emojis">
        {REACTION_EMOJIS.map((emoji) => (
          <button key={emoji} type="button" role="menuitem" className="zrx-emoji" onClick={() => onEmoji(emoji)}>
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className="zrx-emoji zrx-more"
          aria-label="More emojis"
          aria-expanded={showMore}
          onClick={() => setShowMore((open) => !open)}
        >
          •••
        </button>
      </div>
      {showMore && (
        <div className="zrx-more-grid">
          {MORE_EMOJIS.map((emoji) => (
            <button key={emoji} type="button" role="menuitem" className="zrx-emoji" onClick={() => onEmoji(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      )}
      <div className="zrx-feedback">
        {FEEDBACK.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={feedback === id}
            aria-label={label}
            data-tip={label}
            className={`zrx-feedback-btn ${feedback === id ? "is-on" : ""}`}
            onClick={() => onFeedback(id)}
          >
            <FeedbackIcon kind={id} />
          </button>
        ))}
      </div>
      <button type="button" role="menuitemcheckbox" aria-checked={handRaised} className="zrx-wide" onClick={onRaiseHand}>
        ✋{handRaised ? "Lower Hand" : "Raise Hand"}
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={beRightBack} className="zrx-wide" onClick={onBeRightBack}>
        ⏳{beRightBack ? "I'm back" : "Be right back"}
      </button>
    </div>
  );
});

export default ReactionsMenu;
