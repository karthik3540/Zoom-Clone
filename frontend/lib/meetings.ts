"use client";

// Meeting API calls: the Host action, scheduling, and the Manage page.
// The backend generates meeting codes; the frontend only uses the IDs it returns.

import { MouseEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL, getUserId, identityHeaders } from "@/lib/identity";

export type MeetingIdType = "generated" | "personal";
export type AttachmentKind = "whiteboard" | "doc";

export type MeetingSummary = {
  meeting_code: string; // the meeting's own 11-digit ID: the key in every API path
  meeting_id_type: MeetingIdType;
  public_meeting_id: string; // what people join with: meeting_code, or the host's 10-digit PMI
  invite_url: string;
  host_id: number; // the owner's account
  title: string;
  description: string | null;
  meeting_type: string;
  status: string;
  scheduled_start_at: string | null; // UTC, ISO 8601
  duration_minutes: number | null;
  timezone: string; // IANA name
  started_at: string | null;
  ended_at: string | null;
  ends_at: string | null; // when a started meeting ends by itself: 40 minutes after it started
  has_passcode: boolean;
  passcode_required: boolean; // joining asks for the passcode (scheduled meetings only)
  waiting_room_enabled: boolean;
};

export type MeetingDetails = MeetingSummary & {
  passcode: string | null; // only for the owner (or the active host browser)
  encryption_mode: "enhanced" | "end_to_end";
  notes_enabled: boolean;
  notes_scope: "organization_only" | "all_participants" | null;
  host_video_enabled: boolean;
  participant_video_enabled: boolean;
  template: string | null;
  attachments: { id: number; kind: AttachmentKind; title: string; created_at: string }[];
};

/** What the Schedule / Edit form saves (POST /api/meetings/scheduled and PATCH /api/meetings/{code}). */
export type ScheduleForm = {
  title: string;
  description: string | null;
  scheduled_start_at: string; // wall-clock "YYYY-MM-DD HH:MM:SS" in `timezone`, no offset
  duration_minutes: number;
  timezone: string;
  meeting_id_type: MeetingIdType;
  passcode: string | null;
  waiting_room_enabled: boolean;
  encryption_mode: "enhanced" | "end_to_end";
  notes_enabled: boolean;
  notes_scope: "organization_only" | "all_participants" | null;
  host_video_enabled: boolean;
  participant_video_enabled: boolean;
  template: string | null;
  attachments: { kind: AttachmentKind; title: string }[];
};

export type CurrentUser = { id: number; email: string; display_name: string; personal_meeting_id: string };

/** The Schedule page's time zones (IANA names; labels as Zoom shows them). */
export const TIME_ZONES = [
  { value: "Asia/Kolkata", label: "(GMT+5:30) India", place: "India" },
  { value: "Europe/London", label: "(GMT+0:00) London", place: "London" },
  { value: "America/New_York", label: "(GMT-5:00) Eastern Time", place: "Eastern Time" },
];

export function timeZonePlace(zone: string): string {
  return TIME_ZONES.find((z) => z.value === zone)?.place ?? zone;
}

const MEETING_CODE = /^\d{11}$/;

export function isMeetingCode(value: string | null): value is string {
  return value !== null && MEETING_CODE.test(value);
}

/** "85123456789" -> "851 2345 6789" */
export function formatMeetingCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3, 7)} ${code.slice(7)}`;
}

/** A meeting ID as Zoom shows it: 11 digits "851 2345 6789", a 10-digit PMI "603 678 7109". */
export function formatMeetingId(id: string): string {
  if (/^\d{10}$/.test(id)) return `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6)}`;
  return /^\d{11}$/.test(id) ? formatMeetingCode(id) : id;
}

/** Date/time parts of a UTC instant on the wall clock of `zone`. */
export function wallClock(iso: string, zone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true,
    }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`, // for <input type="date">
    time: `${parts.hour}:${parts.minute}`, // "04:30", 12-hour clock
    ampm: (parts.dayPeriod ?? "AM").toUpperCase() as "AM" | "PM",
  };
}

/** "Oct 7, 2026 04:30 AM" in `zone`. */
export function formatInZone(iso: string, zone: string, withDate = true): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: true,
    ...(withDate ? { month: "short", day: "numeric", year: "numeric" } : {}),
  }).format(new Date(iso)).replace(/, (\d{2}:)/, " $1"); // "Oct 7, 2026, 04:30 AM" -> "Oct 7, 2026 04:30 AM"
}

/** An API failure, with the error code the backend returned (e.g. "participant_removed"). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
  }
}

/** Every user-specific API call: identity headers, JSON, and the API's error message on failure. */
async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...identityHeaders() },
    });
  } catch {
    throw new Error("Can't reach the server. Please try again.");
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body?.error;
    const message = typeof error?.message === "string" ? error.message : "Something went wrong. Please try again.";
    const code = typeof error?.code === "string" ? error.code : null;
    throw new ApiError(code === "meeting_not_found" ? "This meeting no longer exists." : message, response.status, code);
  }
  return body as T;
}

