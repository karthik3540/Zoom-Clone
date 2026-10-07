"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The same sidebar on every page: Home, and Meetings under "My Products".
// `full` and `collapsed` are accepted for existing callers; the content is always the same.
export default function Sidebar({
  collapsed = false,
}: {
  full?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const meetingActive =
    pathname === "/meetings" ||
    pathname === "/schedule" ||
    pathname.startsWith("/meetings/");

  return (
    <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
      <Link href="/" className="sidebar-home">
        Home
      </Link>

      <div className="sidebar-section-title">My Products</div>
      <Link
        href="/meetings"
        className={`sidebar-item ${meetingActive ? "active" : ""}`}
      >
        Meetings
      </Link>
    </aside>
  );
}
