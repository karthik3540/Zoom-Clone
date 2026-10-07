"use client";

// Shows the notices sent with showDemoNotice() (lib/demoNotice.ts) for a few seconds, on every page.

import { useEffect, useRef, useState } from "react";
import { onDemoNotice } from "@/lib/demoNotice";

export default function DemoNotice() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = onDemoNotice((text) => {
      setMessage(text);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMessage(null), 4000);
    });
    return () => {
      unsubscribe();
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  if (!message) return null;
  return (
    <div className="zoom-toast" role="status">
      <span className="toast-icon" aria-hidden="true">ℹ</span>
      {message}
    </div>
  );
}
