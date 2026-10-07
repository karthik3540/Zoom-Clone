"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { DEMO_MESSAGE, showDemoNotice } from "@/lib/demoNotice";
import { getUserId } from "@/lib/identity";
import {
  ApiError,
  CurrentUser,
  MeetingDetails,
  MeetingSummary,
  createScheduledMeeting,
  deleteMeeting,
  formatMeetingId,
  getCurrentUser,
  getMeetingDetails,
  getPublicMeeting,
  listPreviousMeetings,
  listUpcomingMeetings,
  timeZonePlace,
} from "@/lib/meetings";

const TABS = [
  "Upcoming",
  "Previous",
  "Attachments",
  "Personal Room",
  "Meeting Templates",
  "Meeting Agendas",
] as const;

type TabKind = (typeof TABS)[number];

function formatMeetingTitle(title: string | null | undefined): string {
  if (!title) return "My Meeting";
  const clean = title.trim();
  if (/zoom meeting/i.test(clean) || /'s meeting/i.test(clean)) {
    return "My Meeting";
  }
  return clean;
}

/** A random 6-character passcode of letters and digits, like the ones the backend generates. */
function randomPasscode(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(6)), (n) => alphabet[n % alphabet.length]).join("");
}

/** The current wall-clock time in `zone`, as "YYYY-MM-DD HH:MM:00" (the scheduler's format). */
function nowInZone(zone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:00`;
}

/** The default date range of a tab, relative to today. */
function defaultRange(tab: "Upcoming" | "Previous"): { start: Date; end: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const other = new Date(today);
  other.setMonth(other.getMonth() + (tab === "Upcoming" ? 3 : -3));
  return tab === "Upcoming" ? { start: today, end: other } : { start: other, end: today };
}

function timeZoneCity(zone: string): string {
  if (zone === "Asia/Kolkata") return "Mumbai, Kolkata, New Delhi";
  if (zone === "Europe/London") return "London";
  if (zone === "America/New_York") return "Eastern Time";
  return timeZonePlace(zone) || zone;
}

function dateGroupLabel(iso: string | null, zone: string): string {
  if (!iso) return "Today";
  let dateStr = iso.trim();
  if (!dateStr.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(dateStr)) {
    dateStr = dateStr.replace(" ", "T") + "Z";
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Today";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone || "Asia/Kolkata",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getMeetingTimes(meeting: MeetingSummary) {
  const startIso = meeting.scheduled_start_at ?? meeting.started_at;
  if (!startIso) {
    return {
      timeRange: "11:30 PM - 12:10 AM",
      startFormatted: "11:30 PM",
      city: timeZoneCity(meeting.timezone),
    };
  }

  let dateStr = startIso.trim();
  if (!dateStr.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(dateStr)) {
    dateStr = dateStr.replace(" ", "T") + "Z";
  }
  const start = new Date(dateStr);
  const duration = meeting.duration_minutes && meeting.duration_minutes > 0 ? meeting.duration_minutes : 40;
  const end = new Date(start.getTime() + duration * 60 * 1000);
  const tz = meeting.timezone || "Asia/Kolkata";

  const tFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const startFormatted = tFmt.format(start);
  const endFormatted = tFmt.format(end);

  return {
    timeRange: `${startFormatted} - ${endFormatted}`,
    startFormatted,
    city: timeZoneCity(tz),
  };
}

function formatDatePill(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const y = date.getFullYear();
  return `${m}-${d}-${y}`;
}

export default function MeetingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKind>("Upcoming");
  const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MeetingSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteToast, setDeleteToast] = useState("");
  // The arrow next to "Schedule a Meeting" opens a menu with that one option.
  const [scheduleMenuOpen, setScheduleMenuOpen] = useState(false);
  const scheduleMenuRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);


  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // Date range filter state
  // Upcoming: today to 3 months ahead; Previous: 3 months back to today (the calendar can change it).
  const [filterStart, setFilterStart] = useState<Date>(() => defaultRange("Upcoming").start);
  const [filterEnd, setFilterEnd] = useState<Date>(() => defaultRange("Upcoming").end);
  useEffect(() => {
    if (activeTab !== "Upcoming" && activeTab !== "Previous") return;
    const range = defaultRange(activeTab);
    setFilterStart(range.start);
    setFilterEnd(range.end);
  }, [activeTab]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarViewMonth, setCalendarViewMonth] = useState<Date>(() => new Date(2026, 9, 1));
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Personal Room state
  const [personalMeeting, setPersonalMeeting] = useState<MeetingDetails | null>(null);
  const [personalUser, setPersonalUser] = useState<CurrentUser | null>(null);
  const [showPasscode, setShowPasscode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedInvitation, setCopiedInvitation] = useState(false);
  const [loadingPersonal, setLoadingPersonal] = useState(false);

  // Initialize active tab from URL search param or hash if provided
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      const hash = window.location.hash.toLowerCase();
      if (tab === "personal" || hash.includes("personal")) {
        setActiveTab("Personal Room");
      }
    }
  }, []);

  // Fetch upcoming/previous meetings or personal room data
  useEffect(() => {
    if (!getUserId()) {
      router.replace("/signin");
      return;
    }

    if (activeTab === "Upcoming" || activeTab === "Previous") {
      setLoading(true);
      setError("");

      const fetcher = activeTab === "Upcoming" ? listUpcomingMeetings : listPreviousMeetings;
      fetcher()
        .then((data) => {
          setMeetings(data);
          setLoading(false);
        })
        .catch((err: Error) => {
          setError(err.message);
          setLoading(false);
        });
    } else if (activeTab === "Personal Room") {
      setLoadingPersonal(true);
      setError("");

      getCurrentUser()
        .then(async (user) => {
          setPersonalUser(user);
          let meetingCode: string | null = null;
          try {
            const summary = await getPublicMeeting(user.personal_meeting_id);
            meetingCode = summary.meeting_code;
          } catch {
            // If no personal meeting was found, create one through the backend scheduled endpoint
            const created = await createScheduledMeeting({
              title: `${user.display_name}'s Personal Meeting Room`,
              description: null,
              scheduled_start_at: nowInZone("Asia/Kolkata"),
              duration_minutes: 40,
              timezone: "Asia/Kolkata",
              meeting_id_type: "personal",
              passcode: randomPasscode(),
              waiting_room_enabled: true,
              encryption_mode: "enhanced",
              notes_enabled: true,
              notes_scope: "all_participants",
              host_video_enabled: false,
              participant_video_enabled: false,
              template: null,
              attachments: [],
            });
            meetingCode = created.meeting_code;
          }

          const details = await getMeetingDetails(meetingCode);
          setPersonalMeeting(details);
          setLoadingPersonal(false);
        })
        .catch((err: Error) => {
          setError(err.message);
          setLoadingPersonal(false);
        });
    } else {
      setMeetings([]);
      setLoading(false);
    }
  }, [activeTab, router]);

  // Close the schedule menu on a click elsewhere or Escape.
  useEffect(() => {
    if (!scheduleMenuOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && scheduleMenuRef.current?.contains(event.target as Node)) return;
      setScheduleMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [scheduleMenuOpen]);

  // Close calendar popover on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setCalendarOpen(false);
        setIsSelecting(false);
        setSelectionAnchor(null);
        setHoverDate(null);
      }
    }
    if (calendarOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [calendarOpen]);

  // Sort and filter meetings according to timeline and date range
  const displayedGroups = useMemo(() => {
    if (!meetings) return [];

    let list = [...meetings];

    // Timeline sorting
    if (activeTab === "Upcoming") {
      list.sort((a, b) => {
        if (a.status === "live" && b.status !== "live") return -1;
        if (b.status === "live" && a.status !== "live") return 1;
        const timeA = new Date(a.scheduled_start_at ?? a.started_at ?? 0).getTime();
        const timeB = new Date(b.scheduled_start_at ?? b.started_at ?? 0).getTime();
        return timeA - timeB;
      });
    } else if (activeTab === "Previous") {
      list.sort((a, b) => {
        const timeA = new Date(a.ended_at ?? a.scheduled_start_at ?? a.started_at ?? 0).getTime();
        const timeB = new Date(b.ended_at ?? b.scheduled_start_at ?? b.started_at ?? 0).getTime();
        return timeB - timeA;
      });
    }

    // Filter by date range
    if (filterStart && filterEnd) {
      const startTime = new Date(filterStart).setHours(0, 0, 0, 0);
      const endTime = new Date(filterEnd).setHours(23, 59, 59, 999);

      list = list.filter((m) => {
        const iso = m.scheduled_start_at ?? m.started_at ?? m.ended_at;
        if (!iso) return true;
        let dateStr = iso.trim();
        if (!dateStr.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(dateStr)) {
          dateStr = dateStr.replace(" ", "T") + "Z";
        }
        const time = new Date(dateStr).getTime();
        return isNaN(time) || (time >= startTime && time <= endTime);
      });
    }

    // Group by date
    const groups: { label: string; items: MeetingSummary[] }[] = [];
    for (const m of list) {
      const iso = m.scheduled_start_at ?? m.started_at ?? m.ended_at;
      const label = dateGroupLabel(iso, m.timezone);
      const existing = groups.find((g) => g.label === label);
      if (existing) {
        existing.items.push(m);
      } else {
        groups.push({ label, items: [m] });
      }
    }

    return groups;
  }, [meetings, activeTab, filterStart, filterEnd]);

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteMeeting(deleteTarget.meeting_code);
      setMeetings((prev) => (prev ? prev.filter((m) => m.meeting_code !== deleteTarget.meeting_code) : []));
    } catch (err) {
      // A meeting in progress cannot be deleted (upcoming and ended ones can).
      showDeleteToast(
        err instanceof ApiError && err.code === "meeting_already_started"
          ? "Sorry, you cannot delete this meeting since it's in progress."
          : err instanceof Error ? err.message : "Couldn't delete the meeting. Please try again.",
      );
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const showDeleteToast = (message: string) => {
    setDeleteToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setDeleteToast(""), 4000);
  };

  const closeDeleteDialog = () => setDeleteTarget(null);

  // Personal Room Helpers
  const personalInviteLink = useMemo(() => {
    if (!personalMeeting) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const pmi = personalMeeting.public_meeting_id || personalUser?.personal_meeting_id || "";
    const base = personalMeeting.invite_url || `${origin}/j/${pmi}`;
    return personalMeeting.passcode ? `${base}?pwd=${encodeURIComponent(personalMeeting.passcode)}` : base;
  }, [personalMeeting, personalUser]);

  const handleCopyPersonalLink = async () => {
    if (!personalInviteLink) return;
    try {
      await navigator.clipboard.writeText(personalInviteLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {}
  };

  const handleCopyPersonalInvitation = async () => {
    if (!personalMeeting) return;
    const pmi = formatMeetingId(personalMeeting.public_meeting_id || personalUser?.personal_meeting_id || "");
    const text = [
      `Topic: ${personalMeeting.title}`,
      "",
      `Join Zoom Meeting`,
      personalInviteLink,
      "",
      `Meeting ID: ${pmi}`,
      ...(personalMeeting.passcode ? [`Passcode: ${personalMeeting.passcode}`] : []),
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopiedInvitation(true);
      setTimeout(() => setCopiedInvitation(false), 2000);
    } catch {}
  };

  const downloadIcs = () => {
    if (!personalMeeting) return;
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      `SUMMARY:${personalMeeting.title}`,
      `DESCRIPTION:Join Zoom Meeting: ${personalInviteLink}\\nPasscode: ${personalMeeting.passcode ?? ""}`,
      `LOCATION:${personalInviteLink}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meeting.ics";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Calendar rendering helpers
  const nextMonth = new Date(calendarViewMonth.getFullYear(), calendarViewMonth.getMonth() + 1, 1);

  // Normalizes a date to midnight for comparison
  const getDayStart = (d: Date): number => {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };

  const isSameDay = (d1: Date | null, d2: Date | null): boolean => {
    if (!d1 || !d2) return false;
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  // Determine active effective selection (preview while selecting or committed)
  let effectiveStart: Date | null = filterStart;
  let effectiveEnd: Date | null = filterEnd;

  if (isSelecting && selectionAnchor) {
    if (hoverDate) {
      if (hoverDate.getTime() < selectionAnchor.getTime()) {
        effectiveStart = hoverDate;
        effectiveEnd = selectionAnchor;
      } else {
        effectiveStart = selectionAnchor;
        effectiveEnd = hoverDate;
      }
    } else {
      effectiveStart = selectionAnchor;
      effectiveEnd = selectionAnchor;
    }
  }

  const handleDayClick = (cellDate: Date) => {
    if (!isSelecting) {
      setIsSelecting(true);
      setSelectionAnchor(cellDate);
      setHoverDate(cellDate);
    } else {
      if (selectionAnchor) {
        const minDate = cellDate.getTime() < selectionAnchor.getTime() ? cellDate : selectionAnchor;
        const maxDate = cellDate.getTime() > selectionAnchor.getTime() ? cellDate : selectionAnchor;
        setFilterStart(new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()));
        setFilterEnd(new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate()));
      }
      setIsSelecting(false);
      setSelectionAnchor(null);
      setHoverDate(null);
    }
  };

  const handleDayMouseEnter = (cellDate: Date) => {
    if (isSelecting && selectionAnchor) {
      setHoverDate(cellDate);
    }
  };

  const getMonthDays = (baseMonth: Date) => {
    const year = baseMonth.getFullYear();
    const month = baseMonth.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 is Sun, 6 is Sat
    const prevMonthTotalDays = new Date(year, month, 0).getDate();

    // If month begins on Sunday, prepend a full 7-day week from previous month
    // so both months always have 6 rows (42 cells), matching reference images
    const leadDaysCount = firstDayOfWeek === 0 ? 7 : firstDayOfWeek;

    const cells: {
      day: number;
      currentMonth: boolean;
      date: Date;
      colIndex: number;
    }[] = [];

    for (let i = leadDaysCount - 1; i >= 0; i--) {
      const d = prevMonthTotalDays - i;
      cells.push({
        day: d,
        currentMonth: false,
        date: new Date(year, month - 1, d),
        colIndex: cells.length % 7,
      });
    }

    for (let d = 1; d <= totalDays; d++) {
      cells.push({
        day: d,
        currentMonth: true,
        date: new Date(year, month, d),
        colIndex: cells.length % 7,
      });
    }

    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      cells.push({
        day: d,
        currentMonth: false,
        date: new Date(year, month + 1, d),
        colIndex: cells.length % 7,
      });
    }

    return cells;
  };

  const renderMonth = (baseMonth: Date, isLeftPanel: boolean) => {
    const cells = getMonthDays(baseMonth);
    const monthTitle = baseMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const today = new Date(2026, 9, 7); // Oct 7, 2026

    const sTime = effectiveStart ? getDayStart(effectiveStart) : null;
    const eTime = effectiveEnd ? getDayStart(effectiveEnd) : null;

    return (
      <div className="cal-month-panel" style={{ width: 256 }}>
        {/* Month Header with Navigation */}
        <div
          className="cal-header"
          style={{
            display: "grid",
            gridTemplateColumns: "48px 1fr 48px",
            alignItems: "center",
            marginBottom: 16,
            height: 28,
          }}
        >
          {isLeftPanel ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                type="button"
                className="cal-nav-btn"
                onClick={() =>
                  setCalendarViewMonth(
                    (prev) => new Date(prev.getFullYear() - 1, prev.getMonth(), 1)
                  )
                }
                title="Previous Year"
                aria-label="Previous Year"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="3" x2="3" y2="13" />
                  <polyline points="12 3 7 8 12 13" />
                </svg>
              </button>
              <button
                type="button"
                className="cal-nav-btn"
                onClick={() =>
                  setCalendarViewMonth(
                    (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                  )
                }
                title="Previous Month"
                aria-label="Previous Month"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="10 3 5 8 10 13" />
                </svg>
              </button>
            </div>
          ) : (
            <div />
          )}

          <div
            style={{
              textAlign: "center",
              fontSize: 16,
              fontWeight: 500,
              color: "#111827",
              whiteSpace: "nowrap",
            }}
          >
            {monthTitle}
          </div>

          {!isLeftPanel ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="cal-nav-btn"
                onClick={() =>
                  setCalendarViewMonth(
                    (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                  )
                }
                title="Next Month"
                aria-label="Next Month"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 3 11 8 6 13" />
                </svg>
              </button>
              <button
                type="button"
                className="cal-nav-btn"
                onClick={() =>
                  setCalendarViewMonth(
                    (prev) => new Date(prev.getFullYear() + 1, prev.getMonth(), 1)
                  )
                }
                title="Next Year"
                aria-label="Next Year"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 3 9 8 4 13" />
                  <line x1="13" y1="3" x2="13" y2="13" />
                </svg>
              </button>
            </div>
          ) : (
            <div />
          )}
        </div>

        {/* Weekdays Row */}
        <div
          className="cal-weekdays"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 36.5px)",
            alignItems: "center",
            textAlign: "center",
            fontSize: 13,
            fontWeight: 400,
            color: "#374151",
            paddingBottom: 10,
            borderBottom: "1px solid #f0f2f5",
            marginBottom: 8,
          }}
        >
          <span>Sun</span>
          <span>Mon</span>
          <span>Tue</span>
          <span>Wed</span>
          <span>Thu</span>
          <span>Fri</span>
          <span>Sat</span>
        </div>

        {/* Days Grid */}
        <div
          className="cal-days-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 36.5px)",
            rowGap: 4,
            columnGap: 0,
          }}
        >
          {cells.map((cell, idx) => {
            const cTime = getDayStart(cell.date);
            const isStart = sTime !== null && cTime === sTime;
            const isEnd = eTime !== null && cTime === eTime;
            const isEdge = isStart || isEnd;
            const hasRange = sTime !== null && eTime !== null && sTime < eTime;
            const inRange = hasRange && cTime >= sTime && cTime <= eTime;
            const isToday = isSameDay(cell.date, today);

            // Ribbon continuous pill calculation
            let ribbonStyle: React.CSSProperties | null = null;
            if (hasRange && inRange) {
              if (isStart) {
                ribbonStyle = {
                  left: 2,
                  right: 0,
                  borderTopLeftRadius: 16,
                  borderBottomLeftRadius: 16,
                  ...(cell.colIndex === 6 ? { borderTopRightRadius: 16, borderBottomRightRadius: 16 } : {}),
                };
              } else if (isEnd) {
                ribbonStyle = {
                  left: 0,
                  right: 2,
                  borderTopRightRadius: 16,
                  borderBottomRightRadius: 16,
                  ...(cell.colIndex === 0 ? { borderTopLeftRadius: 16, borderBottomLeftRadius: 16 } : {}),
                };
              } else {
                ribbonStyle = {
                  left: cell.colIndex === 0 ? 2 : 0,
                  right: cell.colIndex === 6 ? 2 : 0,
                  ...(cell.colIndex === 0 ? { borderTopLeftRadius: 16, borderBottomLeftRadius: 16 } : {}),
                  ...(cell.colIndex === 6 ? { borderTopRightRadius: 16, borderBottomRightRadius: 16 } : {}),
                };
              }
            }

            return (
              <div
                key={idx}
                className="cal-cell"
                style={{
                  width: 36.5,
                  height: 32,
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  userSelect: "none",
                }}
                onClick={() => handleDayClick(cell.date)}
                onMouseEnter={() => handleDayMouseEnter(cell.date)}
              >
                {ribbonStyle && (
                  <div
                    className="cal-range-ribbon"
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      backgroundColor: "#e0e6ed",
                      zIndex: 1,
                      ...ribbonStyle,
                    }}
                  />
                )}

                <span
                  className={`cal-day-circle ${isEdge ? "selected-circle" : ""} ${
                    isToday && !isEdge ? "today-number" : ""
                  } ${!cell.currentMonth && !isEdge ? "other-month-number" : ""}`}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    position: "relative",
                    zIndex: 2,
                    color: isEdge
                      ? "#ffffff"
                      : isToday
                      ? "#0e71eb"
                      : !cell.currentMonth
                      ? "#cbd5e1"
                      : "#1f2937",
                    fontWeight: isEdge || isToday ? 600 : 400,
                    backgroundColor: isEdge ? "#0e71eb" : "transparent",
                    boxShadow: isEdge ? "0 2px 8px rgba(14, 113, 235, 0.45)" : "none",
                    transition: "background-color 0.12s ease, color 0.12s ease",
                  }}
                >
                  {cell.day}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="meetings-page-container">
      <Sidebar />

      <main className="meetings-content-area">
        {/* Top Header */}
        <div className="meetings-title-row">
          <h1>Meetings</h1>
          <div className="schedule-menu-anchor" ref={scheduleMenuRef}>
          <div className="schedule-btn-group">
            <Link href="/schedule" className="btn-schedule-main">
              <span className="plus-symbol">+</span> Schedule a Meeting
            </Link>
            <div className="schedule-btn-divider" />
            <button
              type="button"
              className="btn-schedule-dropdown"
              onClick={() => setScheduleMenuOpen((open) => !open)}
              aria-label="Schedule Options"
              aria-haspopup="menu"
              aria-expanded={scheduleMenuOpen}
            >
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 1.5L5 5L9 1.5" />
              </svg>
            </button>
          </div>
          {scheduleMenuOpen && (
            <div className="schedule-menu" role="menu" aria-label="Schedule Options">
              <button
                type="button"
                role="menuitem"
                className="schedule-menu-item"
                autoFocus
                onClick={() => {
                  setScheduleMenuOpen(false);
                  router.push("/schedule");
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
                  <path d="M3.5 9.5h17M8 3v4M16 3v4M12 12.5v5M9.5 15h5" />
                </svg>
                Schedule a Meeting
              </button>
            </div>
          )}
          </div>
        </div>

        {/* Plan Upgrade Notice Banner */}
        <div className="plan-upgrade-banner">
          <span>
            Your current Basic plan allows you to schedule meetings for up to 40 minutes each. Upgrade to Zoom
            Workplace Pro to schedule meetings for up to 30 hours with advanced meeting features.{" "}
            <button
              type="button"
              className="banner-link"
              onClick={() => showDemoNotice()}
            >
              Discover Zoom Workplace Pro
            </button>
          </span>
        </div>

        {/* Tabs Bar */}
        <div className="meetings-tabs-bar">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`tab-btn ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
              {activeTab === tab && <div className="tab-indicator" />}
            </button>
          ))}
        </div>

        {/* -------------------- VIEW 1: PERSONAL ROOM -------------------- */}
        {activeTab === "Personal Room" && (
          <div className="personal-room-view">
            <div className="details-badge">Details</div>

            {loadingPersonal && <div className="personal-loading">Loading Personal Room…</div>}

            {!loadingPersonal && personalMeeting && (
              <div className="personal-details-grid">
                {/* Topic */}
                <div className="personal-field-row">
                  <div className="field-label">Topic</div>
                  <div className="field-value">
                    {personalMeeting.title || `${personalUser?.display_name || "My"}'s Personal Meeting Room`}
                  </div>
                </div>

                {/* Meeting ID */}
                <div className="personal-field-row">
                  <div className="field-label">Meeting ID</div>
                  <div className="field-value meeting-id-text">
                    {formatMeetingId(personalMeeting.public_meeting_id || personalUser?.personal_meeting_id || "")}
                  </div>
                </div>

                {/* Security */}
                <div className="personal-field-row">
                  <div className="field-label">Security</div>
                  <div className="field-value security-block">
                    <div className="security-item">
                      <span className="check-mark">✓</span>
                      <span className="security-title">Passcode</span>
                      <span className="passcode-display">
                        {showPasscode ? personalMeeting.passcode || "—" : "********"}
                      </span>
                      <button
                        type="button"
                        className="btn-passcode-toggle"
                        onClick={() => setShowPasscode((s) => !s)}
                      >
                        {showPasscode ? "Hide" : "Show"}
                      </button>
                    </div>

                    <div className="security-item">
                      <span className="check-mark">✓</span>
                      <span>Everyone goes into the waiting room</span>
                    </div>
                  </div>
                </div>

                {/* Invite Link */}
                <div className="personal-field-row">
                  <div className="field-label">Invite Link</div>
                  <div className="field-value invite-link-block">
                    <a href={personalInviteLink} target="_blank" rel="noreferrer" className="invite-url-link">
                      {personalInviteLink}
                    </a>
                    <button
                      type="button"
                      className="btn-copy-inline"
                      onClick={handleCopyPersonalLink}
                      title="Copy Link"
                    >
                      <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h6A1.5 1.5 0 0 1 16 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 7 12.5v-9z" />
                        <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5H6v7.5A2.5 2.5 0 0 0 8.5 15H13v.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 4 15.5v-9z" />
                      </svg>
                    </button>
                    {copiedLink && <span className="copied-inline-text">Copied!</span>}
                  </div>
                </div>

                {/* Add to */}
                <div className="personal-field-row">
                  <div className="field-label">Add to</div>
                  <div className="field-value calendar-links-row">
                    <a
                      href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
                        personalMeeting.title
                      )}&details=${encodeURIComponent(
                        `Join Zoom Meeting: ${personalInviteLink}\nPasscode: ${personalMeeting.passcode ?? ""}`
                      )}&location=${encodeURIComponent(personalInviteLink)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="cal-link"
                    >
                      <span className="cal-icon google-cal-icon">31</span> Google Calendar
                    </a>

                    <button type="button" className="cal-link cal-btn" onClick={downloadIcs}>
                      <span className="cal-icon outlook-cal-icon">O</span> Outlook Calendar (.ics)
                    </button>

                    <a
                      href={`https://calendar.yahoo.com/?v=60&view=d&type=20&title=${encodeURIComponent(
                        personalMeeting.title
                      )}&desc=${encodeURIComponent(
                        `Join Zoom Meeting: ${personalInviteLink}\nPasscode: ${personalMeeting.passcode ?? ""}`
                      )}&in_loc=${encodeURIComponent(personalInviteLink)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="cal-link"
                    >
                      <span className="cal-icon yahoo-cal-icon">Y</span> Yahoo Calendar
                    </a>
                  </div>
                </div>

                {/* Encryption */}
                <div className="personal-field-row">
                  <div className="field-label">Encryption</div>
                  <div className="field-value encryption-value">
                    <span className="shield-icon">🛡️</span> Enhanced encryption
                  </div>
                </div>

                {/* My Notes */}
                <div className="personal-field-row">
                  <div className="field-label">My Notes</div>
                  <div className="field-value notes-block">
                    <div>Allow participants to transcribe meeting with My Notes</div>
                    <div className="notes-scope-text">All participants</div>
                  </div>
                </div>

                {/* Video */}
                <div className="personal-field-row">
                  <div className="field-label">Video</div>
                  <div className="field-value video-options-block">
                    <div className="video-line">
                      <span className="video-role">Host</span>
                      <span className="video-state">{personalMeeting.host_video_enabled ? "on" : "off"}</span>
                    </div>
                    <div className="video-line">
                      <span className="video-role">Participant</span>
                      <span className="video-state">{personalMeeting.participant_video_enabled ? "on" : "off"}</span>
                    </div>
                  </div>
                </div>

                {/* Bottom Action Buttons */}
                <div className="personal-action-bar">
                  <button
                    type="button"
                    className="btn-personal-start"
                    onClick={() =>
                      router.push(`/meetings/my-meeting?meeting=${personalMeeting.meeting_code}&live=1`)
                    }
                  >
                    Start
                  </button>

                  <button
                    type="button"
                    className="btn-personal-copy"
                    onClick={handleCopyPersonalInvitation}
                  >
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h6A1.5 1.5 0 0 1 16 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 7 12.5v-9z" />
                      <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5H6v7.5A2.5 2.5 0 0 0 8.5 15H13v.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 4 15.5v-9z" />
                    </svg>
                    {copiedInvitation ? "Invitation Copied!" : "Copy Invitation"}
                  </button>

                  <button
                    type="button"
                    className="btn-personal-edit"
                    onClick={() => router.push(`/schedule?meeting=${personalMeeting.meeting_code}`)}
                  >
                    Edit
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* -------------------- VIEW 2: UPCOMING & PREVIOUS -------------------- */}
        {(activeTab === "Upcoming" || activeTab === "Previous") && (
          <>
            <div className="filter-row" ref={calendarRef}>
              <div
                className="date-filter-pill"
                onClick={() => {
                  setCalendarOpen((v) => {
                    if (v) {
                      setIsSelecting(false);
                      setSelectionAnchor(null);
                      setHoverDate(null);
                    }
                    return !v;
                  });
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span>
                  {formatDatePill(filterStart)} to {formatDatePill(filterEnd)}
                </span>
              </div>
              <div className="help-icon" title="Filter meetings by scheduled timeline">
                ?
              </div>

              {/* Dual Month Calendar Popover */}
              {calendarOpen && (
                <div
                  className="calendar-popover"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    left: 0,
                    backgroundColor: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.04)",
                    padding: "20px 22px",
                    zIndex: 100,
                  }}
                  onMouseLeave={() => {
                    if (isSelecting && selectionAnchor) {
                      setHoverDate(null);
                    }
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "stretch",
                      gap: 0,
                    }}
                  >
                    <div style={{ paddingRight: 20, borderRight: "1px solid #f0f2f5" }}>
                      {renderMonth(calendarViewMonth, true)}
                    </div>
                    <div style={{ paddingLeft: 20 }}>
                      {renderMonth(nextMonth, false)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {loading && <div className="meetings-status-msg">Loading meetings…</div>}
            {error && <div className="meetings-error-msg">{error}</div>}

            {!loading && !error && displayedGroups.length === 0 && (
              <div className="meetings-empty-box">
                {activeTab === "Upcoming"
                  ? "No upcoming meetings scheduled within this date range."
                  : "No previous meetings found within this date range."}
              </div>
            )}

            {!loading &&
              !error &&
              displayedGroups.map((group, groupIdx) => (
                <div key={group.label} className="meetings-date-group">
                  <div className="group-date-header">{group.label}</div>

                  <div className="group-meetings-list">
                    {group.items.map((meeting, itemIdx) => {
                      const times = getMeetingTimes(meeting);
                      const isFirstRow = groupIdx === 0 && itemIdx === 0;

                      return (
                        <div key={meeting.meeting_code} className={`meeting-row-card ${isFirstRow ? "primary-row" : ""}`}>
                          {/* Left Column: Time & Timezone */}
                          <div className="row-col-time">
                            <div className="time-range-text">{times.timeRange}</div>
                            <div className="timezone-text">
                              {times.startFormatted} {times.city}
                            </div>

                            {/* Upsell box shown on primary meeting */}
                            {isFirstRow && (
                              <div className="time-upsell-badge">
                                <div className="upsell-heading">Need more meeting time?</div>
                                <button
                                  type="button"
                                  className="upsell-action"
                                  onClick={() => showDemoNotice()}
                                >
                                  Upgrade to Zoom Workplace Pro
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Middle Column: Topic & Meeting ID */}
                          <div className="row-col-info">
                            <Link
                              href={`/meetings/my-meeting?meeting=${meeting.meeting_code}`}
                              className="row-meeting-title"
                            >
                              {formatMeetingTitle(meeting.title)}
                            </Link>
                            <div className="row-meeting-id">
                              Meeting ID: {formatMeetingId(meeting.public_meeting_id || meeting.meeting_code)}
                            </div>
                          </div>

                          {/* Right Column: Action Buttons */}
                          <div className="row-col-actions">
                            <button
                              type="button"
                              className="btn-action-start"
                              onClick={() =>
                                router.push(`/meetings/my-meeting?meeting=${meeting.meeting_code}&live=1`)
                              }
                            >
                              Start
                            </button>
                            <button
                              type="button"
                              className="btn-action-edit"
                              onClick={() => router.push(`/schedule?meeting=${meeting.meeting_code}`)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn-action-delete"
                              onClick={() => setDeleteTarget(meeting)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </>
        )}

        {/* -------------------- VIEW 3: PLACEHOLDER TABS -------------------- */}
        {activeTab !== "Upcoming" && activeTab !== "Previous" && activeTab !== "Personal Room" && (
          <div className="tab-placeholder-box">
            <h3>{activeTab}</h3>
            <p>No items found in {activeTab}. {DEMO_MESSAGE}</p>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteTarget && (
          <div className="modal-backdrop" onClick={closeDeleteDialog}>
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
                <button type="button" className="delete-meeting-confirm" onClick={handleDelete} disabled={deleting}>
                  Delete
                </button>
                <button type="button" className="delete-meeting-cancel" onClick={closeDeleteDialog} disabled={deleting}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteToast && (
          <div className="delete-toast" role="alert">
            <span className="delete-toast-icon" aria-hidden="true">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
                <path d="M2 2l6 6M8 2L2 8" />
              </svg>
            </span>
            {deleteToast}
          </div>
        )}


        {/* Floating Chat Bubble Widget */}
        <button
          type="button"
          className="floating-chat-bubble"
          aria-label="Chat support"
          title="Zoom Support Chat"
          onClick={() => showDemoNotice()}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2.05 21.95a1 1 0 0 0 1.258 1.258l4.782-1.388A9.956 9.956 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.96 7.96 0 0 1-4.083-1.12.998.998 0 0 0-.64-.176l-3.328.966.966-3.328a1 1 0 0 0-.176-.64A7.957 7.957 0 0 1 4 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z" />
          </svg>
        </button>
      </main>

      <style jsx>{`
        .meetings-page-container {
          display: flex;
          min-height: 100vh;
          background: #ffffff;
        }

        .meetings-content-area {
          flex: 1;
          padding: 32px 48px;
          max-width: 1300px;
          min-width: 0;
          position: relative;
        }

        .meetings-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }

        .meetings-title-row h1 {
          font-size: 26px;
          font-weight: 700;
          color: #111827;
          margin: 0;
        }

        .schedule-btn-group {
          display: inline-flex;
          align-items: center;
          border-radius: 8px;
          overflow: hidden;
          background-color: #0e71eb;
          height: 38px;
          transition: background-color 0.15s ease;
        }

        .schedule-btn-group:hover {
          background-color: #005ce6;
        }

        .schedule-btn-group :global(.btn-schedule-main) {
          background: transparent;
          color: #ffffff;
          padding: 0 14px 0 16px;
          font-size: 14px;
          font-weight: 500;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 100%;
          cursor: pointer;
        }

        .plus-symbol {
          font-size: 16px;
          font-weight: 500;
          line-height: 1;
        }

        .schedule-btn-divider {
          width: 1px;
          height: 16px;
          background-color: rgba(255, 255, 255, 0.45);
          flex-shrink: 0;
        }

        .schedule-menu-anchor {
          position: relative;
        }

        .schedule-menu {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          z-index: 200;
          min-width: 290px;
          padding: 8px 0;
          background: #ffffff;
          border: 1px solid #e6e9ee;
          border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
        }

        .schedule-menu-item {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 10px 18px;
          border: 0;
          background: transparent;
          color: #131619;
          font-size: 16px;
          text-align: left;
          cursor: pointer;
        }

        .schedule-menu-item:hover,
        .schedule-menu-item:focus-visible {
          background: #f2f4f7;
          outline: none;
        }

        .btn-schedule-dropdown {
          background: transparent;
          color: #ffffff;
          border: none;
          padding: 0 12px 0 10px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 100%;
        }

        .plan-upgrade-banner {
          background-color: #f8f9fa;
          border: 1px solid #eef0f3;
          border-radius: 8px;
          padding: 14px 18px;
          margin-bottom: 24px;
          font-size: 14px;
          color: #1f2937;
          line-height: 1.5;
        }

        .banner-link {
          color: #0e71eb;
          text-decoration: none;
          font-weight: 500;
        }

        button.banner-link {
          background: transparent;
          border: none;
          padding: 0;
          font: inherit;
          cursor: pointer;
          display: inline;
          text-align: left;
        }

        .banner-link:hover {
          text-decoration: underline;
        }

        .meetings-tabs-bar {
          display: flex;
          align-items: stretch;
          gap: 28px;
          border-bottom: 1px solid #e5e7eb;
          margin-bottom: 20px;
        }

        .tab-btn {
          background: transparent;
          border: none;
          padding: 10px 2px 14px 2px;
          font-size: 16px;
          font-weight: 500;
          color: #4b5563;
          cursor: pointer;
          position: relative;
          transition: color 0.15s ease;
        }

        .tab-btn:hover {
          color: #111827;
        }

        .tab-btn.active {
          color: #0e71eb;
          font-weight: 600;
        }

        .tab-indicator {
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background-color: #0e71eb;
        }

        /* ---------------- PERSONAL ROOM STYLES ---------------- */
        .personal-room-view {
          padding-top: 6px;
          max-width: 950px;
        }

        .details-badge {
          background-color: #eef4fe;
          color: #0e71eb;
          font-size: 13px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 6px;
          display: inline-block;
          margin-bottom: 24px;
        }

        .personal-loading {
          padding: 30px 0;
          color: #6b7280;
          font-size: 14px;
        }

        .personal-details-grid {
          display: flex;
          flex-direction: column;
        }

        .personal-field-row {
          display: grid;
          grid-template-columns: 140px 1fr;
          gap: 24px;
          padding: 14px 0;
          font-size: 14px;
          line-height: 1.5;
          align-items: flex-start;
          border-bottom: 1px solid #f9fafb;
        }

        .field-label {
          color: #4b5563;
          font-weight: 500;
        }

        .field-value {
          color: #111827;
        }

        .meeting-id-text {
          font-weight: 600;
          color: #111827;
        }

        .security-block {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .security-item {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .check-mark {
          color: #0e71eb;
          font-weight: 700;
          font-size: 13px;
        }

        .security-title {
          font-weight: 500;
        }

        .passcode-display {
          font-family: monospace;
          letter-spacing: 1px;
          font-weight: 600;
          color: #111827;
          margin-left: 4px;
        }

        .btn-passcode-toggle {
          background: none;
          border: none;
          color: #0e71eb;
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          margin-left: 6px;
          padding: 0;
        }

        .btn-passcode-toggle:hover {
          text-decoration: underline;
        }

        .invite-link-block {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .invite-url-link {
          color: #0e71eb;
          text-decoration: none;
          word-break: break-all;
        }

        .invite-url-link:hover {
          text-decoration: underline;
        }

        .btn-copy-inline {
          background: none;
          border: none;
          color: #6b7280;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 2px 4px;
          border-radius: 4px;
        }

        .btn-copy-inline:hover {
          color: #0e71eb;
          background-color: #f3f4f6;
        }

        .copied-inline-text {
          font-size: 12px;
          color: #059669;
          font-weight: 500;
        }

        .calendar-links-row {
          display: flex;
          align-items: center;
          gap: 24px;
          flex-wrap: wrap;
        }

        .cal-link {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #0e71eb;
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
        }

        .cal-link:hover {
          text-decoration: underline;
        }

        .cal-icon {
          width: 18px;
          height: 18px;
          border-radius: 4px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          color: #ffffff;
        }

        .google-cal-icon {
          background-color: #4285f4;
        }

        .outlook-cal-icon {
          background-color: #0078d4;
        }

        .yahoo-cal-icon {
          background-color: #6001d2;
          border-radius: 50%;
        }

        .encryption-value {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .shield-icon {
          font-size: 15px;
        }

        .notes-block {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .notes-scope-text {
          color: #6b7280;
          font-size: 13px;
        }

        .video-options-block {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .video-line {
          display: flex;
          gap: 36px;
        }

        .video-role {
          width: 70px;
          color: #4b5563;
        }

        .video-state {
          color: #111827;
        }

        .personal-action-bar {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 36px;
          padding-top: 10px;
        }

        .btn-personal-start {
          background-color: #0e71eb;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          padding: 8px 22px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.15s ease;
        }

        .btn-personal-start:hover {
          background-color: #005ce6;
        }

        .btn-personal-copy,
        .btn-personal-edit {
          background-color: #ffffff;
          color: #111827;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: background-color 0.15s ease, border-color 0.15s ease;
        }

        .btn-personal-copy:hover,
        .btn-personal-edit:hover {
          background-color: #f9fafb;
          border-color: #9ca3af;
        }

        /* ---------------- UPCOMING & PREVIOUS FILTER & LISTS ---------------- */
        .filter-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 24px;
          position: relative;
        }

        .date-filter-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          padding: 6px 14px;
          background-color: #ffffff;
          cursor: pointer;
          font-size: 14px;
          color: #111827;
          font-weight: 500;
          user-select: none;
          transition: border-color 0.15s ease;
        }

        .date-filter-pill:hover {
          border-color: #9ca3af;
        }

        .help-icon {
          width: 18px;
          height: 18px;
          border: 1px solid #9ca3af;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #6b7280;
          cursor: help;
        }

        .calendar-popover {
          user-select: none;
        }

        .cal-nav-btn {
          background: transparent;
          border: none;
          width: 24px;
          height: 24px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #111827;
          padding: 0;
          border-radius: 4px;
          transition: color 0.15s ease, background-color 0.15s ease;
        }

        .cal-nav-btn:hover {
          color: #0e71eb;
          background-color: #f1f5f9;
        }

        .cal-cell:hover .cal-day-circle:not(.selected-circle) {
          background-color: #f1f5f9 !important;
        }

        .group-date-header {
          background-color: #f7f8fa;
          border-radius: 6px;
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 700;
          color: #111827;
          margin-top: 20px;
          margin-bottom: 6px;
        }

        .group-meetings-list {
          display: flex;
          flex-direction: column;
        }

        .meeting-row-card {
          display: grid;
          grid-template-columns: minmax(150px, 296px) minmax(160px, 420px) max-content;
          justify-content: start;
          align-items: flex-start;
          padding: 18px 12px;
        }

        .row-col-time {
          display: flex;
          flex-direction: column;
        }

        .time-range-text {
          font-size: 15px;
          font-weight: 700;
          color: #5f6570;
          line-height: 1.3;
          transition: color 0.15s ease;
        }

        /* The hovered (or keyboard-focused) row turns blue and shows its actions. */
        .meeting-row-card:hover .time-range-text,
        .meeting-row-card:hover .timezone-text,
        .meeting-row-card:hover .row-meeting-id,
        .meeting-row-card:hover :global(.row-meeting-title),
        .meeting-row-card:focus-within .time-range-text,
        .meeting-row-card:focus-within .timezone-text,
        .meeting-row-card:focus-within .row-meeting-id,
        .meeting-row-card:focus-within :global(.row-meeting-title) {
          color: #0e71eb !important;
        }

        .timezone-text {
          font-size: 13.5px;
          color: #6e7680;
          margin-top: 3px;
          line-height: 1.4;
        }

        .time-upsell-badge {
          background-color: #f4f5f7;
          border-radius: 8px;
          padding: 8px 12px;
          margin-top: 8px;
          font-size: 12px;
          line-height: 1.4;
          width: fit-content;
        }

        .upsell-heading {
          color: #1f2937;
          font-weight: 500;
        }

        .upsell-action {
          color: #0e71eb;
          text-decoration: none;
          font-weight: 500;
          display: block;
          margin-top: 2px;
        }

        button.upsell-action {
          background: transparent;
          border: none;
          padding: 0;
          font: inherit;
          cursor: pointer;
          text-align: left;
        }

        .upsell-action:hover {
          text-decoration: underline;
        }

        .row-col-info {
          display: flex;
          flex-direction: column;
          padding-left: 20px;
        }

        .row-col-info :global(.row-meeting-title),
        .row-col-info :global(.row-meeting-title:visited) {
          font-size: 15px;
          font-weight: 700;
          color: #5f6570 !important;
          text-decoration: none !important;
          line-height: 1.3;
          display: inline-block;
          cursor: pointer;
          transition: color 0.15s ease;
        }

        .row-col-info :global(.row-meeting-title:hover),
        .row-col-info :global(.row-meeting-title:focus-visible) {
          text-decoration: underline !important;
        }

        .row-meeting-id {
          font-size: 13.5px;
          color: #6e7680;
          margin-top: 6px;
          line-height: 1.3;
        }

        .row-col-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          opacity: 0;
          transition: opacity 0.15s ease;
        }

        .meeting-row-card:hover .row-col-actions,
        .meeting-row-card:focus-within .row-col-actions {
          opacity: 1;
        }

        .btn-action-start {
          background-color: #0e71eb;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          padding: 6px 18px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.15s ease;
        }

        .btn-action-start:hover {
          background-color: #005ce6;
        }

        .btn-action-edit,
        .btn-action-delete {
          background-color: #ffffff;
          color: #111827;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 6px 14px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease;
        }

        .btn-action-edit:hover,
        .btn-action-delete:hover {
          background-color: #f9fafb;
          border-color: #9ca3af;
        }



        .tab-placeholder-box {
          padding: 48px 0;
          color: #6b7280;
          font-size: 14px;
        }

        .tab-placeholder-box h3 {
          margin: 0 0 8px 0;
          color: #111827;
          font-size: 18px;
        }

        .modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.45);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 72px 16px 16px;
          z-index: 1000;
        }

        /* "Sorry, you cannot delete this meeting since it's in progress." */
        .delete-toast {
          position: fixed;
          top: 72px;
          left: 50%;
          z-index: 1100;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 10px;
          max-width: calc(100vw - 32px);
          padding: 12px 18px;
          background: #fff0f2;
          border-radius: 8px;
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
          color: #131619;
          font-size: 15px;
        }

        .delete-toast-icon {
          display: grid;
          place-items: center;
          flex: 0 0 20px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #e8174a;
        }

        .floating-chat-bubble {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background-color: #0e71eb;
          color: #ffffff;
          border: none;
          box-shadow: 0 4px 16px rgba(14, 113, 235, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 100;
          transition: transform 0.15s ease, background-color 0.15s ease;
        }

        .floating-chat-bubble:hover {
          background-color: #005ce6;
          transform: scale(1.05);
        }

        .meetings-status-msg,
        .meetings-empty-box {
          padding: 32px 0;
          color: #6b7280;
          font-size: 14px;
          text-align: center;
        }

        .meetings-error-msg {
          padding: 16px;
          margin-bottom: 20px;
          background: #fef2f2;
          color: #dc2626;
          border-radius: 8px;
          font-size: 14px;
        }

        /* ---------------- RESPONSIVE (tablet and phone only) ---------------- */
        /* Touch screens have no hover: keep Start / Delete visible. */
        @media (hover: none) {
          .row-col-actions {
            opacity: 1;
          }
        }

        @media (max-width: 900px) {
          .meetings-content-area {
            padding: 24px 20px 64px;
          }

          .meeting-row-card {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) max-content;
            gap: 12px;
          }

          /* The tabs scroll sideways instead of widening the page */
          .meetings-tabs-bar {
            overflow-x: auto;
            scrollbar-width: none;
          }

          .meetings-tabs-bar::-webkit-scrollbar {
            display: none;
          }

          .tab-btn {
            flex: 0 0 auto;
            white-space: nowrap;
          }

          .tab-indicator {
            bottom: 0;
          }
        }

        @media (max-width: 640px) {
          .meetings-page-container {
            flex-direction: column;
            min-height: 0;
          }

          .meetings-content-area {
            padding: 16px 12px 88px;
          }

          .meetings-title-row {
            flex-wrap: wrap;
            gap: 12px;
          }

          .meetings-title-row h1 {
            font-size: 22px;
          }

          .schedule-menu {
            min-width: 0;
            width: min(290px, calc(100vw - 24px));
          }

          .plan-upgrade-banner {
            padding: 12px 14px;
            font-size: 13px;
          }

          .meetings-tabs-bar {
            gap: 20px;
          }

          .tab-btn {
            font-size: 15px;
          }

          .meeting-row-card {
            grid-template-columns: minmax(0, 1fr);
            gap: 8px;
            padding: 14px 4px;
          }

          .personal-field-row {
            grid-template-columns: minmax(0, 1fr);
            gap: 4px;
          }

          .invite-link-block,
          .calendar-links-row,
          .personal-action-bar {
            flex-wrap: wrap;
          }

          .invite-url-link {
            overflow-wrap: anywhere;
          }

          .floating-chat-bubble {
            right: 16px;
            bottom: 16px;
          }
        }
      `}</style>
    </div>
  );
}
