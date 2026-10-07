import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import MiniMeeting from "@/components/MiniMeeting";

export const metadata: Metadata = {
  title: "Zoom",
  description: "Zoom Dashboard Replica",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
        {/* The meeting, minimized, while you are on another page */}
        <MiniMeeting />
      </body>
    </html>
  );
}