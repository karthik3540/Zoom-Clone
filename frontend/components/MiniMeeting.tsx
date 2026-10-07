"use client";

// The minimized meeting: a small floating window that stays on top of every
// page while this browser is in a meeting but not looking at the full room
// (e.g. after clicking Home in the room). Drag it anywhere; double-click it to
// go back to the full room. Hovering shows the mic and camera buttons.
// Being in the meeting is decided by the backend, which this window keeps checking.

import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { MicOffIcon } from "@/components/RoomIcons";
import {
  getActiveMeeting,
  isRoomOpen,
  setActiveMeeting,
  subscribeActiveMeeting,
  updateActiveMeeting,
} from "@/lib/activeMeeting";
import { ApiError, Participant, getOwnParticipant, getPublicMeeting } from "@/lib/meetings";

const WIDTH = 340;
const HEIGHT = 172;
const MARGIN = 12;
const POLL_MS = 3000;
const POSITION_KEY = "zoom-mini-position";

type Position = { x: number; y: number };

function clamp(position: Position): Position {
  return {
    x: Math.min(Math.max(MARGIN, position.x), Math.max(MARGIN, window.innerWidth - WIDTH - MARGIN)),
    y: Math.min(Math.max(MARGIN, position.y), Math.max(MARGIN, window.innerHeight - HEIGHT - MARGIN)),
  };
}

function savedPosition(): Position {
  try {
    const saved = window.sessionStorage.getItem(POSITION_KEY);
    if (saved) return clamp(JSON.parse(saved) as Position);
  } catch {
    // fall through to the default corner
  }
  return clamp({ x: window.innerWidth - WIDTH - 24, y: window.innerHeight - HEIGHT - 24 });
}

/** White mic with a red slash (muted) or a plain white mic. */
function MicButtonIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g stroke="#fff" strokeWidth={1.7}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
        <path d="M12 17.5V21" />
      </g>
      {muted && <path d="M4 20L20 4" stroke="#ff2d55" strokeWidth={2} />}
    </svg>
  );
}

/** White camera with a red slash and a red warning badge (camera off / not available) or a plain camera. */
function VideoButtonIcon({ on }: { on: boolean }) {
  return (
    <svg width="28" height="26" viewBox="0 0 26 24" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g stroke="#fff" strokeWidth={1.7}>
        <rect x="2.5" y="6.5" width="13" height="11" rx="2.5" />
        <path d="M15.5 10.5l5-3v9l-5-3" />
      </g>
      {!on && (
        <>
          <path d="M3 20L19 4" stroke="#ff2d55" strokeWidth={2} />
          <path d="M20 13.2l5 8.8H15z" fill="#ff2d55" />
          <path d="M20 16.6v2.4" stroke="#fff" strokeWidth={1.6} />
          <circle cx="20" cy="20.6" r="0.7" fill="#fff" />
        </>
      )}
    </svg>
  );
}

export default function MiniMeeting() {
  const router = useRouter();
  const meeting = useSyncExternalStore(subscribeActiveMeeting, getActiveMeeting, () => null);
  const roomOpen = useSyncExternalStore(subscribeActiveMeeting, isRoomOpen, () => false);
  const visible = meeting !== null && !roomOpen;

  const [me, setMe] = useState<Participant | null>(null);
  const [notice, setNotice] = useState<"ended" | "removed" | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const code = meeting?.code ?? null;

  // Place the window (last position, or the bottom-right corner) and keep it on screen.
  useEffect(() => {
    if (!visible) return;
    setPosition(savedPosition());
    const keepOnScreen = () => setPosition((current) => (current ? clamp(current) : current));
    window.addEventListener("resize", keepOnScreen);
    return () => window.removeEventListener("resize", keepOnScreen);
  }, [visible]);

  // Follow this browser's place in the meeting while minimized.
  useEffect(() => {
    if (!visible || !code) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const own = await getOwnParticipant(code);
        if (!cancelled) setMe(own);
      } catch (failure) {
        if (cancelled || !(failure instanceof ApiError)) return; // offline: try again on the next tick
        if (failure.code === "participant_removed") setNotice("removed");
        else if (failure.code === "participant_not_found") {
          const status = (await getPublicMeeting(code).catch(() => null))?.status;
          if (cancelled) return;
          if (status === "ended") setNotice("ended");
          else setActiveMeeting(null); // left from somewhere else
        }
      }
    };
    void tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [visible, code]);

  useEffect(() => {
    if (!visible) {
      setNotice(null);
      setMe(null);
    }
  }, [visible]);

  if (!visible || !meeting || !position) return null;

  const expand = () => router.push(`/meetings/my-meeting?live=1&meeting=${meeting.code}`);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    drag.current = { dx: event.clientX - position.x, dy: event.clientY - position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPosition(clamp({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy }));
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    try {
      window.sessionStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch {
      // the position is just not remembered
    }
  };

  const name = me?.display_name ?? meeting.name;
  const waiting = me?.status === "waiting";

  return (
    <div
      className="zm-mini"
      role="region"
      aria-label={`${meeting.title}, minimized. Double-click to return to the meeting.`}
      tabIndex={0}
      style={{ left: position.x, top: position.y, width: WIDTH, height: HEIGHT }}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(event) => {
        if (!(event.target as HTMLElement).closest("button")) expand();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) expand();
      }}
    >
      {notice ? (
        <div className="zm-notice" role="status">
          <p>{notice === "ended" ? "This meeting has been ended by host" : "You have been removed from this meeting"}</p>
          <button type="button" onClick={() => setActiveMeeting(null)}>OK</button>
        </div>
      ) : waiting ? (
        <p className="zm-waiting" role="status">Please wait, the meeting host will let you in soon.</p>
      ) : (
        <>
          <div className="zm-avatar" aria-hidden="true">{name.charAt(0)}</div>
          <span className="zm-name">
            {meeting.muted && <MicOffIcon size={18} className="zm-off" />}
            {name}
          </span>
          <div className="zm-hover-controls">
            <button
              type="button"
              aria-pressed={!meeting.muted}
              aria-label={meeting.muted ? "Unmute" : "Mute"}
              title={meeting.muted ? "Unmute" : "Mute"}
              onClick={() => updateActiveMeeting({ muted: !meeting.muted })}
            >
              <MicButtonIcon muted={meeting.muted} />
            </button>
            <button
              type="button"
              aria-pressed={meeting.videoOn}
              aria-label={meeting.videoOn ? "Stop video" : "Start video"}
              title={meeting.videoOn ? "Stop video" : "Start video"}
              onClick={() => updateActiveMeeting({ videoOn: !meeting.videoOn })}
            >
              <VideoButtonIcon on={meeting.videoOn} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
