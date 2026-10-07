"use client";

// Dashboard "Recent meetings": the latest meetings you hosted or attended that have ended.
// Your own meetings open their details page; the full list is on the Meetings page.

import { useEffect, useState } from "react";
import Link from "next/link";
import { getUserId } from "@/lib/identity";
import { MeetingSummary, formatMeetingId, listPreviousMeetings } from "@/lib/meetings";

const SHOWN = 5;

function whenAndHowLong(meeting: MeetingSummary): string {
  if (!meeting.started_at) return "";
  const start = new Date(meeting.started_at);
  let when: string;
  try {
    when = new Intl.DateTimeFormat("en-US", {
      timeZone: meeting.timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(start);
  } catch {
    when = start.toLocaleString();
  }
  if (!meeting.ended_at) return when;
  const minutes = Math.max(1, Math.round((Date.parse(meeting.ended_at) - start.getTime()) / 60_000));
  return `${when} · ${minutes} min`;
}

export default function RecentActivity() {
  const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    setUserId(getUserId());
    listPreviousMeetings()
      .then(setMeetings)
      .catch(() => setMeetings([]));
  }, []);

  return (
    <section className="recent-card">
      <div className="recent-header">
        <h2>Recent meetings</h2>
        {meetings && meetings.length > 0 && (
          <Link href="/meetings" className="visit-meetings-link">View all</Link>
        )}
      </div>

      <div className="card-divider" />

      {meetings === null ? (
        <p className="recent-loading">Loading…</p>
      ) : meetings.length === 0 ? (
        <div className="empty-activity">
          <div className="package-icon">
            <div className="package-top" />
            <div className="package-body">
              <span />
            </div>
          </div>

          <p>No recent meetings</p>
        </div>
      ) : (
        <ul className="recent-list">
          {meetings.slice(0, SHOWN).map((meeting) => {
            const body = (
              <>
                <span className="recent-item-icon" aria-hidden="true">
                  <svg viewBox="0 0 32 24" width="18" height="14" fill="none">
                    <rect x="2" y="4" width="19" height="16" rx="3" fill="currentColor" />
                    <path d="M21 8L29 4.5V19.5L21 16V8Z" fill="currentColor" />
                  </svg>
                </span>
                <span className="recent-item-text">
                  <span className="recent-item-title">{meeting.title}</span>
                  <span className="recent-item-meta">{whenAndHowLong(meeting)}</span>
                </span>
                <span className="recent-item-id">ID: {formatMeetingId(meeting.public_meeting_id)}</span>
              </>
            );
            return (
              <li key={meeting.meeting_code}>
                {String(meeting.host_id) === userId ? (
                  <Link href={`/meetings/my-meeting?meeting=${meeting.meeting_code}`} className="recent-item">
                    {body}
                  </Link>
                ) : (
                  <div className="recent-item">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
