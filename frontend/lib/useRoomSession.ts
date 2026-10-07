"use client";

// This browser's place in a live meeting: joining (the owner as host, anyone
// else as a participant), the waiting room, and the roster the Participants
// panel shows. Everything comes from the backend; nothing is decided here.

import { useCallback, useEffect, useRef, useState } from "react";
import { getUserId } from "@/lib/identity";
import {
  ApiError,
  HostAction,
  MeetingDetails,
  Participant,
  endMeeting,
  getOwnParticipant,
  getPublicMeeting,
  joinMeeting,
  leaveMeeting,
  listParticipants,
  muteAll,
  participantAction,
  renameParticipant,
  startMeeting,
} from "@/lib/meetings";

const POLL_MS = 3000;

export type RoomState =
  | "loading" // waiting for the meeting's details
  | "entry" // a guest must give a name (and the passcode)
  | "joining"
  | "waiting" // in the waiting room until the host admits this browser
  | "in" // in the room
  | "removed" // the host removed this browser; it cannot rejoin
  | "ended"; // the host ended the meeting for everyone

export function useRoomSession(details: MeetingDetails | null, active: boolean, displayName: string) {
  const [state, setState] = useState<RoomState>("loading");
  const [me, setMe] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState("");
  const [endedByTimeLimit, setEndedByTimeLimit] = useState(false);
  const code = details?.meeting_code ?? null;
  const started = useRef(false);

  const follow = useCallback((participant: Participant) => {
    setMe(participant);
    const next: Record<Participant["status"], RoomState> = {
      waiting: "waiting", joined: "in", removed: "removed", left: "entry",
    };
    setState(next[participant.status]);
  }, []);

  const handleFailure = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && failure.code === "participant_removed") {
      setState("removed");
      setParticipants([]);
      return;
    }
    setError(failure instanceof Error ? failure.message : "Something went wrong. Please try again.");
  }, []);

  const join = useCallback(async (name: string, passcode: string | null, asHost: boolean) => {
    if (!code) return;
    setState("joining");
    setError("");
    try {
      const result = await joinMeeting(code, { display_name: name, passcode, as_host: asHost });
      follow(result.participant);
    } catch (failure) {
      handleFailure(failure);
      setState((current) => (current === "removed" ? current : "entry"));
    }
  }, [code, follow, handleFailure]);

  // The owner's browser goes straight in as host (starting a scheduled meeting first, so the host
  // is never asked for its passcode); anyone else enters a name (and passcode) first.
  useEffect(() => {
    if (!active || !details || started.current) return;
    started.current = true;
    const isOwner = String(details.host_id) === getUserId();
    if (isOwner) {
      void (async () => {
        let passcode = details.passcode;
        if (details.status === "scheduled") {
          setState("joining");
          try {
            passcode = (await startMeeting(details.meeting_code)).passcode;
          } catch (failure) {
            handleFailure(failure);
            setState("entry");
            return;
          }
        }
        await join(displayName, passcode, true);
      })();
      return;
    }
    // A guest coming back to the room (e.g. expanding the minimized meeting) is still in it:
    // carry on without asking for the name and passcode again.
    getOwnParticipant(details.meeting_code)
      .then(follow)
      .catch((failure) => (failure instanceof ApiError && failure.code === "participant_removed"
        ? setState("removed")
        : setState("entry")));
  }, [active, details, displayName, join, follow, handleFailure]);

  const refreshRoster = useCallback(async () => {
    if (!code) return;
    try {
      setParticipants(await listParticipants(code));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "not_meeting_participant") return; // just moved out
      handleFailure(failure);
    }
  }, [code, handleFailure]);

  // Follow this browser's own state (admitted, sent back to wait, removed, made host) and the roster.
  useEffect(() => {
    if (!active || !code || (state !== "waiting" && state !== "in")) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const own = await getOwnParticipant(code);
        if (cancelled) return;
        follow(own);
        if (own.status === "joined") await refreshRoster();
      } catch (failure) {
        if (cancelled) return;
        if (failure instanceof ApiError && failure.code === "participant_not_found") {
          // No longer in the meeting: either it was ended for everyone, or this browser left elsewhere.
          const meeting = await getPublicMeeting(code).catch(() => null);
          setEndedByTimeLimit(Boolean(meeting?.status === "ended" && meeting.ends_at && meeting.ended_at
            && Date.parse(meeting.ended_at) >= Date.parse(meeting.ends_at)));
          setState(meeting?.status === "ended" ? "ended" : "entry");
          setParticipants([]);
          return;
        }
        handleFailure(failure);
      }
    };
    void tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, code, state, follow, refreshRoster, handleFailure]);

  /** A host control; the backend decides whether this browser may do it. The roster is reloaded after. */
  const act = useCallback(async (participantId: number, action: HostAction) => {
    if (!code) return;
    await participantAction(code, participantId, action);
    await refreshRoster();
  }, [code, refreshRoster]);

  const rename = useCallback(async (participantId: number, name: string) => {
    if (!code) return;
    const renamed = await renameParticipant(code, participantId, name);
    if (renamed.id === me?.id) setMe(renamed);
    await refreshRoster();
  }, [code, me?.id, refreshRoster]);

  const muteEveryone = useCallback(async () => {
    if (!code) return 0;
    const { muted } = await muteAll(code);
    await refreshRoster();
    return muted;
  }, [code, refreshRoster]);

  /** Leave the meeting (or the waiting room). A host leaving passes the host role on automatically. */
  const leave = useCallback(async () => {
    if (code && (state === "waiting" || state === "in")) await leaveMeeting(code).catch(() => undefined);
  }, [code, state]);

  /** End the meeting for everyone (host only; the backend refuses anyone else). */
  const endForAll = useCallback(async () => {
    if (!code) return;
    await endMeeting(code);
    setState("ended");
  }, [code]);

  return {
    state, me, participants, error, join, act, rename, muteEveryone, leave, endForAll, isHost: me?.role === "host",
    endedByTimeLimit,
  };
}
