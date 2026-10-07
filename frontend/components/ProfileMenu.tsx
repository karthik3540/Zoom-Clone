"use client";

// The header's profile avatar (or the meeting room's Settings button) and its menu:
// who is signed in (name and email) and Sign out, which forgets the account in this
// browser and returns to sign-in. Signing out while in a meeting leaves it first.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SettingsIcon } from "@/components/RoomIcons";
import { signOut } from "@/lib/identity";
import { getActiveMeeting, setActiveMeeting } from "@/lib/activeMeeting";
import { getCurrentUser, leaveMeeting } from "@/lib/meetings";

export default function ProfileMenu({ initial, variant = "avatar" }: { initial: string; variant?: "avatar" | "settings" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Who is signed in: loaded when the menu opens (the name falls back to the one saved at sign-in).
  useEffect(() => {
    if (!open) return;
    setUser((current) => current ?? { name: window.localStorage.getItem("zoom-user-name") ?? "", email: "" });
    getCurrentUser()
      .then((me) => setUser({ name: me.display_name, email: me.email }))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    const meeting = getActiveMeeting();
    if (meeting) {
      await leaveMeeting(meeting.code).catch(() => undefined); // a leaving host hands the host role on
      setActiveMeeting(null);
    }
    signOut();
    setOpen(false);
    router.push("/signin");
  };

  const name = user?.name || "";
  return (
    <div className={`profile-menu-root ${variant === "settings" ? "is-settings zw-rail-settings" : ""}`} ref={rootRef}>
      {variant === "settings" ? (
        <button
          type="button"
          className={`zw-rail-item ${open ? "is-active" : ""}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <SettingsIcon /><span>Settings</span>
        </button>
      ) : (
        <button
          type="button"
          className="profile-button"
          aria-label="Profile"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {initial}
        </button>
      )}

      {open && (
        <div className="profile-menu" role="menu" aria-label="Profile">
          <div className="profile-menu-user">
            <span className="profile-menu-avatar" aria-hidden="true">
              {(name.charAt(0) || initial).toLowerCase()}
            </span>
            <span className="profile-menu-identity">
              <span className="profile-menu-name">{name}</span>
              <span className="profile-menu-email">{user?.email}</span>
            </span>
          </div>
          <div className="profile-menu-divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="profile-menu-item"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
