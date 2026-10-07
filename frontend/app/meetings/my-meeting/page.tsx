"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import JoiningMeeting from "@/components/JoiningMeeting";
import ParticipantsPanel from "@/components/ParticipantsPanel";
import ProfileMenu from "@/components/ProfileMenu";
import ReactionsMenu, { FEEDBACK, Feedback, FeedbackIcon } from "@/components/Reactions";
import ZoomLogo from "@/components/ZoomLogo";
import { useRoomSession } from "@/lib/useRoomSession";
import { getUserId, requireSignIn } from "@/lib/identity";
import { getActiveMeeting, setActiveMeeting, setRoomOpen, updateActiveMeeting } from "@/lib/activeMeeting";
import {
  BackIcon, BackgroundsIcon, BellIcon, CaretUpIcon, ChatIcon, CloseIcon, DotsIcon, EmojiIcon, EndIcon,
  FileIcon, FormatIcon, ForwardIcon, HistoryIcon, HomeIcon, HostToolsIcon, InfoIcon, MeetingsIcon, MicIcon, MicOffIcon,
  MoreIcon, ParticipantsIcon, PopOutIcon, ReactIcon, SearchIcon, SecureIcon, SendIcon, ShareArrowIcon,
  VideoIcon, VideoOffIcon, ViewIcon, WhoCanSeeIcon,
} from "@/components/RoomIcons";
import {
  ApiError,
  MeetingDetails,
  deleteMeeting,
  formatInZone,
  formatMeetingCode,
  formatMeetingId,
  getMeetingDetails,
  getPublicMeeting,
  isMeetingCode,
  removeAttachment,
  startMeeting,
  timeZonePlace,
} from "@/lib/meetings";

const CONTROLS_IDLE_MS = 2500;

/** Zoom's meeting invitation text (the Copy Invitation dialog and the in-meeting Invite dialog). */
function invitationText({ inviter, scheduled, title, time, inviteUrl, meetingId, passcode }: {
  inviter: string;
  scheduled: boolean;
  title: string;
  time: string;
  inviteUrl: string;
  meetingId: string;
  passcode: string | null;
}): string {
  const kind = scheduled ? "a scheduled Zoom meeting" : "a Zoom meeting";
  let joinInstructions = "";
  try {
    joinInstructions = `${new URL(inviteUrl).origin}/join`; // this app's Join page (Meeting ID + passcode)
  } catch {
    // no instructions link without a valid invite URL
  }
  return [
    inviter ? `${inviter} is inviting you to ${kind}.` : `You are invited to ${kind}.`,
    "",
    `Topic: ${title}`,
    ...(time ? [`Time: ${time}`] : []),
    "",
    "Join Zoom Meeting",
    inviteUrl,
    "",
    `Meeting ID: ${meetingId}`,
    ...(passcode ? [`Passcode: ${passcode}`] : []),
    ...(joinInstructions ? ["", "Join instructions", joinInstructions] : []),
  ].join("\n");
}

