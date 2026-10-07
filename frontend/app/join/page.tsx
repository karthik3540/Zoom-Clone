"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requireSignIn } from "@/lib/identity";
import { getPublicMeeting } from "@/lib/meetings";

export default function JoinPage() {
  const router = useRouter();
  const [meetingId, setMeetingId] = useState("");
  const [showNotice, setShowNotice] = useState(true);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    if (requireSignIn(router)) return;
    setStarted(new URLSearchParams(window.location.search).get("started") === "1");
  }, [router]);

  // Find the real meeting (an 11-digit Meeting ID or a 10-digit Personal Meeting ID, typed or
  // taken from a pasted invite link .../j/<id>), then open its room.
  const openMeeting = async () => {
    const typed = meetingId.trim();
    const fromInviteLink = typed.match(/\/j\/([\d\s-]+)/);
    const id = (fromInviteLink ? fromInviteLink[1] : typed).replace(/[\s-]/g, "");
    if (!id || looking) return;
    if (!/^\d{10,11}$/.test(id)) {
      setError("Enter a 10- or 11-digit meeting ID, or paste the invite link.");
      return;
    }
    setLooking(true);
    setError("");
    try {
      const meeting = await getPublicMeeting(id);
      router.push(`/meetings/my-meeting?live=1&meeting=${meeting.meeting_code}`);
    } catch {
      setError("This meeting ID is not valid. Please check and try again.");
      setLooking(false);
    }
  };

  if (started) {
    return (
      <main className="join-started-page">
        <section className="join-started-card">
          <h1>Join meeting</h1>

          <div className="join-option-row">
            <button className="join-app-button">Join from Zoom Workplace app</button>
            {showNotice && (
              <aside className="join-app-notice">
                <button
                  type="button"
                  aria-label="Close notice"
                  onClick={() => setShowNotice(false)}
                >
                  ×
                </button>
                <strong>Did not open Zoom Workplace app?</strong>
                <span>Please download and install the app and click Join from Zoom Workplace app again.</span>
              </aside>
            )}
          </div>

          <button className="join-browser-button">Join from browser</button>
          <p>Don’t have the Zoom Workplace app installed? <a href="#">Download Now</a></p>
          <p className="join-terms">
            By joining a meeting, you agree to our <a href="#">Terms of Service</a> and <a href="#">Privacy Statement</a>
          </p>
        </section>

        <footer className="join-footer">
          ©2026 Zoom Communications, Inc. All rights reserved.<br />
          Trust Center | Acceptable Use Guidelines | Legal &amp; Compliance | Do Not Sell My Personal Information | Cookie Preferences
        </footer>
      </main>
    );
  }

  return (
    <main className="join-page">
      <section className="join-card" aria-labelledby="join-title">
        <h1 id="join-title">Join Meeting</h1>
        <label htmlFor="meeting-id">Meeting ID or Personal Link Name</label>
        <input
          id="meeting-id"
          value={meetingId}
          onChange={(event) => setMeetingId(event.target.value)}
          placeholder="Enter Meeting ID or invite link"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter") void openMeeting();
          }}
        />
        {error && <p className="host-error" role="alert">{error}</p>}
        <button type="button" disabled={!meetingId.trim() || looking} onClick={openMeeting}>Join</button>
      </section>
    </main>
  );
}
