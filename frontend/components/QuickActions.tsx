"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatMeetingId, getCurrentUser, useHostMeeting } from "@/lib/meetings";

export default function QuickActions() {
  // Schedule, Join and New Meeting each open in a new tab.
  const { host, starting, error } = useHostMeeting({ newTab: true });
  // The signed-in user's permanent Personal Meeting ID, e.g. "603 678 7109".
  const [pmi, setPmi] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then((user) => setPmi(formatMeetingId(user.personal_meeting_id)))
      .catch(() => setPmi(null));
  }, []);

  const handleCopy = async () => {
    if (!pmi) return;
    try {
      await navigator.clipboard.writeText(pmi);
    } catch {}
  };

  return (
    <section className="quick-actions-card">

      <div className="quick-actions">

        {/* Schedule */}
        <Link href="/schedule" className="quick-action" target="_blank" rel="noopener noreferrer">
          <span className="action-icon schedule-icon">
            <span className="calendar-icon">
              <span className="calendar-number">19</span>
            </span>
          </span>

          <span>Schedule</span>
        </Link>


        {/* Join */}
        <Link href="/join" className="quick-action" target="_blank" rel="noopener noreferrer">
          <span className="action-icon join-icon">
            <span className="plus-icon">+</span>
          </span>

          <span>Join</span>
        </Link>


        {/* New Meeting */}
        <a
          href="#"
          role="button"
          className="quick-action"
          onClick={host}
          aria-disabled={starting || undefined}
          aria-busy={starting || undefined}
        >
          <span className="action-icon host-icon">

            <svg
              className="video-camera-svg"
              viewBox="0 0 32 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect
                x="2"
                y="4"
                width="19"
                height="16"
                rx="3"
                fill="white"
              />

              <path
                d="M21 8L29 4.5V19.5L21 16V8Z"
                fill="white"
              />
            </svg>

          </span>

          <span>New Meeting</span>
        </a>

      </div>

      {error && <p className="host-error" role="alert">{error}</p>}


      {/* Meeting ID */}
      <div className="meeting-id">

        <h3>Personal Meeting ID</h3>

        <div className="meeting-id-number">

          <span>{pmi ?? "…"}</span>

          <button
            type="button"
            className="copy-button"
            onClick={handleCopy}
            disabled={!pmi}
            aria-label="Copy Personal Meeting ID"
          >
            <span className="copy-square copy-back" />
            <span className="copy-square copy-front" />
          </button>

        </div>

      </div>

    </section>
  );
}