/** "2026-11-30T23:00:00Z" -> "20261130T230000Z" (calendar links). */
function calendarStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export default function MeetingDetailsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"details" | "attachments">("details");
  const [showPasscode, setShowPasscode] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // Meeting state (allows live editing)
  const [meetingData, setMeetingData] = useState({
    topic: "My Meeting",
    date: "2026-10-06",
    startTime: "11:30 PM",
    endTime: "12:10 AM",
    timeDisplay: "Wednesday October 7, 12:30 - 1:10 AM",
    timeZoneDisplay: "Oct 6, 2026 11:30 PM India",
    meetingId: "894 8320 6098",
    passcode: "829415",
    inviteLink: "https://us05web.zoom.us/j/89483206098?pwd=xxxx",
    hostVideo: false,
    participantVideo: false,
    allowTranscribe: true,
  });

  // Modals state
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showLiveMeeting, setShowLiveMeeting] = useState(false);

  // The real meeting, from the authorized details endpoint (the passcode only for its owner).
  const [details, setDetails] = useState<MeetingDetails | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busyAction, setBusyAction] = useState<"start" | "delete" | null>(null);

  function applyDetails(meeting: MeetingDetails) {
    setDetails(meeting);
    setMeetingData((current) => ({
      ...current,
      topic: meeting.title,
      meetingId: formatMeetingId(meeting.public_meeting_id),
      passcode: meeting.passcode ?? "",
      inviteLink: meeting.invite_url,
      hostVideo: meeting.host_video_enabled,
      participantVideo: meeting.participant_video_enabled,
    }));
  }

  // The signed-in account (null until read in the browser).
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (requireSignIn(router)) return;
    setUserId(getUserId());
    const params = new URLSearchParams(window.location.search);
    if (params.get("live") === "1") {
      setShowLiveMeeting(true);
    }
    // Always the real meeting from the backend, never the sample data.
    const code = params.get("meeting");
    if (isMeetingCode(code)) {
      setMeetingData((current) => ({ ...current, meetingId: formatMeetingCode(code), passcode: "" }));
      getMeetingDetails(code)
        .then(applyDetails)
        .catch((failure: Error) => setLoadError(failure.message));
    } else if (params.get("live") !== "1") {
      router.replace("/meetings");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live meeting state
  const [isMuted, setIsMuted] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [meetingChatOpen, setMeetingChatOpen] = useState(false);
  // Meeting Chat is a sample: messages stay in this browser and aren't sent to anyone else.
  const [chatMessages, setChatMessages] = useState<Array<{ text: string; time: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatWhoOpen, setChatWhoOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  // The signed-in user's display name (saved at sign-in); the room shows it on the host tile.
  const [hostName, setHostName] = useState("You");
  useEffect(() => {
    const saved = window.localStorage.getItem("zoom-user-name")?.trim();
    if (saved) setHostName(saved);
  }, []);
  const hostInitial = hostName.charAt(0).toUpperCase();

  // This browser in the live meeting (joined as host, waiting, ...) and the Participants panel.
  const room = useRoomSession(details, showLiveMeeting, hostName);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [entryName, setEntryName] = useState("");
  const [entryPasscode, setEntryPasscode] = useState("");
  useEffect(() => {
    const saved = window.localStorage.getItem("zoom-user-name")?.trim();
    if (saved) setEntryName((current) => current || saved);
  }, []);
  const joinedCount = room.participants.filter((p) => p.status === "joined").length;

  // While the full room is on screen the minimized window hides; leaving this page (Home,
  // Meetings) minimizes the meeting instead of leaving it.
  useEffect(() => {
    setRoomOpen(showLiveMeeting);
    return () => setRoomOpen(false);
  }, [showLiveMeeting]);

  // Remember the meeting this browser is in (for the minimized window), keeping Mute and Video
  // as they were set there; forget it once the meeting is over for this browser.
  useEffect(() => {
    if (!details) return;
    const current = getActiveMeeting();
    const same = current?.code === details.meeting_code;
    if (room.state === "in" || room.state === "waiting") {
      setActiveMeeting({
        code: details.meeting_code,
        title: details.title,
        publicId: details.public_meeting_id,
        name: room.me?.display_name ?? hostName,
        muted: same ? current.muted : isMuted,
        videoOn: same ? current.videoOn : isVideoOn,
      });
      if (same) {
        setIsMuted(current.muted);
        setIsVideoOn(current.videoOn);
      }
    } else if ((room.state === "ended" || room.state === "removed") && same) {
      setActiveMeeting(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.state, details, room.me?.display_name]);

  useEffect(() => {
    if (details && getActiveMeeting()?.code === details.meeting_code) {
      updateActiveMeeting({ muted: isMuted, videoOn: isVideoOn });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted, isVideoOn]);
  const myName = room.me?.display_name ?? hostName;
  const showHostBadge = room.me ? room.isHost : true;

  // Gallery: a tile for everyone in the room (not the waiting room), from the roster;
  // just this browser's tile until the roster has loaded (or outside a real meeting).
  const inRoom = room.participants.filter((p) => p.status === "joined");
  const tiles = room.state === "in" && inRoom.length > 0
    ? inRoom.map((p) => {
        const mine = p.id === room.me?.id;
        return { id: p.id, name: mine ? myName : p.display_name, muted: mine ? isMuted : p.is_muted, host: p.role === "host", mine };
      })
    : [{ id: 0, name: myName, muted: isMuted, host: showHostBadge, mine: true }];
  const galleryColumns = Math.ceil(Math.sqrt(tiles.length));
  const galleryRows = Math.ceil(tiles.length / galleryColumns);

  const submitEntry = (event: React.FormEvent) => {
    event.preventDefault();
    const name = entryName.trim();
    if (!name || (details?.passcode_required && !entryPasscode.trim())) return;
    void room.join(name, details?.passcode_required ? entryPasscode.trim() : null, false);
  };

  // The End button: "End meeting for all" (host) or "Leave meeting" (anyone; a leaving host
  // hands the host role on automatically). Both go back to Home afterwards.
  const [endMenuPos, setEndMenuPos] = useState<{ right: number; bottom: number } | null>(null);
  const [ending, setEnding] = useState(false);
  const endButtonRef = useRef<HTMLButtonElement>(null);
  const endMenuRef = useRef<HTMLDivElement>(null);

  const toggleEndMenu = () => {
    if (!room.me) {
      setShowLiveMeeting(false); // not joined (sample room): nothing to end or leave
      return;
    }
    if (endMenuPos) {
      setEndMenuPos(null);
      return;
    }
    const rect = endButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setEndMenuPos({
      right: Math.max(8, window.innerWidth - rect.right),
      bottom: window.innerHeight - rect.top + 10,
    });
  };

  const leaveRoom = async () => {
    if (ending) return;
    setEnding(true);
    setEndMenuPos(null);
    await room.leave();
    setActiveMeeting(null);
    router.push("/");
  };

  const endForAll = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await room.endForAll();
      setActiveMeeting(null);
      router.push("/");
    } catch (failure) {
      setEnding(false);
      setEndMenuPos(null);
      showRoomNotice(failure instanceof Error ? failure.message : "Couldn't end the meeting.");
    }
  };

  useEffect(() => {
    if (!endMenuPos) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      const target = event.target as Node;
      if (event instanceof PointerEvent && (endMenuRef.current?.contains(target) || endButtonRef.current?.contains(target))) return;
      setEndMenuPos(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    endMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [endMenuPos]);

  // The left rail: Home and Meetings open those pages (the meeting stays live and can be
  // rejoined from Upcoming or its link); Chat opens this meeting's chat.
  const openRoomChat = () => {
    if (room.me && room.state !== "in") {
      showRoomNotice("This is available once you are in the meeting.");
      return;
    }
    setMeetingChatOpen(!meetingChatOpen);
    setParticipantsOpen(false);
  };

  // Invite (Participants caret): menu, dialog and an in-room confirmation
  const [inviteMenuPos, setInviteMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteTab, setInviteTab] = useState<"contacts" | "rooms" | "email">("contacts");
  const [inviteSearch, setInviteSearch] = useState("");
  const [roomNotice, setRoomNotice] = useState<string | null>(null);
  const inviteCaretRef = useRef<HTMLButtonElement>(null);
  const inviteMenuRef = useRef<HTMLDivElement>(null);

  const showRoomNotice = (msg: string) => {
    setRoomNotice(msg);
    setTimeout(() => setRoomNotice(null), 2500);
  };

  const copyForRoom = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showRoomNotice(label);
    } catch {
      showRoomNotice("Couldn't copy. Please try again.");
    }
  };

  const toggleInviteMenu = () => {
    if (inviteMenuPos) {
      setInviteMenuPos(null);
      return;
    }
    const rect = inviteCaretRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Fixed position above the caret, kept inside the viewport.
    setInviteMenuPos({
      left: Math.max(8, Math.min(rect.left - 10, window.innerWidth - 188)),
      bottom: window.innerHeight - rect.top + 6,
    });
  };

  const openInviteDialog = () => {
    setInviteMenuPos(null);
    setInviteTab("contacts");
    setInviteSearch("");
    setShowInviteDialog(true);
  };

  useEffect(() => {
    if (!inviteMenuPos && !showInviteDialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (showInviteDialog) setShowInviteDialog(false);
      else {
        setInviteMenuPos(null);
        inviteCaretRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (inviteMenuRef.current?.contains(target) || inviteCaretRef.current?.contains(target)) return;
      setInviteMenuPos(null);
    };
    document.addEventListener("keydown", onKey);
    if (inviteMenuPos) document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [inviteMenuPos, showInviteDialog]);

  useEffect(() => {
    if (inviteMenuPos) inviteMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [inviteMenuPos]);

  // Meeting controls dock: slides in on pointer activity and out after the pointer
  // has been idle, unless the pointer or keyboard focus is on it or one of its menus is open.
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimer = useRef<number | null>(null);
  const pointerOnToolbar = useRef(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // React menu: emoji reactions, nonverbal feedback, Raise Hand and Be right back (this screen only).
  const [reactMenuPos, setReactMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  const reactButtonRef = useRef<HTMLButtonElement>(null);
  const reactMenuRef = useRef<HTMLDivElement>(null);
  const [handRaised, setHandRaised] = useState(false);
  const [myStatus, setMyStatus] = useState<Feedback | "brb" | null>(null);
  const [tileEmoji, setTileEmoji] = useState<string | null>(null);
  const tileEmojiTimer = useRef<number | null>(null);
  const [floaters, setFloaters] = useState<Array<{ id: number; emoji: string; left: number }>>([]);
  const floaterId = useRef(0);

  const keepControls = inviteMenuPos !== null || showInviteDialog || endMenuPos !== null || reactMenuPos !== null;

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current !== null) window.clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = window.setTimeout(() => {
      const focused = document.activeElement;
      const keyboardOnToolbar =
        focused instanceof HTMLElement && toolbarRef.current?.contains(focused) && focused.matches(":focus-visible");
      if (!pointerOnToolbar.current && !keyboardOnToolbar) setControlsVisible(false);
    }, CONTROLS_IDLE_MS);
  }, []);

  // Restart the idle countdown when the room opens and whenever a menu or dialog closes.
  useEffect(() => {
    if (showLiveMeeting && !keepControls) revealControls();
  }, [showLiveMeeting, keepControls, revealControls]);

  useEffect(() => () => {
    if (hideControlsTimer.current !== null) window.clearTimeout(hideControlsTimer.current);
    if (tileEmojiTimer.current !== null) window.clearTimeout(tileEmojiTimer.current);
  }, []);

  const toggleReactMenu = () => {
    if (reactMenuPos) {
      setReactMenuPos(null);
      return;
    }
    const rect = reactButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const half = Math.min(208, (window.innerWidth - 16) / 2);
    setReactMenuPos({
      left: Math.min(Math.max(rect.left + rect.width / 2, half + 8), window.innerWidth - half - 8),
      bottom: window.innerHeight - rect.top + 10,
    });
  };

  useEffect(() => {
    if (!reactMenuPos) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      const target = event.target as Node;
      if (event instanceof PointerEvent
        && (reactMenuRef.current?.contains(target) || reactButtonRef.current?.contains(target))) return;
      setReactMenuPos(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [reactMenuPos]);

  // An emoji floats up the screen with a "You" label and shows on your tile for 10 seconds.
  const sendReaction = (emoji: string) => {
    setReactMenuPos(null);
    setTileEmoji(emoji);
    if (tileEmojiTimer.current !== null) window.clearTimeout(tileEmojiTimer.current);
    tileEmojiTimer.current = window.setTimeout(() => setTileEmoji(null), 10_000);
    floaterId.current += 1;
    const id = floaterId.current;
    setFloaters((current) => [...current, { id, emoji, left: 4 + Math.random() * 8 }]);
    // Removed when its animation ends; this also covers a hidden tab, where animations do not run.
    window.setTimeout(() => setFloaters((current) => current.filter((f) => f.id !== id)), 4500);
  };
  const chooseStatus = (status: Feedback | "brb") => {
    setReactMenuPos(null);
    setMyStatus((current) => (current === status ? null : status));
  };
  const feedbackLabel = (kind: Feedback) => FEEDBACK.find((f) => f.id === kind)?.label ?? "";

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const copyToClipboard = (text: string, label: string = "Copied to clipboard!") => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showToast(label);
    }
  };

  // When the meeting is, on its own time zone's clock ("Oct 7, 2026 04:30 AM India").
  const startIso = details?.scheduled_start_at ?? details?.started_at ?? null;
  const meetingTime = details && startIso ? `${formatInZone(startIso, details.timezone)} ${timeZonePlace(details.timezone)}` : "";
  const startDate = details?.scheduled_start_at ? new Date(details.scheduled_start_at) : null;
  const endDate = startDate && details?.duration_minutes
    ? new Date(startDate.getTime() + details.duration_minutes * 60_000)
    : null;
  const timeRange = details && startDate && endDate
    ? `${new Intl.DateTimeFormat("en-US", { timeZone: details.timezone, weekday: "long", month: "long", day: "numeric" })
      .format(startDate).replace(",", "")}, ${formatInZone(startDate.toISOString(), details.timezone, false)}`
      + ` - ${formatInZone(endDate.toISOString(), details.timezone, false)}`
    : "";

  // Manage page invitation: the current meeting's real title, time, ID, passcode and link.
  const fullInvitationText = details
    ? invitationText({
        inviter: room.me?.display_name ?? hostName,
        scheduled: details.meeting_type === "scheduled",
        title: details.title,
        time: meetingTime,
        inviteUrl: details.invite_url,
        meetingId: formatMeetingId(details.public_meeting_id),
        passcode: details.passcode,
      })
    : "";

  // Calendar links, built from the saved plan (nothing is stored for them).
  const handleGoogleCalendar = () => {
    if (!details || !startDate || !endDate) return;
    const title = encodeURIComponent(details.title);
    const text = encodeURIComponent(fullInvitationText);
    const location = encodeURIComponent(details.invite_url);
    const dates = `${calendarStamp(startDate)}/${calendarStamp(endDate)}`;
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${text}&location=${location}&dates=${dates}`;
    window.open(url, "_blank");
  };

  const handleOutlookIcs = () => {
    if (!details || !startDate || !endDate) return;
    const icsData = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Zoom Replica//Meeting Scheduler//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      `UID:${details.meeting_code}@zoom-replica`,
      `DTSTAMP:${calendarStamp(new Date())}`,
      `SUMMARY:${details.title}`,
      `DESCRIPTION:${fullInvitationText.replace(/\n/g, "\\n")}`,
      `LOCATION:${details.invite_url}`,
      `DTSTART:${calendarStamp(startDate)}`,
      `DTEND:${calendarStamp(endDate)}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const blob = new Blob([icsData], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${details.title.replace(/\s+/g, "_")}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Downloaded Outlook (.ics) Calendar file");
  };

  const handleYahooCalendar = () => {
    if (!details || !startDate || !details.duration_minutes) return;
    const title = encodeURIComponent(details.title);
    const desc = encodeURIComponent(fullInvitationText);
    const loc = encodeURIComponent(details.invite_url);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dur = `${pad(Math.floor(details.duration_minutes / 60))}${pad(details.duration_minutes % 60)}`;
    const url = `https://calendar.yahoo.com/?v=60&view=d&type=20&title=${title}&st=${calendarStamp(startDate)}&dur=${dur}&desc=${desc}&in_loc=${loc}`;
    window.open(url, "_blank");
  };

  // The live room's invitation: only the current meeting's real ID, passcode and link.
  const roomInvitationText = fullInvitationText || invitationText({
    inviter: hostName,
    scheduled: false,
    title: meetingData.topic,
    time: "",
    inviteUrl: meetingData.inviteLink,
    meetingId: meetingData.meetingId,
    passcode: meetingData.passcode || null,
  });

  const openInvitationEmail = (provider: "default" | "gmail" | "yahoo") => {
    const subject = encodeURIComponent(`Invitation to join: ${meetingData.topic}`);
    const body = encodeURIComponent(roomInvitationText);
    const url =
      provider === "gmail"
        ? `https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`
        : provider === "yahoo"
          ? `https://compose.mail.yahoo.com/?subject=${subject}&body=${body}`
          : `mailto:?subject=${subject}&body=${body}`;
    window.open(url, provider === "default" ? "_self" : "_blank");
  };

  const handleStart = async () => {
    if (!details || busyAction) return;
    setBusyAction("start");
    try {
      if (details.status === "scheduled") applyDetails(await startMeeting(details.meeting_code));
      router.replace(`/meetings/my-meeting?live=1&meeting=${details.meeting_code}`);
      setShowLiveMeeting(true);
    } catch (failure) {
      showToast(failure instanceof Error ? failure.message : "Couldn't start the meeting.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteMeeting = async () => {
    if (!details || busyAction) return;
    setBusyAction("delete");
    try {
      await deleteMeeting(details.meeting_code);
      router.push("/meetings");
    } catch (failure) {
      setBusyAction(null);
      setShowDeleteModal(false);
      // A meeting in progress cannot be deleted (upcoming and ended ones can).
      setErrorToast(
        failure instanceof ApiError && failure.code === "meeting_already_started"
          ? "Sorry, you cannot delete this meeting since it's in progress."
          : failure instanceof Error ? failure.message : "Couldn't delete the meeting.",
      );
      window.setTimeout(() => setErrorToast(null), 4000);
    }
  };

  const handleDeleteAttachment = async (id: number, title: string) => {
    if (!details) return;
    try {
      await removeAttachment(details.meeting_code, id);
      applyDetails(await getMeetingDetails(details.meeting_code));
      showToast(`Removed "${title}"`);
    } catch (failure) {
      showToast(failure instanceof Error ? failure.message : "Couldn't remove the attachment.");
    }
  };

  const isScheduled = details?.status === "scheduled";

  const handleSendChat = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setChatMessages((prev) => [
      ...prev,
      { text, time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) },
    ]);
    setChatInput("");
  };

  // The (i) Meeting information popover closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!infoOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && infoRef.current?.contains(event.target as Node)) return;
      setInfoOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [infoOpen]);
  const currentHost = room.participants.find((p) => p.role === "host" && p.status === "joined");
  const hostLabel = currentHost
    ? (currentHost.id === room.me?.id ? myName : currentHost.display_name)
    : (room.me ? "" : hostName);
  // Time limit (scheduled: its duration; instant: 40 minutes): in the last 10 minutes the host
  // sees a countdown and a warning, again in the last minute; then the meeting ends for everyone.
  const endsAt = details?.ends_at ? Date.parse(details.ends_at) : null;
  const warnHost = showLiveMeeting && room.state === "in" && room.isHost && endsAt !== null;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!warnHost) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [warnHost]);
  const msLeft = warnHost && endsAt !== null ? Math.max(0, endsAt - clock) : null;
  const limitStage = msLeft === null || msLeft > 10 * 60_000 ? null : msLeft <= 60_000 ? "last-minute" : "ten-minutes";
  const [limitDismissed, setLimitDismissed] = useState<string | null>(null);
  const minutesLeft = msLeft === null ? 0 : Math.max(1, Math.ceil(msLeft / 60_000));
  const limitBanner = limitStage && limitDismissed !== limitStage
    ? `This meeting will end in ${minutesLeft} ${minutesLeft === 1 ? "minute" : "minutes"}. ${
      details?.meeting_type === "scheduled"
        ? "Scheduled meetings end when their duration is up."
        : "Instant meetings end after 40 minutes."}`
    : null;
  const countdown = msLeft === null || limitStage === null
    ? null
    : `${String(Math.floor(msLeft / 60_000)).padStart(2, "0")}:${String(Math.floor((msLeft % 60_000) / 1000)).padStart(2, "0")}`;

  // A meeting started after this page loaded its details: fetch them again for the end time.
  useEffect(() => {
    if (room.state === "in" && details && !details.ends_at) {
      getMeetingDetails(details.meeting_code).then(applyDetails).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.state]);

  // A scheduled meeting the host has not started yet: guests see "Waiting for the host to start
  // this meeting", and the join screen appears by itself once it starts (checked every 5 seconds).
  const isOwner = details !== null && userId !== null && String(details.host_id) === userId;
  const waitingForHost = showLiveMeeting && details?.status === "scheduled" && userId !== null && !isOwner
    && (room.state === "entry" || room.state === "loading");
  const meetingOver = showLiveMeeting && !isOwner && (details?.status === "ended" || details?.status === "cancelled")
    && (room.state === "entry" || room.state === "loading");
  useEffect(() => {
    if (!waitingForHost || !details) return;
    const code = details.meeting_code;
    const timer = window.setInterval(async () => {
      const meeting = await getPublicMeeting(code).catch(() => null);
      if (meeting && meeting.status !== "scheduled") {
        getMeetingDetails(code).then(applyDetails).catch(() => undefined);
      }
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForHost, details?.meeting_code]);

  const entryReady = entryName.trim() !== "" && (!details?.passcode_required || entryPasscode.trim() !== "");

  return (
    <div className="meeting-details-layout">
      <Sidebar full />

      <main className="meeting-details-main">
        {/* Toast alert */}
        {toastMessage && (
          <div className="zoom-toast">
            <span className="toast-icon">✓</span>
            {toastMessage}
          </div>
        )}
        {errorToast && (
          <div className="zoom-error-toast" role="alert">
            <span className="zoom-error-toast-icon" aria-hidden="true">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
                <path d="M2 2l6 6M8 2L2 8" />
              </svg>
            </span>
            {errorToast}
          </div>
        )}

        {/* Breadcrumb */}
        <div className="details-breadcrumb">
          <Link href="/meetings">My Meetings</Link>
          <span className="breadcrumb-separator">›</span>
          <span className="breadcrumb-current">{details ? `Manage "${details.title}"` : "Manage Meeting"}</span>
        </div>

        {/* Tabs: Details | Attachments */}
        <div className="details-tabs-container">
          <button
            className={`details-tab-btn ${activeTab === "details" ? "active" : ""}`}
            onClick={() => setActiveTab("details")}
            id="tab-details-btn"
          >
            Details
          </button>

          <button
            className={`details-tab-btn ${activeTab === "attachments" ? "active" : ""}`}
            onClick={() => setActiveTab("attachments")}
            id="tab-attachments-btn"
          >
            Attachments
          </button>
        </div>

        {/* =========================================================
            DETAILS TAB VIEW (Matches Image 2)
        ========================================================= */}
        {activeTab === "details" && (
          <div className="details-content-wrapper">
            {!details ? (
              <p className="details-status" role={loadError ? "alert" : "status"}>
                {loadError || "Loading meeting…"}
                {loadError && <> <Link href="/meetings">Back to Meetings</Link></>}
              </p>
            ) : (
            <div className="details-table">
              {/* Topic */}
              <div className="detail-row">
                <div className="detail-label">Topic</div>
                <div className="detail-value font-medium">{details.title}</div>
              </div>

              {details.description && (
                <div className="detail-row">
                  <div className="detail-label">Description</div>
                  <div className="detail-value detail-description">{details.description}</div>
                </div>
              )}

              {/* Time */}
              <div className="detail-row">
                <div className="detail-label">Time</div>
                <div className="detail-value">{meetingTime}</div>
              </div>

              {/* Meeting ID */}
              <div className="detail-row">
                <div className="detail-label">Meeting ID</div>
                <div className="detail-value font-mono">
                  {formatMeetingId(details.public_meeting_id)}
                </div>
              </div>

              {/* Security */}
              <div className="detail-row">
                <div className="detail-label">Security</div>
                <div className="detail-value security-list">
                  {details.has_passcode ? (
                    <div className="security-row">
                      <span className="check-icon">✓</span>
                      <span className="security-label">Passcode</span>
                      <span className="passcode-display">
                        {showPasscode && details.passcode ? details.passcode : "********"}
                      </span>
                      {details.passcode && (
                        <button
                          type="button"
                          className="link-btn text-blue-600"
                          onClick={() => setShowPasscode(!showPasscode)}
                        >
                          {showPasscode ? "Hide" : "Show"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="security-row"><span className="security-label">No passcode</span></div>
                  )}
                  {details.waiting_room_enabled && (
                    <div className="security-row">
                      <span className="check-icon">✓</span>
                      <span className="security-label">Waiting Room</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Invite Link */}
              <div className="detail-row">
                <div className="detail-label">Invite Link</div>
                <div className="detail-value invite-link-row">
                  <a
                    href={details.invite_url}
                    target="_blank"
                    rel="noreferrer"
                    className="invite-url"
                  >
                    {details.invite_url}
                  </a>
                  <button
                    type="button"
                    className="icon-copy-btn"
                    title="Copy Invite Link"
                    onClick={() => copyToClipboard(details.invite_url, "Invite link copied to clipboard!")}
                    aria-label="Copy Invite Link"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Add to Calendars */}
              {startDate && (
              <div className="detail-row">
                <div className="detail-label">Add to</div>
                <div className="calendar-links-row">
                  <button
                    type="button"
                    onClick={handleGoogleCalendar}
                    className="calendar-btn google-cal"
                  >
                    <svg className="cal-svg" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                      <rect x="1" y="1" width="18" height="18" rx="3" fill="#fff" stroke="#4285F4" strokeWidth="1.5" />
                      <rect x="1" y="1" width="18" height="5" rx="2" fill="#4285F4" />
                      <text x="10" y="16" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#4285F4">31</text>
                    </svg>
                    Google Calendar
                  </button>

                  <button
                    type="button"
                    onClick={handleOutlookIcs}
                    className="calendar-btn outlook-cal"
                  >
                    <svg className="cal-svg" width="22" height="20" viewBox="0 0 22 20" aria-hidden="true">
                      <rect x="8" y="3" width="13" height="14" rx="1.5" fill="#28A8EA" />
                      <path d="M8 6l6.5 4.5L21 6" fill="none" stroke="#fff" strokeWidth="1.2" />
                      <rect x="1" y="2" width="11" height="16" rx="1.5" fill="#0364B8" />
                      <ellipse cx="6.5" cy="10" rx="2.6" ry="3.4" fill="none" stroke="#fff" strokeWidth="1.6" />
                    </svg>
                    Outlook Calendar (.ics)
                  </button>

                  <button
                    type="button"
                    onClick={handleYahooCalendar}
                    className="calendar-btn yahoo-cal"
                  >
                    <svg className="cal-svg" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="10" cy="10" r="9" fill="#6001D2" />
                      <text x="9.5" y="13.5" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#fff">Y!</text>
                    </svg>
                    Yahoo Calendar
                  </button>
                </div>
              </div>
              )}

              {/* Divider */}
              <div className="detail-divider" />

              {/* Encryption */}
              <div className="detail-row">
                <div className="detail-label">Encryption</div>
                <div className="detail-value encryption-row">
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shield-svg">
                    <path d="M12 2l8 3.2v6c0 5-3.4 8.9-8 10.8-4.6-1.9-8-5.8-8-10.8v-6z" fill="#12A150" />
                    <path d="M8.2 12.2l2.6 2.6 5-5.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {details.encryption_mode === "end_to_end" ? "End-to-end encryption" : "Enhanced encryption"}
                </div>
              </div>

              {/* My Notes */}
              <div className="detail-row">
                <div className="detail-label">My Notes</div>
                <div className="detail-value notes-block">
                  {details.notes_enabled ? (
                    <>
                      <div className="notes-heading">
                        Allow participants to transcribe meeting with My Notes
                      </div>
                      <div className="notes-sub">
                        {details.notes_scope === "organization_only"
                          ? "Only participants in your organization"
                          : "All participants"}
                      </div>
                    </>
                  ) : (
                    <div className="notes-heading">Off</div>
                  )}
                </div>
              </div>

              {/* Video */}
              <div className="detail-row">
                <div className="detail-label">Video</div>
                <div className="video-settings-grid">
                  <div className="video-item">
                    <span className="video-role">Host</span>
                    <span className="video-status">{details.host_video_enabled ? "on" : "off"}</span>
                  </div>
                  <div className="video-item">
                    <span className="video-role">Participant</span>
                    <span className="video-status">{details.participant_video_enabled ? "on" : "off"}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="detail-action-buttons">
                <button
                  type="button"
                  className="btn-start-meeting"
                  onClick={handleStart}
                  disabled={!(isScheduled || details.status === "live") || busyAction !== null}
                  aria-busy={busyAction === "start"}
                  id="btn-start-meeting"
                >
                  Start
                </button>

                <button
                  type="button"
                  className="btn-outline-action"
                  onClick={() => setShowCopyModal(true)}
                  id="btn-copy-invitation"
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M7 1.5h10A1.5 1.5 0 0 1 18.5 3v10a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 13V3A1.5 1.5 0 0 1 7 1.5z" />
                    <path d="M2 6.5h2V15a1.5 1.5 0 0 0 1.5 1.5H14v2H3.5A1.5 1.5 0 0 1 2 17z" />
                  </svg>
                  Copy Invitation
                </button>

                <button
                  type="button"
                  className="btn-outline-action"
                  onClick={() => router.push(`/schedule?meeting=${details.meeting_code}`)}
                  disabled={!isScheduled}
                  id="btn-edit-meeting"
                >
                  Edit
                </button>

                <button
                  type="button"
                  className="btn-outline-action btn-delete-action"
                  onClick={() => setShowDeleteModal(true)}
                  id="btn-delete-meeting"
                >
                  Delete
                </button>

                <button
                  type="button"
                  className="btn-outline-action btn-save-template"
                  onClick={() => showToast("Saving as a template isn't available yet.")}
                >
                  Save as Template
                </button>
              </div>
            </div>
            )}
          </div>
        )}

        {/* =========================================================
            ATTACHMENTS TAB VIEW (whiteboards and docs saved with the meeting)
        ========================================================= */}
        {activeTab === "attachments" && details && (
          <div className="attachments-content-wrapper">
            <div className="attachment-header-banner">
              <div className="meeting-date-range">
                {timeRange || meetingTime}
              </div>
              <h1 className="meeting-title-large">
                {details.title}
              </h1>
            </div>

            <div className="detail-divider" />

            <div className={`attachments-section ${details.attachments.length ? "has-attachments" : ""}`}>
              <div className="attachments-toolbar">
                <div>
                  <h2 className="attachments-section-title">Meeting Attachments</h2>
                  <p className="attachments-section-subtitle">
                    Whiteboards and docs attached to this meeting. Add more with Edit.
                  </p>
                </div>
              </div>

              {details.attachments.length > 0 ? (
                <div className="attachments-list">
                  {details.attachments.map((item) => (
                    <div key={item.id} className="attachment-card">
                      <div className="attachment-file-icon">
                        {item.kind === "doc"
                          ? <span className="type-badge badge-doc">DOC</span>
                          : <span className="type-badge badge-other">WB</span>}
                      </div>

                      <div className="attachment-info">
                        <div className="attachment-name">{item.title}</div>
                        <div className="attachment-meta">
                          <span>{item.kind === "doc" ? "Doc" : "Whiteboard"}</span>
                          <span>•</span>
                          <span>Added {formatInZone(item.created_at, details.timezone)}</span>
                        </div>
                      </div>

                      {isScheduled && (
                        <div className="attachment-actions">
                          <button
                            type="button"
                            className="attachment-btn delete-btn"
                            title="Remove"
                            aria-label={`Remove ${item.title}`}
                            onClick={() => handleDeleteAttachment(item.id, item.title)}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-attachments">
                  <p>No attachments yet for this meeting.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =========================================================
            MODAL: COPY INVITATION
        ========================================================= */}
        {showCopyModal && (
          <div className="zoom-modal-backdrop" onClick={() => setShowCopyModal(false)}>
            <div
              className="copy-invite-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="copy-invite-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="copy-invite-title">Copy Meeting Invitation</h3>
              <textarea
                readOnly
                className="copy-invite-text"
                value={fullInvitationText}
                rows={14}
                aria-label="Meeting invitation"
              />
              <div className="copy-invite-buttons">
                <button
                  type="button"
                  className="copy-invite-primary"
                  onClick={() => {
                    copyToClipboard(fullInvitationText, "Meeting invitation copied to clipboard!");
                    setShowCopyModal(false);
                  }}
                >
                  Copy Meeting Invitation
                </button>
                <button type="button" className="copy-invite-cancel" onClick={() => setShowCopyModal(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            MODAL: DELETE MEETING
        ========================================================= */}
        {showDeleteModal && (
          <div className="zoom-modal-backdrop delete-backdrop" onClick={() => setShowDeleteModal(false)}>
            <div
              className="delete-meeting-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-meeting-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="delete-meeting-title">Delete Meeting</h3>
              <p>You can&apos;t recover this meeting once it&apos;s deleted.</p>
              <div className="delete-meeting-buttons">
                <button
                  type="button"
                  className="delete-meeting-confirm"
                  onClick={handleDeleteMeeting}
                  disabled={busyAction === "delete"}
                  aria-busy={busyAction === "delete"}
                >
                  Delete
                </button>
                <button type="button" className="delete-meeting-cancel" onClick={() => setShowDeleteModal(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            LIVE MEETING ROOM SIMULATION
        ========================================================= */}
        {showLiveMeeting && (
          <div className="live-meeting-overlay">
            <header className="zw-header">
              <div className="zw-brand">
                <span className="zw-logo"><ZoomLogo height={20} /></span>
                <span className="zw-product">Workplace</span>
              </div>
              <div className="zw-history" aria-hidden="true">
                <BackIcon size={18} />
                <ForwardIcon size={18} />
                <HistoryIcon size={18} />
              </div>
              <div className="zw-search" aria-hidden="true">
                <SearchIcon size={16} />
                <span className="zw-search-text">Search</span>
                <kbd>Ctrl+K</kbd>
              </div>
              <div className="zw-actions">
                <span className="zw-link">Admin Center</span>
                <span className="zw-link">Download</span>
                <span className="zw-upgrade">Upgrade</span>
                <span className="zw-bell" aria-hidden="true"><BellIcon size={20} /></span>
                <span className="zw-avatar" title={hostName}>{hostInitial}</span>
              </div>
            </header>

            <div className="zw-body">
              <nav className="zw-rail" aria-label="Workplace">
                <button type="button" className="zw-rail-item" onClick={() => router.push("/")}>
                  <HomeIcon /><span>Home</span>
                </button>
                <button
                  type="button"
                  className={`zw-rail-item ${meetingChatOpen ? "is-active" : ""}`}
                  aria-pressed={meetingChatOpen}
                  onClick={openRoomChat}
                >
                  <ChatIcon /><span>Chat</span>
                </button>
                <button
                  type="button"
                  className={`zw-rail-item ${meetingChatOpen || participantsOpen ? "" : "is-active"}`}
                  onClick={() => router.push("/meetings")}
                >
                  <MeetingsIcon /><span>Meetings</span>
                </button>
                <ProfileMenu initial={hostInitial} variant="settings" />
              </nav>

              <section className="zr-room" aria-label="Meeting">
                {/* Meeting header */}
                <div className="zr-header">
                  <div className="zr-info" ref={infoRef}>
                    <h1 className="zr-title">
                      <button
                        type="button"
                        className="zr-info-btn"
                        aria-expanded={infoOpen}
                        aria-haspopup="dialog"
                        onClick={() => setInfoOpen((open) => !open)}
                      >
                        <InfoIcon size={18} />
                        <span>{meetingData.topic}</span>
                      </button>
                    </h1>
                    {infoOpen && (
                      <div className="zr-info-pop" role="dialog" aria-label="Meeting information">
                        <h2>{meetingData.topic}</h2>
                        <dl>
                          <dt>Meeting ID</dt>
                          <dd>{meetingData.meetingId}</dd>
                          {hostLabel && (
                            <>
                              <dt>Host</dt>
                              <dd>{hostLabel}</dd>
                            </>
                          )}
                          <dt>Invite Link</dt>
                          <dd className="zr-info-link">{meetingData.inviteLink}</dd>
                          <dt>Encryption</dt>
                          <dd className="zr-info-secure"><SecureIcon size={16} /> Enabled</dd>
                        </dl>
                        <button
                          type="button"
                          className="zr-info-copy"
                          onClick={() => void copyForRoom(meetingData.inviteLink, "Invite link copied")}
                        >
                          Copy Link
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="zr-header-end">
                    {countdown && (
                      <span className="zr-countdown" role="timer" aria-label={`Meeting ends in ${countdown}`}>
                        Ends in {countdown}
                      </span>
                    )}
                    <span className="zr-secure" title="This meeting is encrypted">
                      <SecureIcon />
                      <span className="sr-only">This meeting is encrypted</span>
                    </span>
                    <span className="zr-header-divider" aria-hidden="true" />
                    <button
                      type="button"
                      className="zr-view-btn"
                      aria-label="View"
                      onClick={() => showRoomNotice("You're in Gallery view.")}
                    >
                      <ViewIcon size={20} />
                    </button>
                  </div>
                </div>

                {waitingForHost && details ? (
                  <div className="zr-lobby zr-wait-host" role="status">
                    <span className="zr-joining-spinner" aria-hidden="true" />
                    <h2>Waiting for the host to start this meeting</h2>
                    <p className="zr-wait-topic">{details.title}</p>
                    {details.scheduled_start_at && (
                      <p>
                        {formatInZone(details.scheduled_start_at, details.timezone)} ({timeZonePlace(details.timezone)})
                      </p>
                    )}
                    <p className="zr-wait-note">This page moves on by itself when the host starts the meeting.</p>
                    <p className="zr-wait-note">
                      If you are the host, <Link href={`/signin?next=${encodeURIComponent(`/meetings/my-meeting?meeting=${details.meeting_code}`)}`}>sign in</Link> to start this meeting.
                    </p>
                    <button type="button" className="zr-lobby-leave" onClick={() => router.push("/")}>Leave</button>
                  </div>
                ) : meetingOver ? (
                  <div className="zr-lobby" role="status">
                    <h2>This meeting has ended</h2>
                    <p>{meetingData.topic}</p>
                    <button type="button" className="zr-lobby-leave" onClick={() => router.push("/")}>OK</button>
                  </div>
                ) : room.state === "joining" || (room.state === "loading" && details !== null && !loadError) ? (
                  <JoiningMeeting />
                ) : (room.state === "entry" || room.state === "waiting" || room.state === "removed"
                  || room.state === "ended") ? (
                  <div
                    className={`zr-lobby ${room.state === "entry" ? "is-entry" : ""}`}
                    role={room.state === "entry" ? undefined : "status"}
                  >
                    {room.state === "waiting" && (
                      <>
                        <h2>Please wait, the meeting host will let you in soon.</h2>
                        <p>{meetingData.topic}</p>
                        <button type="button" className="zr-lobby-leave" onClick={leaveRoom}>Leave</button>
                      </>
                    )}
                    {room.state === "ended" && (
                      <>
                        <h2>
                          {room.endedByTimeLimit
                            ? "This meeting has ended because it reached its time limit"
                            : "This meeting has been ended by host"}
                        </h2>
                        <p>{meetingData.topic}</p>
                        <button type="button" className="zr-lobby-leave" onClick={() => router.push("/")}>OK</button>
                      </>
                    )}
                    {room.state === "removed" && (
                      <>
                        <h2>You have been removed from this meeting by the host.</h2>
                        <button type="button" className="zr-lobby-leave" onClick={() => setShowLiveMeeting(false)}>OK</button>
                      </>
                    )}
                    {room.state === "entry" && (
                      <div className="zj">
                        <div className="zj-preview">
                          <div className="zj-avatar" aria-hidden="true">
                            {(entryName.trim() || "?").charAt(0).toUpperCase()}
                          </div>
                          <div className="zj-controls">
                            <button
                              type="button"
                              className={`zj-ctrl ${isMuted ? "is-off" : ""}`}
                              aria-pressed={!isMuted}
                              onClick={() => setIsMuted(!isMuted)}
                            >
                              {isMuted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
                              <span>{isMuted ? "Unmute" : "Mute"}</span>
                              <CaretUpIcon className="zj-caret" />
                            </button>
                            <button
                              type="button"
                              className={`zj-ctrl ${isVideoOn ? "" : "is-off"}`}
                              aria-pressed={isVideoOn}
                              onClick={() => setIsVideoOn(!isVideoOn)}
                            >
                              {isVideoOn ? <VideoIcon size={22} /> : <VideoOffIcon size={22} />}
                              <span>{isVideoOn ? "Stop Video" : "Start Video"}</span>
                              <CaretUpIcon className="zj-caret" />
                            </button>
                            <button
                              type="button"
                              className="zj-ctrl zj-backgrounds"
                              onClick={() => showRoomNotice("Backgrounds aren't available yet.")}
                            >
                              <BackgroundsIcon size={22} />
                              <span>Backgrounds</span>
                            </button>
                          </div>
                        </div>

                        <form className="zj-form" onSubmit={submitEntry} noValidate>
                          <h2>Enter Meeting Info</h2>
                          {details?.passcode_required && (
                            <>
                              <label htmlFor="zj-passcode">Meeting Passcode</label>
                              <input
                                id="zj-passcode"
                                value={entryPasscode}
                                onChange={(e) => setEntryPasscode(e.target.value)}
                                placeholder="Meeting Passcode"
                                autoComplete="off"
                                autoFocus
                              />
                            </>
                          )}
                          <label htmlFor="zj-name">Your Name</label>
                          <input
                            id="zj-name"
                            value={entryName}
                            onChange={(e) => setEntryName(e.target.value)}
                            placeholder="Your Name"
                            maxLength={64}
                            autoComplete="name"
                            autoFocus={!details?.passcode_required}
                          />
                          {room.error && <p className="zj-error" role="alert">{room.error}</p>}
                          <button type="submit" disabled={!entryReady}>
                            Join
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                ) : (
                <div className="zr-stage">
                  {/* Canvas; the controls dock overlays its bottom edge */}
                  <div className="zr-main" onPointerMove={revealControls} onPointerDown={revealControls}>
                    <div className="zr-canvas">
                      <div
                        className="zr-canvas-fit"
                        style={{ "--cols": galleryColumns, "--rows": galleryRows } as React.CSSProperties}
                      >
                        {tiles.map((tile) => (
                          <div key={tile.id} className={`zr-tile ${tile.mine ? "is-speaking" : ""}`}>
                            {tile.mine && (handRaised || myStatus || tileEmoji) && (
                              <div className="zrx-tile-status" aria-hidden="true">
                                {handRaised && <span className="zrx-tile-hand">✋</span>}
                                {myStatus === "brb" && (
                                  <span className="zrx-tile-brb"><span>⏳</span>Be right back</span>
                                )}
                                {myStatus && myStatus !== "brb" && (
                                  <span className="zrx-tile-feedback"><FeedbackIcon kind={myStatus} size={48} /></span>
                                )}
                                {tileEmoji && <span key={tileEmoji} className="zrx-tile-emoji">{tileEmoji}</span>}
                              </div>
                            )}
                            <div className="zr-tile-avatar" aria-hidden="true">{tile.name.charAt(0).toUpperCase()}</div>
                            <div className="zr-tile-name">
                              {tile.muted && <MicOffIcon size={14} className="zr-tile-muted" />}
                              <span>{tile.name}</span>
                              {tile.host && <span className="zr-host-badge">Host</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {floaters.map((floater) => (
                      <div
                        key={floater.id}
                        className="zrx-floater"
                        style={{ left: `${floater.left}%` }}
                        aria-hidden="true"
                        onAnimationEnd={() => setFloaters((current) => current.filter((f) => f.id !== floater.id))}
                      >
                        <span className="zrx-floater-emoji">{floater.emoji}</span>
                        <span className="zrx-floater-name">You</span>
                      </div>
                    ))}

                    {(handRaised || myStatus || tileEmoji) && (
                      <div className="zrx-status-bar" role="status">
                        {tileEmoji && <span className="zrx-status-emoji" aria-label="Your reaction">{tileEmoji}</span>}
                        {handRaised && (
                          <button type="button" onClick={() => setHandRaised(false)}>✋ Lower hand</button>
                        )}
                        {myStatus === "brb" && (
                          <button type="button" onClick={() => setMyStatus(null)}>⏳ I&apos;m back</button>
                        )}
                        {myStatus && myStatus !== "brb" && (
                          <button type="button" aria-label={`Clear ${feedbackLabel(myStatus)}`} onClick={() => setMyStatus(null)}>
                            <FeedbackIcon kind={myStatus} size={18} /> {feedbackLabel(myStatus)}
                          </button>
                        )}
                      </div>
                    )}

                    {limitBanner && (
                      <div className="zr-limit-banner" role="alert">
                        <span className="zr-limit-icon" aria-hidden="true">⚠</span>
                        <p>{limitBanner}</p>
                        <button
                          type="button"
                          aria-label="Dismiss"
                          onClick={() => setLimitDismissed(limitStage)}
                        >
                          <CloseIcon size={18} />
                        </button>
                      </div>
                    )}

                    <div
                      ref={toolbarRef}
                      className={`zr-toolbar ${controlsVisible || keepControls ? "is-visible" : ""}`}
                      role="toolbar"
                      aria-label="Meeting controls"
                      onPointerEnter={() => { pointerOnToolbar.current = true; }}
                      onPointerLeave={() => { pointerOnToolbar.current = false; revealControls(); }}
                      onFocus={revealControls}
                      onBlur={revealControls}
                    >
                      <div className="zr-group">
                        <button
                          type="button"
                          className={`zr-btn ${isMuted ? "is-off" : ""}`}
                          aria-pressed={!isMuted}
                          onClick={() => setIsMuted(!isMuted)}
                        >
                          <span className="zr-btn-icon">{isMuted ? <MicOffIcon /> : <MicIcon />}<CaretUpIcon className="zr-btn-caret" /></span>
                          <span className="zr-btn-label">{isMuted ? "Unmute" : "Mute"}</span>
                        </button>
                        <button
                          type="button"
                          className={`zr-btn ${isVideoOn ? "" : "is-off"}`}
                          aria-pressed={isVideoOn}
                          aria-label={isVideoOn ? "Stop video" : "Start video"}
                          onClick={() => setIsVideoOn(!isVideoOn)}
                        >
                          <span className="zr-btn-icon">{isVideoOn ? <VideoIcon /> : <VideoOffIcon />}<CaretUpIcon className="zr-btn-caret" /></span>
                          <span className="zr-btn-label">Video</span>
                        </button>
                      </div>

                      <div className="zr-group zr-group-center">
                        <div className="zr-split">
                          <button
                            type="button"
                            className={`zr-btn ${participantsOpen ? "is-active" : ""}`}
                            aria-pressed={participantsOpen}
                            onClick={() => {
                              if (room.state !== "in") {
                                showRoomNotice("The participants list is available once you are in a meeting.");
                                return;
                              }
                              setParticipantsOpen(!participantsOpen);
                              setMeetingChatOpen(false);
                            }}
                          >
                            <span className="zr-btn-icon">
                              <ParticipantsIcon />
                              <span className="zr-count">{joinedCount || 1}</span>
                            </span>
                            <span className="zr-btn-label">Participants</span>
                          </button>
                          <button
                            ref={inviteCaretRef}
                            type="button"
                            className={`zr-caret ${inviteMenuPos ? "open" : ""}`}
                            aria-label="Invite options"
                            aria-haspopup="menu"
                            aria-expanded={inviteMenuPos !== null}
                            onClick={toggleInviteMenu}
                          >
                            <CaretUpIcon />
                          </button>
                        </div>
                        <button
                          type="button"
                          className={`zr-btn ${meetingChatOpen ? "is-active" : ""}`}
                          aria-pressed={meetingChatOpen}
                          onClick={() => {
                            setMeetingChatOpen(!meetingChatOpen);
                            setParticipantsOpen(false);
                          }}
                        >
                          <span className="zr-btn-icon"><ChatIcon /><CaretUpIcon className="zr-btn-caret" /></span>
                          <span className="zr-btn-label">Chat</span>
                        </button>
                        <button
                          ref={reactButtonRef}
                          type="button"
                          className={`zr-btn zr-optional ${reactMenuPos ? "is-active" : ""}`}
                          aria-haspopup="menu"
                          aria-expanded={reactMenuPos !== null}
                          onClick={toggleReactMenu}
                        >
                          <span className="zr-btn-icon"><ReactIcon /></span>
                          <span className="zr-btn-label">React</span>
                        </button>
                        <button
                          type="button"
                          className="zr-btn zr-share"
                          onClick={() => showRoomNotice("Screen sharing isn't available yet.")}
                        >
                          <span className="zr-btn-icon"><span className="zr-share-icon"><ShareArrowIcon /></span><CaretUpIcon className="zr-btn-caret" /></span>
                          <span className="zr-btn-label">Share</span>
                        </button>
                        <button
                          type="button"
                          className="zr-btn zr-optional"
                          onClick={() => showRoomNotice("Host tools aren't available yet.")}
                        >
                          <span className="zr-btn-icon"><HostToolsIcon /></span>
                          <span className="zr-btn-label">Host tools</span>
                        </button>
                        <button
                          type="button"
                          className="zr-btn"
                          onClick={() => showRoomNotice("More options aren't available yet.")}
                        >
                          <span className="zr-btn-icon"><MoreIcon /></span>
                          <span className="zr-btn-label">More</span>
                        </button>
                      </div>

                      <div className="zr-group zr-group-end">
                        <button
                          ref={endButtonRef}
                          type="button"
                          className={`zr-btn zr-end-btn ${endMenuPos ? "is-active" : ""}`}
                          aria-haspopup="menu"
                          aria-expanded={endMenuPos !== null}
                          onClick={toggleEndMenu}
                        >
                          <span className="zr-btn-icon"><EndIcon /></span>
                          <span className="zr-btn-label">End</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {meetingChatOpen && (
                    <aside className="zc-panel" aria-label="Meeting Chat">
                      <header className="zc-header">
                        <h2>Meeting Chat</h2>
                        <div className="zc-header-actions">
                          <button
                            type="button"
                            aria-label="Pop out chat"
                            onClick={() => showRoomNotice("Pop-out chat isn't available yet.")}
                          >
                            <PopOutIcon size={22} />
                          </button>
                          <button type="button" aria-label="Close chat" onClick={() => setMeetingChatOpen(false)}>
                            <CloseIcon size={22} />
                          </button>
                        </div>
                      </header>
                      <div className="zc-messages" aria-live="polite">
                        <p className="zc-sample-note">
                          This is a sample chat. Messages stay on your screen and aren&apos;t sent to others in real time.
                        </p>
                        {chatMessages.map((msg, idx) => (
                          <div key={idx} className="zc-msg">
                            <div className="zc-msg-meta">
                              <span><strong>You</strong> to <strong>Everyone</strong></span>
                              <time>{msg.time}</time>
                            </div>
                            <p className="zc-msg-text">{msg.text}</p>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="zc-who"
                        aria-expanded={chatWhoOpen}
                        onClick={() => setChatWhoOpen((open) => !open)}
                      >
                        <WhoCanSeeIcon size={18} />
                        Who can see your messages?
                      </button>
                      {chatWhoOpen && (
                        <p className="zc-who-info">
                          Messages sent to Everyone can be seen by everyone in the meeting.
                        </p>
                      )}
                      <form className="zc-compose" onSubmit={handleSendChat}>
                        <div className="zc-to">
                          <span>to:</span>
                          <span className="zc-to-pill">Everyone</span>
                        </div>
                        <textarea
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              handleSendChat();
                            }
                          }}
                          placeholder="Type message here ..."
                          aria-label="Type message here"
                          maxLength={1000}
                        />
                        <div className="zc-tools">
                          <button type="button" aria-label="Format" onClick={() => showRoomNotice("Formatting isn't available yet.")}>
                            <FormatIcon size={20} />
                          </button>
                          <button type="button" aria-label="File" onClick={() => showRoomNotice("Sending files isn't available yet.")}>
                            <FileIcon size={20} />
                          </button>
                          <button type="button" aria-label="Emoji" onClick={() => setChatInput((text) => text + "🙂")}>
                            <EmojiIcon size={20} />
                          </button>
                          <button type="button" aria-label="More" onClick={() => showRoomNotice("More chat options aren't available yet.")}>
                            <DotsIcon size={20} />
                          </button>
                          <button type="submit" className="zc-send" aria-label="Send" disabled={!chatInput.trim()}>
                            <SendIcon />
                          </button>
                        </div>
                      </form>
                    </aside>
                  )}

                  {participantsOpen && room.state === "in" && (
                    <ParticipantsPanel
                      participants={room.participants}
                      myId={room.me?.id ?? null}
                      isHost={room.isHost}
                      onAct={room.act}
                      onRename={room.rename}
                      onMuteAll={room.muteEveryone}
                      onInvite={openInviteDialog}
                      onClose={() => setParticipantsOpen(false)}
                      notify={showRoomNotice}
                    />
                  )}
                </div>
                )}
              </section>
            </div>

            {reactMenuPos && (
              <ReactionsMenu
                ref={reactMenuRef}
                position={reactMenuPos}
                feedback={myStatus && myStatus !== "brb" ? myStatus : null}
                handRaised={handRaised}
                beRightBack={myStatus === "brb"}
                onEmoji={sendReaction}
                onFeedback={chooseStatus}
                onRaiseHand={() => {
                  setReactMenuPos(null);
                  setHandRaised((raised) => !raised);
                }}
                onBeRightBack={() => chooseStatus("brb")}
              />
            )}

            {endMenuPos && (
              <div
                ref={endMenuRef}
                className="zr-end-menu"
                role="menu"
                aria-label="End meeting"
                style={{ right: endMenuPos.right, bottom: endMenuPos.bottom }}
              >
                {room.isHost && (
                  <button type="button" role="menuitem" className="zr-end-all" onClick={endForAll} disabled={ending}>
                    End meeting for all
                  </button>
                )}
                <button type="button" role="menuitem" className="zr-end-leave" onClick={leaveRoom} disabled={ending}>
                  Leave meeting
                </button>
              </div>
            )}

            {inviteMenuPos && (
              <div
                ref={inviteMenuRef}
                className="invite-menu"
                role="menu"
                aria-label="Invite options"
                style={{ left: inviteMenuPos.left, bottom: inviteMenuPos.bottom }}
              >
                <button type="button" role="menuitem" onClick={openInviteDialog}>Invite...</button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setInviteMenuPos(null);
                    copyForRoom(meetingData.inviteLink, "Invite link copied");
                  }}
                >
                  Copy invite link
                </button>
              </div>
            )}

            {showInviteDialog && (
              <div className="invite-dialog-backdrop" onClick={() => setShowInviteDialog(false)}>
                <div
                  className="invite-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="invite-dialog-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 id="invite-dialog-title">Invite People to join meeting {meetingData.meetingId}</h2>

                  <div className="invite-tabs" role="tablist">
                    {([
                      ["contacts", "Contacts"],
                      ["rooms", "Zoom Rooms"],
                      ["email", "Email"],
                    ] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={inviteTab === id}
                        className={inviteTab === id ? "active" : ""}
                        onClick={() => setInviteTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="invite-dialog-body">
                    {inviteTab === "email" ? (
                      <div className="invite-email-options">
                        <p>Select your default email to send invitation</p>
                        <button type="button" onClick={() => openInvitationEmail("default")}>Default Email</button>
                        <button type="button" onClick={() => openInvitationEmail("gmail")}>Gmail</button>
                        <button type="button" onClick={() => openInvitationEmail("yahoo")}>Yahoo Mail</button>
                      </div>
                    ) : (
                      <label className="invite-search">
                        <span aria-hidden="true">⌕</span>
                        <input
                          type="text"
                          value={inviteSearch}
                          onChange={(e) => setInviteSearch(e.target.value)}
                          placeholder="Choose from the list or type to search"
                          aria-label={inviteTab === "contacts" ? "Search contacts" : "Search Zoom Rooms"}
                          autoFocus
                        />
                      </label>
                    )}
                  </div>

                  <div className="invite-dialog-footer">
                    <button
                      type="button"
                      className="invite-link-btn"
                      onClick={() => copyForRoom(meetingData.inviteLink, "Meeting URL copied")}
                    >
                      Copy URL
                    </button>
                    <button
                      type="button"
                      className="invite-link-btn"
                      onClick={() => copyForRoom(roomInvitationText, "Invitation copied")}
                    >
                      Copy Invitation
                    </button>
                    <span className="invite-footer-spacer" />
                    {meetingData.passcode && (
                      <span className="invite-passcode">
                        Passcode: <strong>{meetingData.passcode}</strong>
                      </span>
                    )}
                    <button type="button" className="invite-primary" disabled>Invite</button>
                    <button type="button" className="invite-cancel" onClick={() => setShowInviteDialog(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {roomNotice && (
              <div className="room-notice" role="status">{roomNotice}</div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
