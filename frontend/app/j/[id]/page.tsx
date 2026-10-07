"use client";

// Invite links: {FRONTEND_URL}/j/{meeting ID}, as the backend builds them.
// The ID is a meeting's 11-digit code or a host's 10-digit Personal Meeting ID;
// it is resolved to the meeting, then the visitor goes to its room to join.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import JoiningMeeting from "@/components/JoiningMeeting";
import { getPublicMeeting } from "@/lib/meetings";

export default function InviteLinkPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [error, setError] = useState("");

  useEffect(() => {
    const meetingId = decodeURIComponent(id ?? "").replace(/[\s-]/g, "");
    if (!/^\d{10,11}$/.test(meetingId)) {
      setError("This invite link is not valid.");
      return;
    }
    getPublicMeeting(meetingId)
      .then((meeting) => router.replace(`/meetings/my-meeting?live=1&meeting=${meeting.meeting_code}`))
      .catch(() => setError("This meeting does not exist or has been deleted."));
  }, [id, router]);

  if (!error) return <JoiningMeeting fullPage />;

  return (
    <main className="join-page">
      <section className="join-card" aria-live="polite">
        <h1>Can&apos;t join this meeting</h1>
        <p className="host-error" role="alert">{error}</p>
        <Link href="/join">Join with a meeting ID</Link>
      </section>
    </main>
  );
}
