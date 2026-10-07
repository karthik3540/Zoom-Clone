import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import MiniMeeting from "@/components/MiniMeeting";
import DemoNotice from "@/components/DemoNotice";

export const metadata: Metadata = {
  title: "Zoom",
  description: "Zoom Dashboard Replica",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
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
        {/* "This is a demo feature..." for buttons that have no feature behind them */}
        <DemoNotice />
      </body>
    </html>
  );
}