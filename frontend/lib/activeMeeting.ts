"use client";

// The meeting this browser is in, shared between the full meeting room and the
// minimized floating window shown on every other page. Kept in sessionStorage
// (this tab only) so it survives page changes and a refresh; the backend
// remains the authority on whether this browser is still in the meeting.

export type ActiveMeeting = {
  code: string; // the meeting's 11-digit meeting_code (API paths)
  title: string;
  publicId: string; // what is shown as "ID": the code or the host's PMI
  name: string; // this browser's name in the meeting
  muted: boolean;
  videoOn: boolean;
};

const KEY = "zoom-active-meeting";
const listeners = new Set<() => void>();
let roomOpen = false;
let cached: ActiveMeeting | null | undefined;

function read(): ActiveMeeting | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ActiveMeeting) : null;
  } catch {
    return null;
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function getActiveMeeting(): ActiveMeeting | null {
  if (typeof window === "undefined") return null;
  if (cached === undefined) cached = read();
  return cached;
}

/** Record (or with null, forget) the meeting this browser is in. */
export function setActiveMeeting(meeting: ActiveMeeting | null) {
  cached = meeting;
  try {
    if (meeting) window.sessionStorage.setItem(KEY, JSON.stringify(meeting));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private mode): the in-memory value still works for this page session.
  }
  notify();
}

export function updateActiveMeeting(changes: Partial<ActiveMeeting>) {
  const current = getActiveMeeting();
  if (current) setActiveMeeting({ ...current, ...changes });
}

/** Whether the full meeting room is on screen (the floating window hides while it is). */
export function setRoomOpen(open: boolean) {
  if (roomOpen === open) return;
  roomOpen = open;
  notify();
}

export function isRoomOpen(): boolean {
  return roomOpen;
}

export function subscribeActiveMeeting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
