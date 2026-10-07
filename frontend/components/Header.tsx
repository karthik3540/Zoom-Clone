"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHostMeeting } from "@/lib/meetings";
import ProfileMenu from "@/components/ProfileMenu";
import ZoomLogo from "@/components/ZoomLogo";

export default function Header() {
  const pathname = usePathname();
  const { host, starting, error } = useHostMeeting();
  // The profile logo shows the signed-in user's initial (saved at sign-in).
  const [initial, setInitial] = useState("");

  useEffect(() => {
    setInitial((window.localStorage.getItem("zoom-user-name") ?? "").trim().charAt(0).toLowerCase());
  }, [pathname]);

  if (pathname === "/signin") {
    return (
      <header className="signin-header">
        <Link href="/" className="zoom-logo" aria-label="Zoom home"><ZoomLogo /></Link>
        <nav>
          <span>New to Zoom?</span>
          <Link href="/signin">Sign Up Free</Link>
          <Link href="/meetings">Support</Link>
          <button type="button">English⌄</button>
        </nav>
      </header>
    );
  }

  if (pathname === "/join") {
    return (
      <header className="join-header">
        <Link href="/" className="zoom-logo" aria-label="Zoom home"><ZoomLogo /></Link>
        <nav>
          <Link href="/meetings">Support</Link>
          <button type="button">English⌄</button>
        </nav>
      </header>
    );
  }

  return (
    <header className="top-header">
      <div className="header-left">
        <Link href="/" className="zoom-logo" aria-label="Zoom home"><ZoomLogo /></Link>
      </div>
      <nav className="header-right">
        <Link href="/schedule">Schedule</Link>
        <Link href="/join" className="header-button">Join</Link>
        <div className="header-dropdown">
          <a
            href="#"
            role="button"
            className="header-dropdown-button"
            onClick={host}
            aria-disabled={starting || undefined}
            aria-busy={starting || undefined}
          >
            Host
            <span className="host-chevron" aria-hidden="true" />
          </a>
          {error && <p className="host-error" role="alert">{error}</p>}
        </div>
        <ProfileMenu initial={initial} />
      </nav>
    </header>
  );
}