export const getCurrentUser = () => apiRequest<CurrentUser>("/api/users/me");
export const getMeetingDetails = (code: string) => apiRequest<MeetingDetails>(`/api/meetings/${code}/details`);
export const listUpcomingMeetings = () => apiRequest<MeetingSummary[]>("/api/meetings/upcoming");
export const listPreviousMeetings = () => apiRequest<MeetingSummary[]>("/api/meetings/recent");
export const startMeeting = (code: string) =>
  apiRequest<MeetingDetails>(`/api/meetings/${code}/start`, { method: "POST" });
export const deleteMeeting = (code: string) => apiRequest<void>(`/api/meetings/${code}`, { method: "DELETE" });
export const removeAttachment = (code: string, attachmentId: number) =>
  apiRequest<void>(`/api/meetings/${code}/attachments/${attachmentId}`, { method: "DELETE" });
export const createScheduledMeeting = (form: ScheduleForm) =>
  apiRequest<MeetingDetails>("/api/meetings/scheduled", { method: "POST", body: JSON.stringify(form) });
export const updateScheduledMeeting = (code: string, form: ScheduleForm) =>
  apiRequest<MeetingDetails>(`/api/meetings/${code}`, { method: "PATCH", body: JSON.stringify(form) });

// --- Participants: joining, the waiting room and host controls (this browser is X-Client-Token) ---

export type Participant = {
  id: number;
  display_name: string;
  role: "host" | "participant";
  status: "waiting" | "joined" | "left" | "removed";
  is_muted: boolean;
  is_video_on: boolean;
  joined_at: string;
  left_at: string | null;
};
export type HostAction = "admit" | "waiting-room" | "remove" | "make-host";

export const joinMeeting = (code: string, body: { display_name: string; passcode: string | null; as_host: boolean }) =>
  apiRequest<{ participant: Participant; reused: boolean }>(`/api/meetings/${code}/join`, {
    method: "POST",
    body: JSON.stringify(body),
  });
/** "End meeting for all": the active host browser ends the meeting and everyone is checked out. */
export const endMeeting = (code: string) =>
  apiRequest<MeetingDetails>(`/api/meetings/${code}/end`, { method: "POST" });
/** "Leave meeting": a host leaving hands the host role to whoever has been in the room longest. */
export const leaveMeeting = (code: string) =>
  apiRequest<{ left: boolean; meeting_ended: boolean }>(`/api/meetings/${code}/leave`, { method: "POST" });
/** This browser's own row: "waiting" until the host admits it, then "joined". */
export const getOwnParticipant = (code: string) => apiRequest<Participant>(`/api/meetings/${code}/participants/me`);
/** The room (and, for the host, the waiting room). */
export const listParticipants = (code: string) => apiRequest<Participant[]>(`/api/meetings/${code}/participants`);
export const participantAction = (code: string, participantId: number, action: HostAction) =>
  apiRequest<Participant>(`/api/meetings/${code}/participants/${participantId}/${action}`, { method: "POST" });
export const renameParticipant = (code: string, participantId: number, displayName: string) =>
  apiRequest<Participant>(`/api/meetings/${code}/participants/${participantId}`, {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
export const muteAll = (code: string) =>
  apiRequest<{ muted: number }>(`/api/meetings/${code}/mute-all`, { method: "POST" });

/** Creates a live instant meeting hosted by the identified user (X-User-Id). */
export async function createInstantMeeting(): Promise<MeetingSummary> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/meetings/instant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...identityHeaders() },
      body: "{}",
    });
  } catch {
    throw new Error("Can't reach the server. Please try again.");
  }
  if (!response.ok) throw new Error("Couldn't start a meeting. Please try again.");
  const meeting = (await response.json()) as MeetingSummary;
  if (!isMeetingCode(meeting?.meeting_code)) throw new Error("Couldn't start a meeting. Please try again.");
  return meeting;
}

/** What anyone with the code may see (never includes the passcode). */
export async function getPublicMeeting(code: string): Promise<MeetingSummary> {
  const response = await fetch(`${API_BASE_URL}/api/meetings/${code}`);
  if (!response.ok) throw new Error("Couldn't load this meeting.");
  return (await response.json()) as MeetingSummary;
}

/**
 * The Host action: create an instant meeting, then open it.
 * Ignores repeated clicks while a request is in flight, so one click makes one meeting.
 * With `newTab`, the meeting opens in a new browser tab. That tab is opened during the
 * click itself (browsers block tabs opened later) and sent to the meeting once it exists.
 */
export function useHostMeeting({ newTab = false }: { newTab?: boolean } = {}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const host = async (event: MouseEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (!getUserId()) {
      router.push("/signin");
      return;
    }
    const tab = newTab ? window.open("about:blank", "_blank") : null;
    if (tab) tab.opener = null; // the meeting tab cannot reach back into this page
    inFlight.current = true;
    setStarting(true);
    setError("");
    try {
      const meeting = await createInstantMeeting();
      const url = `/meetings/my-meeting?live=1&meeting=${meeting.meeting_code}`;
      if (tab) {
        tab.location.href = url;
        inFlight.current = false;
        setStarting(false);
      } else {
        router.push(url);
      }
    } catch (failure) {
      tab?.close();
      setError(failure instanceof Error ? failure.message : "Couldn't start a meeting. Please try again.");
      inFlight.current = false;
      setStarting(false);
    }
  };

  return { host, starting, error };
}
