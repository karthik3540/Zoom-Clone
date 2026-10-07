"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUserId } from "@/lib/identity";
import Sidebar from "@/components/Sidebar";
import ProfileCard from "@/components/ProfileCard";
import QuickActions from "@/components/QuickActions";
import RecentActivity from "@/components/RecentActivity";
import MeetingsCard from "@/components/MeetingsCard";

export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getUserId()) {
      router.replace("/signin");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="zoom-app">
      <div className="app-body">
        <Sidebar />
        <main className="dashboard">
          <div className="dashboard-grid">
            <section className="dashboard-main">
              <ProfileCard />
              <RecentActivity />
            </section>
            <aside className="dashboard-right">
              <QuickActions />
              <MeetingsCard />
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
