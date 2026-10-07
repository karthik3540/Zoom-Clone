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
  const [demoNotice, setDemoNotice] = useState<string | null>(null);

  useEffect(() => {
    setInitial((window.localStorage.getItem("zoom-user-name") ?? "").trim().charAt(0).toLowerCase());
  }, [pathname]);

  const showDemo = (msg = "This demo will be available soon.") => {
    setDemoNotice(msg);
    setTimeout(() => setDemoNotice(null), 3500);
  };

  if (pathname === "/signin") {
    return (
      <header className="signin-header">
        <Link href="/" className="zoom-logo" aria-label="Zoom home"><ZoomLogo /></Link>
        <nav>
          <span>New to Zoom?</span>
          <button type="button" onClick={() => showDemo()}>Sign Up Free</button>
          <button type="button" onClick={() => showDemo()}>Support</button>
          <button type="button" onClick={() => showDemo()}>English</button>
        </nav>
        {demoNotice && (
          <div className="zoom-toast" role="status">
            <span className="toast-icon">ℹ</span>
            {demoNotice}
          </div>
        )}
      </header>
    );
  }

  if (pathname === "/join") {
    return (
      <header className="join-header">
        <Link href="/" className="zoom-logo" aria-label="Zoom home"><ZoomLogo /></Link>
        <nav>
          <button type="button" onClick={() => showDemo()}>Support</button>
          <button type="button" onClick={() => showDemo()}>English</button>
        </nav>
        {demoNotice && (
          <div className="zoom-toast" role="status">
            <span className="toast-icon">ℹ</span>
            {demoNotice}
          </div>
        )}
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
