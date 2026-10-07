"use client";

// The meeting room's Participants panel: the waiting room and the people in
// the room, with the host's per-participant controls. Every change goes
// through the backend, which checks that this browser is the host; the
// buttons shown here are only a convenience.

import { FormEvent, useEffect, useRef, useState } from "react";
import { CaretUpIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from "@/components/RoomIcons";
import { DEMO_MESSAGE } from "@/lib/demoNotice";
import type { HostAction, Participant } from "@/lib/meetings";

type Props = {
  participants: Participant[];
  myId: number | null;
  isHost: boolean;
  onAct: (participantId: number, action: HostAction) => Promise<void>;
  onRename: (participantId: number, name: string) => Promise<void>;
  onMuteAll: () => Promise<number>;
  onInvite: () => void;
  onClose: () => void;
  notify: (message: string) => void;
};

type MenuItem = { label: string; run?: () => void } | "divider";

// The label is kept at call sites for readability; every unavailable action shows the same demo notice.
const UNAVAILABLE = (_feature: string) => DEMO_MESSAGE;
const MENU_HEIGHT = 380;

export default function ParticipantsPanel({
  participants, myId, isHost, onAct, onRename, onMuteAll, onInvite, onClose, notify,
}: Props) {
  const waiting = participants.filter((p) => p.status === "waiting");
  const joined = participants.filter((p) => p.status === "joined");
  const [waitingOpen, setWaitingOpen] = useState(true);
  const [joinedOpen, setJoinedOpen] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ participant: Participant; left: number; top: number } | null>(null);
  const [renaming, setRenaming] = useState<Participant | null>(null);
  const [newName, setNewName] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const run = async (participant: Participant, action: HostAction, done: string) => {
    setMenu(null);
    setBusyId(participant.id);
    try {
      await onAct(participant.id, action);
      notify(done);
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : "Something went wrong. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const openRename = (participant: Participant) => {
    setMenu(null);
    setRenaming(participant);
    setNewName(participant.display_name);
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!renaming || !newName.trim()) return;
    setBusyId(renaming.id);
    try {
      await onRename(renaming.id, newName.trim());
      setRenaming(null);
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : "Couldn't rename. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const openMenu = (participant: Participant, button: HTMLButtonElement) => {
    if (menu?.participant.id === participant.id) {
      setMenu(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    // Below the button, or moved up as far as needed to stay on screen (the menu is about 380px tall).
    const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - MENU_HEIGHT - 8));
    setMenu({ participant, left: Math.max(8, Math.min(rect.right - 230, window.innerWidth - 238)), top });
  };

  const menuItems = (participant: Participant): MenuItem[] => {
    if (participant.id === myId) return [{ label: "Rename", run: () => openRename(participant) }];
    const later = (label: string) => ({ label, run: () => { setMenu(null); notify(UNAVAILABLE(label)); } });
    return [
      later("Chat"),
      later("Ask For Start Video"),
      "divider",
      later("Add Pin"),
      "divider",
      { label: "Make Host", run: () => run(participant, "make-host", `${participant.display_name} is now the host`) },
      { label: "Rename", run: () => openRename(participant) },
      "divider",
      later("Don't Allow to Multi-pin"),
      "divider",
      {
        label: "Put in Waiting Room",
        run: () => run(participant, "waiting-room", `${participant.display_name} was moved to the waiting room`),
      },
      { label: "Remove", run: () => run(participant, "remove", `${participant.display_name} was removed`) },
      later("Report"),
    ];
  };

  const label = (participant: Participant) => {
    const tags = [participant.role === "host" ? "Host" : null, participant.id === myId ? "me" : null].filter(Boolean);
    return tags.length ? `${participant.display_name} (${tags.join(", ")})` : participant.display_name;
  };

  const joinedRow = (participant: Participant) => {
    const canControl = isHost && participant.id !== myId;
    const hasMenu = canControl || participant.id === myId;
    return (
      <li key={participant.id} className={`zp-row ${menu?.participant.id === participant.id ? "is-active" : ""}`}>
        <span className="zp-avatar" aria-hidden="true">{participant.display_name.charAt(0)}</span>
        <span className="zp-name">{label(participant)}</span>
        <span className="zp-status">
          {participant.is_muted
            ? <MicOffIcon size={20} className="zp-off" aria-label="Muted" />
            : <MicIcon size={20} aria-label="Unmuted" />}
          {participant.is_video_on
            ? <VideoIcon size={20} aria-label="Video on" />
            : <VideoOffIcon size={20} className="zp-off" aria-label="Video off" />}
        </span>
        {hasMenu && (
          <span className="zp-actions">
            {canControl && participant.is_muted && (
              <button type="button" className="zp-blue" onClick={() => notify(UNAVAILABLE("Asking to unmute"))}>
                Ask to Unmute
              </button>
            )}
            <button
              type="button"
              className="zp-blue zp-more"
              aria-haspopup="menu"
              aria-expanded={menu?.participant.id === participant.id}
              disabled={busyId === participant.id}
              onClick={(event) => openMenu(participant, event.currentTarget)}
            >
              More <CaretUpIcon className="zp-caret-down" />
            </button>
          </span>
        )}
      </li>
    );
  };

  const sections = isHost && waiting.length > 0;

  return (
    <aside className="zp-panel" aria-label="Participants">
      <header className="zp-header">
        <h2>Participants ({joined.length + (isHost ? waiting.length : 0)})</h2>
        <div className="zp-header-actions">
          <button type="button" aria-label="Pop out" onClick={() => notify(UNAVAILABLE("Popping out the panel"))}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
          </button>
          <button type="button" aria-label="Close participants" onClick={onClose}>✕</button>
        </div>
      </header>

      <div className="zp-body">
        {sections && (
          <section aria-label="Waiting Room">
            <div className="zp-section-head">
              <button
                type="button"
                className="zp-section-toggle"
                aria-expanded={waitingOpen}
                onClick={() => setWaitingOpen(!waitingOpen)}
              >
                Waiting Room ({waiting.length}) <CaretUpIcon className={waitingOpen ? "zp-caret-down" : "zp-caret-right"} />
              </button>
              <button type="button" className="zp-blue" onClick={() => notify(UNAVAILABLE("Messaging the waiting room"))}>
                Message
              </button>
            </div>
            {waitingOpen && (
              <ul className="zp-list">
                {waiting.map((participant) => (
                  <li key={participant.id} className="zp-row is-waiting">
                    <span className="zp-avatar" aria-hidden="true">{participant.display_name.charAt(0)}</span>
                    <span className="zp-name">{participant.display_name}</span>
                    <span className="zp-actions">
                      <button
                        type="button"
                        className="zp-blue"
                        disabled={busyId === participant.id}
                        onClick={() => run(participant, "admit", `${participant.display_name} was admitted`)}
                      >
                        Admit
                      </button>
                      <button
                        type="button"
                        className="zp-blue"
                        disabled={busyId === participant.id}
                        onClick={() => run(participant, "remove", `${participant.display_name} was removed`)}
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section aria-label="Joined">
          {sections && (
            <div className="zp-section-head">
              <button
                type="button"
                className="zp-section-toggle"
                aria-expanded={joinedOpen}
                onClick={() => setJoinedOpen(!joinedOpen)}
              >
                Joined ({joined.length}) <CaretUpIcon className={joinedOpen ? "zp-caret-down" : "zp-caret-right"} />
              </button>
            </div>
          )}
          {(joinedOpen || !sections) && <ul className="zp-list">{joined.map(joinedRow)}</ul>}
        </section>
      </div>

      <footer className="zp-footer">
        <button type="button" onClick={onInvite}>Invite</button>
        {isHost && (
          <button
            type="button"
            onClick={async () => {
              try {
                const muted = await onMuteAll();
                notify(muted === 1 ? "1 participant was muted" : `${muted} participants were muted`);
              } catch (failure) {
                notify(failure instanceof Error ? failure.message : "Couldn't mute everyone.");
              }
            }}
          >
            Mute All
          </button>
        )}
        <button type="button" onClick={() => notify(UNAVAILABLE("More participant options"))}>More</button>
      </footer>

      {menu && (
        <div
          ref={menuRef}
          className="zp-menu"
          role="menu"
          aria-label={`Options for ${menu.participant.display_name}`}
          style={{ left: menu.left, top: menu.top }}
        >
          {menuItems(menu.participant).map((item, index) =>
            item === "divider"
              ? <div key={`divider-${index}`} className="zp-menu-divider" role="separator" />
              : <button key={item.label} type="button" role="menuitem" onClick={item.run}>{item.label}</button>,
          )}
        </div>
      )}

      {renaming && (
        <div className="zp-dialog-backdrop" onClick={() => setRenaming(null)}>
          <form
            className="zp-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="zp-rename-title"
            onSubmit={submitRename}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="zp-rename-title">Rename</h3>
            <label htmlFor="zp-rename-input">Enter a new screen name:</label>
            <input
              id="zp-rename-input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={64}
              autoFocus
            />
            <div className="zp-dialog-buttons">
              <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
              <button type="submit" className="zp-blue" disabled={!newName.trim() || busyId === renaming.id}>Rename</button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}
