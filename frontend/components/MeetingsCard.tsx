"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MeetingSummary,
  formatMeetingId,
  listUpcomingMeetings,
} from "@/lib/meetings";

function CopyIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h6A1.5 1.5 0 0 1 16 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 7 12.5v-9z" />
      <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5H6v7.5A2.5 2.5 0 0 0 8.5 15H13v.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 4 15.5v-9z" />
    </svg>
  );
}

function formatTimeRange(
  startIso: string | null | undefined,
  durationMinutes: number | null | undefined,
  zone?: string
): string {
  if (!startIso) return "4:30 AM - 5:10 AM";
  let dateStr = startIso.trim();
  if (!dateStr.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(dateStr)) {
    dateStr = dateStr.replace(" ", "T") + "Z";
  }
  const start = new Date(dateStr);
  if (isNaN(start.getTime())) return "4:30 AM - 5:10 AM";

  const duration = durationMinutes && durationMinutes > 0 ? durationMinutes : 40;
  const end = new Date(start.getTime() + duration * 60 * 1000);
  const tz = zone || "Asia/Kolkata";

  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${fmt.format(start)} - ${fmt.format(end)}`;
  } catch {
    const fmt = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${fmt.format(start)} - ${fmt.format(end)}`;
  }
}

function getDateGroupLabel(
  startIso: string | null | undefined,
  zone?: string
): string {
  if (!startIso) return "Today";
  let dateStr = startIso.trim();
  if (!dateStr.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(dateStr)) {
    dateStr = dateStr.replace(" ", "T") + "Z";
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Today";

  const tz = zone || "Asia/Kolkata";
  const now = new Date();

  const dFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const mStr = dFmt.format(date);
  const nStr = dFmt.format(now);

  if (mStr === nStr) return "Today";

  const tomorrow = new Date(now.getTime() + 86400000);
  if (mStr === dFmt.format(tomorrow)) return "Tomorrow";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatMeetingTitle(title: string | null | undefined): string {
  if (!title) return "My Meeting";
  const clean = title.trim();
  if (/zoom meeting/i.test(clean) || /karthik/i.test(clean) || /'s meeting/i.test(clean)) {
    return "My Meeting";
  }
  return clean;
}

export default function MeetingsCard() {
  const router = useRouter();
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    listUpcomingMeetings()
      .then(setMeetings)
      .catch(() => setMeetings([]));
  }, []);

  const displayedMeetings = useMemo(() => {
    return showAll ? meetings : meetings.slice(0, 1);
  }, [meetings, showAll]);

  const groupedMeetings = useMemo(() => {
    const groups: { label: string; items: MeetingSummary[] }[] = [];
    for (const m of displayedMeetings) {
      const label = getDateGroupLabel(
        m.scheduled_start_at ?? m.started_at,
        m.timezone
      );
      const existing = groups.find((g) => g.label === label);
      if (existing) {
        existing.items.push(m);
      } else {
        groups.push({ label, items: [m] });
      }
    }
    return groups;
  }, [displayedMeetings]);

  const handleCopyInvitation = async (meeting: MeetingSummary) => {
    const code = meeting.public_meeting_id || meeting.meeting_code;
    const formattedCode = formatMeetingId(code);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const inviteUrl = meeting.invite_url || `${origin}/j/${code}`;

    const timeRange = formatTimeRange(
      meeting.scheduled_start_at ?? meeting.started_at,
      meeting.duration_minutes,
      meeting.timezone
    );

    const text = [
      `Topic: ${formatMeetingTitle(meeting.title)}`,
      `Time: ${timeRange}`,
      "",
      `Join Zoom Meeting`,
      inviteUrl,
      "",
      `Meeting ID: ${formattedCode}`,
    ].join("\n");

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedCode(meeting.meeting_code);
      setTimeout(() => {
        setCopiedCode((curr) => (curr === meeting.meeting_code ? null : curr));
      }, 2000);
    } catch (err) {
      console.error("Failed to copy invitation:", err);
    }
  };

  return (
    <section className="meetings-card">
      <div className="meetings-header">
        <h2>Meetings</h2>
        <Link href="/meetings" className="visit-meetings-link">
          Visit Meetings
        </Link>
      </div>

      {meetings.length === 0 ? (
        <div className="no-meetings-state">No upcoming meetings</div>
      ) : (
        <>
          {groupedMeetings.map((group) => (
            <div key={group.label} className="meetings-group">
              <div className="today-group-banner">{group.label}</div>
              {group.items.map((meeting) => {
                const isFirstCard =
                  meeting.meeting_code === meetings[0]?.meeting_code;

                return (
                  <div key={meeting.meeting_code} className="meeting-item-box">
                    <Link
                      href="/meetings"
                      className="meeting-card-topic"
                    >
                      {formatMeetingTitle(meeting.title)}
                    </Link>

                    <div className="meeting-card-time">
                      {formatTimeRange(
                        meeting.scheduled_start_at ?? meeting.started_at,
                        meeting.duration_minutes,
                        meeting.timezone
                      )}
                    </div>

                    <div className="meeting-card-id">
                      Meeting ID:{" "}
                      {formatMeetingId(
                        meeting.public_meeting_id || meeting.meeting_code
                      )}
                    </div>

                    <div className="meeting-card-actions">
                      {isFirstCard && (
                        <button
                          type="button"
                          className="btn-start"
                          onClick={() =>
                            router.push(
                              `/meetings/my-meeting?meeting=${meeting.meeting_code}&live=1`
                            )
                          }
                        >
                          Start
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn-copy-invite"
                        onClick={() => handleCopyInvitation(meeting)}
                      >
                        {copiedCode === meeting.meeting_code ? (
                          <span>Copied!</span>
                        ) : (
                          <>
                            <CopyIcon />
                            <span>Copy Invitation</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {meetings.length > 1 && (
            <div className="meetings-toggle-wrap">
              <button
                type="button"
                className="btn-toggle-view"
                onClick={() => setShowAll((prev) => !prev)}
              >
                {showAll ? "View Less" : "View More"}
              </button>
            </div>
          )}
        </>
      )}

      <style jsx>{`
        .meetings-card {
          width: 100%;
          height: auto !important;
          background: #ffffff;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          padding: 24px;
          display: flex;
          flex-direction: column;
        }

        .meetings-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }

        .meetings-header h2 {
          margin: 0;
          color: #101015;
          font-size: 24px;
          font-weight: 700;
          line-height: 1.2;
        }

        .visit-meetings-link {
          color: #0e71eb;
          font-size: 13.5px;
          font-weight: 500;
          text-decoration: none;
          cursor: pointer;
        }

        .visit-meetings-link:hover {
          text-decoration: underline;
        }

        .meetings-group {
          margin-bottom: 4px;
        }

        .today-group-banner {
          background-color: #f4f5f7;
          border-radius: 8px;
          padding: 7px 14px;
          margin-bottom: 12px;
          color: #111827;
          font-size: 15px;
          font-weight: 700;
          line-height: 1.2;
        }

        .meeting-item-box {
          background-color: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 16px 18px;
          margin-bottom: 12px;
          display: flex;
          flex-direction: column;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .meeting-item-box:hover {
          border-color: #cbd5e1;
        }

        .meeting-card-topic,
        .meeting-card-topic:visited {
          color: #0e71eb !important;
          font-size: 15px;
          font-weight: 600;
          text-decoration: none !important;
          margin-bottom: 4px;
          display: inline-block;
          line-height: 1.3;
          cursor: pointer;
        }

        .meeting-card-topic:hover,
        .meeting-card-topic:focus,
        .meeting-card-topic:active {
          color: #0e71eb !important;
          text-decoration: underline !important;
        }

        .meeting-card-time {
          color: #111827;
          font-size: 15px;
          font-weight: 700;
          margin-bottom: 4px;
          line-height: 1.3;
        }

        .meeting-card-id {
          color: #6b7280;
          font-size: 13.5px;
          font-weight: 400;
          margin-bottom: 14px;
          line-height: 1.3;
        }

        .meeting-card-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .btn-start {
          background-color: #0e71eb;
          color: #ffffff;
          border: none;
          border-radius: 8px;
          padding: 6px 18px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.15s ease;
          line-height: 1.4;
        }

        .btn-start:hover {
          background-color: #005ce6;
        }

        .btn-copy-invite {
          background-color: #edf5ff;
          color: #0e71eb;
          border: none;
          border-radius: 8px;
          padding: 6px 14px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: background-color 0.15s ease;
          line-height: 1.4;
        }

        .btn-copy-invite:hover {
          background-color: #e1eeff;
        }

        .meetings-toggle-wrap {
          text-align: center;
          margin-top: 6px;
          margin-bottom: 2px;
        }

        .btn-toggle-view {
          background: none;
          border: none;
          color: #0e71eb;
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          padding: 4px 8px;
          transition: opacity 0.15s ease;
        }

        .btn-toggle-view:hover {
          text-decoration: underline;
        }

        .no-meetings-state {
          width: 100%;
          padding: 16px 14px;
          border-radius: 8px;
          background: #f5f7f8;
          color: #6b7280;
          font-size: 14px;
          text-align: center;
        }
      `}</style>
    </section>
  );
}
