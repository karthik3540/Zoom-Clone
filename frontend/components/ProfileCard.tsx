"use client";

import { useEffect, useState } from "react";

export default function ProfileCard() {
  const [name, setName] = useState("");

  useEffect(() => {
    const savedName = window.localStorage.getItem("zoom-user-name");
    if (savedName) setName(savedName);
  }, []);

  const initial = name.trim().charAt(0).toLowerCase();

  // Plans are managed on Zoom's own site.
  const openPlans = () => window.open("https://zoom.us/pricing", "_blank", "noopener,noreferrer");

  return (
    <section className="profile-card">
      {/* LEFT SIDE */}
      <div className="profile-left">
        <div className="profile-avatar" aria-label="Profile">
          {initial}
        </div>

        <div className="profile-info">
          <h1>{name}</h1>

          <p>
            Plan: <strong>Workplace Basic</strong>
          </p>
        </div>
      </div>

      {/* RIGHT SIDE */}
      <div className="profile-actions">
        <button
          type="button"
          className="manage-plan"
          onClick={openPlans}
        >
          Manage Plan
        </button>

        <button
          type="button"
          className="plan-details"
          onClick={openPlans}
        >
          View Plan Details
        </button>
      </div>
    </section>
  );
}
