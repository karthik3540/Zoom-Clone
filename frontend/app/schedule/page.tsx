"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import { getUserId } from "@/lib/identity";
import {
  AttachmentKind,
  MeetingIdType,
  ScheduleForm,
  TIME_ZONES,
  createScheduledMeeting,
  formatMeetingId,
  getCurrentUser,
  getMeetingDetails,
  isMeetingCode,
  updateScheduledMeeting,
  wallClock,
} from "@/lib/meetings";

const DEFAULT_ZONE = "Asia/Kolkata";
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  return `${String(hour || 12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});
const HOUR_OPTIONS = Array.from({ length: 25 }, (_, hour) => hour);
const MINUTE_OPTIONS = [0, 15, 30, 40, 45];
const TEMPLATES = [{ value: "my-template", label: "My Template" }];
const PASSCODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A passcode the form starts with, as Zoom does; the user can change it or switch it off. */
function suggestPasscode(): string {
  const values = crypto.getRandomValues(new Uint32Array(6));
  return Array.from(values, (v) => PASSCODE_CHARACTERS[v % PASSCODE_CHARACTERS.length]).join("");
}

/** The next half hour, on the wall clock of `zone`. */
function nextHalfHour(zone: string) {
  const step = 30 * 60 * 1000;
  return wallClock(new Date(Math.ceil(Date.now() / step) * step).toISOString(), zone);
}

export default function SchedulePage() {
  const router = useRouter();
  const [editCode, setEditCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const [pmi, setPmi] = useState<string | null>(null);
  const [generatedId, setGeneratedId] = useState<string | null>(null);

  // Form values
  const [title, setTitle] = useState("My Meeting");
  const [showDescription, setShowDescription] = useState(false);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("12:00");
  const [ampm, setAmpm] = useState<"AM" | "PM">("PM");
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(40);
  const [zone, setZone] = useState(DEFAULT_ZONE);
  const [idType, setIdType] = useState<MeetingIdType>("generated");
  const [template, setTemplate] = useState("");
  const [attachments, setAttachments] = useState<{ kind: AttachmentKind; title: string }[]>([]);
  const [passcodeOn, setPasscodeOn] = useState(true);
  const [passcode, setPasscode] = useState("");
  const [waitingRoom, setWaitingRoom] = useState(false);
  const [encryption, setEncryption] = useState<"enhanced" | "end_to_end">("enhanced");
  const [notesOn, setNotesOn] = useState(true);
  const [notesScope, setNotesScope] = useState<"organization_only" | "all_participants">("all_participants");
  const [hostVideo, setHostVideo] = useState(false);
  const [participantVideo, setParticipantVideo] = useState(false);

  useEffect(() => {
    if (!getUserId()) {
      router.replace("/signin");
      return;
    }
    // The Personal Meeting ID shown next to the radio is the signed-in user's own.
    getCurrentUser()
      .then((user) => setPmi(user.personal_meeting_id))
      .catch(() => setPmi(null));

    const code = new URLSearchParams(window.location.search).get("meeting");
    if (!isMeetingCode(code)) {
      const start = nextHalfHour(DEFAULT_ZONE);
      setDate(start.date);
      setTime(start.time);
      setAmpm(start.ampm);
      setPasscode(suggestPasscode());
      setLoading(false);
      return;
    }

    // Edit: start from what is saved.
    setEditCode(code);
    getMeetingDetails(code)
      .then((meeting) => {
        if (meeting.status !== "scheduled" || !meeting.scheduled_start_at || meeting.duration_minutes === null) {
          setError("Only upcoming meetings can be edited.");
          return;
        }
        const start = wallClock(meeting.scheduled_start_at, meeting.timezone);
        setGeneratedId(meeting.meeting_code);
        setTitle(meeting.title);
        setDescription(meeting.description ?? "");
        setShowDescription(Boolean(meeting.description));
        setDate(start.date);
        setTime(start.time);
        setAmpm(start.ampm);
        setHours(Math.floor(meeting.duration_minutes / 60));
        setMinutes(meeting.duration_minutes % 60);
        setZone(meeting.timezone);
        setIdType(meeting.meeting_id_type);
        setTemplate(meeting.template ?? "");
        setAttachments(meeting.attachments.map(({ kind, title: name }) => ({ kind, title: name })));
        setPasscodeOn(meeting.passcode !== null);
        setPasscode(meeting.passcode ?? "");
        setWaitingRoom(meeting.waiting_room_enabled);
        setEncryption(meeting.encryption_mode);
        setNotesOn(meeting.notes_enabled);
        setNotesScope(meeting.notes_scope ?? "all_participants");
        setHostVideo(meeting.host_video_enabled);
        setParticipantVideo(meeting.participant_video_enabled);
      })
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setLoading(false));
  }, [router]);

  const addAttachment = (kind: AttachmentKind) => {
    const base = kind === "whiteboard" ? "Untitled Whiteboard" : "Untitled Doc";
    const count = attachments.filter((a) => a.kind === kind).length;
    setAttachments((current) => [...current, { kind, title: count ? `${base} ${count + 1}` : base }]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (savingRef.current) return;
    const durationMinutes = hours * 60 + minutes;
    if (!title.trim()) return setError("Enter a topic for the meeting.");
    if (!date) return setError("Choose a date.");
    if (durationMinutes < 1) return setError("Choose a duration longer than 0 minutes.");
    if (passcodeOn && !passcode.trim()) return setError("Enter a passcode, or turn the passcode off.");

    const [hour12, minute] = time.split(":").map(Number);
    const hour24 = (hour12 % 12) + (ampm === "PM" ? 12 : 0);
    const form: ScheduleForm = {
      title: title.trim(),
      description: description.trim() || null,
      scheduled_start_at: `${date} ${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`,
      duration_minutes: durationMinutes,
      timezone: zone,
      meeting_id_type: idType,
      passcode: passcodeOn ? passcode.trim() : null,
      waiting_room_enabled: waitingRoom,
      encryption_mode: encryption,
      notes_enabled: notesOn,
      notes_scope: notesOn ? notesScope : null,
      host_video_enabled: hostVideo,
      participant_video_enabled: participantVideo,
      template: idType === "generated" ? (template || null) : null,
      attachments: idType === "generated" ? attachments : [],
    };

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const meeting = editCode ? await updateScheduledMeeting(editCode, form) : await createScheduledMeeting(form);
      router.push(`/meetings/my-meeting?meeting=${meeting.meeting_code}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't save the meeting. Please try again.");
      savingRef.current = false;
      setSaving(false);
    }
  };

  const timeOptions = TIME_OPTIONS.includes(time) ? TIME_OPTIONS : [...TIME_OPTIONS, time];
  const minuteOptions = MINUTE_OPTIONS.includes(minutes) ? MINUTE_OPTIONS : [...MINUTE_OPTIONS, minutes].sort((a, b) => a - b);
  const zoneOptions = TIME_ZONES.some((z) => z.value === zone) ? TIME_ZONES : [...TIME_ZONES, { value: zone, label: zone, place: zone }];
  const templateOptions = !template || TEMPLATES.some((t) => t.value === template)
    ? TEMPLATES
    : [...TEMPLATES, { value: template, label: template }];
  const cancelHref = editCode ? `/meetings/my-meeting?meeting=${editCode}` : "/meetings";

  return (
    <div className="schedule-layout">
      <Sidebar />

      <main className="schedule-main">
        <div className="schedule-container">
          {/* Back */}
          <Link href="/meetings" className="back-link">
            ‹ &nbsp; Back to Meetings
          </Link>

          {/* Heading */}
          <h1 className="schedule-title">{editCode ? "Edit Meeting" : "Schedule Meeting"}</h1>

          {loading ? (
            <p className="schedule-status">Loading…</p>
          ) : (
            <>
              {/* Topic */}
              <div className="zoom-form-row">
                <div className="zoom-form-label required">Topic</div>
                <div className="zoom-form-content">
                  <input
                    type="text"
                    className="zoom-text-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                  />

                  {showDescription ? (
                    <textarea
                      className="zoom-text-input zoom-textarea"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Description"
                      rows={3}
                      aria-label="Description"
                    />
                  ) : (
                    <button type="button" className="zoom-link-button" onClick={() => setShowDescription(true)}>
                      ＋ Add Description
                    </button>
                  )}
                </div>
              </div>

              {/* When */}
              <div className="zoom-form-row">
                <div className="zoom-form-label">When</div>
                <div className="zoom-form-content">
                  <div className="zoom-inline-group">
                    <input
                      className="zoom-select-input date-field"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      aria-label="Date"
                    />
                    <select
                      className="zoom-select-input time-field"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      aria-label="Time"
                    >
                      {timeOptions.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                    <select
                      className="zoom-select-input ampm-field"
                      value={ampm}
                      onChange={(e) => setAmpm(e.target.value as "AM" | "PM")}
                      aria-label="AM or PM"
                    >
                      <option>AM</option>
                      <option>PM</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Duration */}
              <div className="zoom-form-row">
                <div className="zoom-form-label">Duration</div>
                <div className="zoom-form-content">
                  <div className="zoom-inline-group">
                    <select
                      className="zoom-select-input duration-field"
                      value={hours}
                      onChange={(e) => setHours(Number(e.target.value))}
                      aria-label="Duration hours"
                    >
                      {HOUR_OPTIONS.map((hour) => (
                        <option key={hour} value={hour}>{hour}</option>
                      ))}
                    </select>
                    <span className="unit-label">hr</span>

                    <select
                      className="zoom-select-input duration-field"
                      value={minutes}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                      aria-label="Duration minutes"
                    >
                      {minuteOptions.map((minute) => (
                        <option key={minute} value={minute}>{minute}</option>
                      ))}
                    </select>
                    <span className="unit-label">min</span>
                  </div>

                  <div className="zoom-warning-box">
                    <span className="warning-icon">⚠</span>
                    <div className="warning-text">
                      <div>
                        You can schedule meetings for up to 40 minutes each with your current Basic plan. Need more time?
                      </div>
                      <a href="#" className="zoom-link">Upgrade to Zoom Workplace Pro</a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Time Zone */}
              <div className="zoom-form-row">
                <div className="zoom-form-label">Time Zone</div>
                <div className="zoom-form-content">
                  <select
                    className="zoom-select-input full-width-field"
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                    aria-label="Time zone"
                  >
                    {zoneOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Recurring */}
              <div className="zoom-form-row">
                <div className="zoom-form-label"></div>
                <div className="zoom-form-content">
                  <label className="zoom-checkbox-row disabled">
                    <input type="checkbox" disabled />
                    <span>Recurring meeting</span>
                  </label>
                </div>
              </div>

              {/* Invitees */}
              <div className="zoom-form-row">
                <div className="zoom-form-label">Invitees</div>
                <div className="zoom-form-content">
                  <input
                    type="text"
                    className="zoom-text-input full-width-field"
                    placeholder="Enter user names or email addresses"
                  />
                </div>
              </div>

              {/* Meeting ID */}
              <div className="zoom-form-row">
                <div className="zoom-form-label">Meeting ID</div>
                <div className="zoom-form-content">
                  <div className="zoom-horizontal-radios">
                    <label className="zoom-radio-label">
                      <input
                        type="radio"
                        name="meetingId"
                        checked={idType === "generated"}
                        onChange={() => setIdType("generated")}
                      />
                      <span>
                        {generatedId ? `Generated ID ${formatMeetingId(generatedId)}` : "Generate Automatically"}
                      </span>
                    </label>

                    <label className="zoom-radio-label">
                      <input
                        type="radio"
                        name="meetingId"
                        checked={idType === "personal"}
                        onChange={() => setIdType("personal")}
                        disabled={!pmi}
                      />
                      <span>
                        Personal Meeting ID {pmi ? formatMeetingId(pmi) : "603 678 7109"}
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {/* CONDITIONAL SECTION: Template, Whiteboard, and Docs ONLY appear when idType is 'generated' */}
              {idType === "generated" && (
                <>
                  {/* Template */}
                  <div className="zoom-form-row">
                    <div className="zoom-form-label">Template</div>
                    <div className="zoom-form-content">
                      <select
                        className="zoom-select-input template-select-field"
                        value={template}
                        onChange={(e) => setTemplate(e.target.value)}
                        aria-label="Template"
                      >
                        <option value="">Select a template</option>
                        {templateOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Whiteboard */}
                  <div className="zoom-form-row">
                    <div className="zoom-form-label">
                      Whiteboard <span className="zoom-info-badge" title="Zoom Whiteboard integration">ⓘ</span>
                    </div>
                    <div className="zoom-form-content">
                      <button
                        type="button"
                        className="zoom-pill-button"
                        onClick={() => addAttachment("whiteboard")}
                      >
                        <svg className="pill-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="3" width="20" height="14" rx="2" />
                          <path d="M8 21h8" />
                          <path d="M12 17v4" />
                        </svg>
                        Add Whiteboard
                      </button>
                      <AttachmentChips items={attachments} kind="whiteboard" onRemove={removeAttachment} />
                    </div>
                  </div>

                  {/* Docs */}
                  <div className="zoom-form-row">
                    <div className="zoom-form-label">Docs</div>
                    <div className="zoom-form-content">
                      <button
                        type="button"
                        className="zoom-pill-button"
                        onClick={() => addAttachment("doc")}
                      >
                        <svg className="pill-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                        Add Docs
                      </button>
                      <AttachmentChips items={attachments} kind="doc" onRemove={removeAttachment} />
                    </div>
                  </div>
                </>
              )}

              {/* Security */}
              <div className="zoom-form-row">
                <div className="zoom-form-label">Security</div>
                <div className="zoom-form-content security-column">
                  <div className="security-subrow">
                    <label className="zoom-checkbox-label">
                      <input
                        type="checkbox"
                        checked={passcodeOn}
                        onChange={(e) => setPasscodeOn(e.target.checked)}
                      />
                      <span className={passcodeOn ? "font-medium" : "text-gray-400"}>Passcode</span>
                    </label>

                    <input
                      type="text"
                      className="zoom-passcode-input"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      disabled={!passcodeOn}
                      maxLength={10}
                      aria-label="Passcode"
                    />
                  </div>

                  <p className="zoom-helper-text">
                    Only users who have the invite link or passcode can join the meeting
                  </p>

                  <div className="security-subrow mt-2">
                    <label className="zoom-checkbox-label">
                      <input
                        type="checkbox"
                        checked={waitingRoom}
                        onChange={(e) => setWaitingRoom(e.target.checked)}
                      />
                      <span>Waiting Room</span>
                    </label>
                  </div>

                  <p className="zoom-helper-text">
                    Only users admitted by the host can join the meeting
                  </p>
                </div>
              </div>

              {/* Divider */}
              <div className="zoom-section-divider"></div>

              {/* Encryption */}
              <div className="zoom-form-row">
                <div className="zoom-form-label">Encryption</div>
                <div className="zoom-form-content">
                  <div className="zoom-horizontal-radios">
                    <label className="zoom-radio-label">
                      <input
                        type="radio"
                        name="encryption"
                        checked={encryption === "enhanced"}
                        onChange={() => setEncryption("enhanced")}
                      />
                      <span className="inline-flex items-center gap-1.5">
                        <svg className="shield-green-icon" viewBox="0 0 24 24" fill="#0E9F6E">
                          <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z" />
                          <path d="m9 12 2 2 4-4" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                        Enhanced encryption
                        <span className="zoom-info-badge">ⓘ</span>
                      </span>
                    </label>

                    <label className="zoom-radio-label">
                      <input
                        type="radio"
                        name="encryption"
                        checked={encryption === "end_to_end"}
                        onChange={() => setEncryption("end_to_end")}
                      />
                      <span className="inline-flex items-center gap-1.5">
                        <svg className="shield-green-icon" viewBox="0 0 24 24" fill="#0E9F6E">
                          <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z" />
                          <rect x="9" y="11" width="6" height="5" rx="1" fill="#ffffff" />
                          <path d="M10 11V9a2 2 0 1 1 4 0v2" stroke="#ffffff" strokeWidth="1.5" fill="none" />
                        </svg>
                        End-to-end encryption
                        <span className="zoom-info-badge">ⓘ</span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {/* My Notes */}
              <div className="zoom-form-row">
                <div className="zoom-form-label">My Notes</div>
                <div className="zoom-form-content">
                  <label className="zoom-checkbox-label">
                    <input
                      type="checkbox"
                      checked={notesOn}
                      onChange={(e) => setNotesOn(e.target.checked)}
                    />
                    <span>Allow participants to transcribe meeting with My Notes</span>
                  </label>

                  <div className="zoom-indented-radios">
                    <label className="zoom-radio-label">
                      <input
                        type="radio"
                        name="participants"
                        checked={notesScope === "organization_only"}
                        onChange={() => setNotesScope("organization_only")}
                        disabled={!notesOn}
                      />
                      <span>Only participants in your organization</span>
                    </label>

                    <label className="zoom-radio-label">
                      <input
                        type="radio"
                        name="participants"
                        checked={notesScope === "all_participants"}
                        onChange={() => setNotesScope("all_participants")}
                        disabled={!notesOn}
                      />
                      <span>All participants</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Video */}
              <div className="zoom-form-row">
                <div className="zoom-form-label">Video</div>
                <div className="zoom-form-content video-table-layout">
                  <div className="video-entity-row">
                    <span className="entity-title">Host</span>
                    <label className="zoom-radio-label inline-radio">
                      <input type="radio" name="host-video" checked={hostVideo} onChange={() => setHostVideo(true)} />
                      <span>on</span>
                    </label>
                    <label className="zoom-radio-label inline-radio">
                      <input type="radio" name="host-video" checked={!hostVideo} onChange={() => setHostVideo(false)} />
                      <span>off</span>
                    </label>
                  </div>

                  <div className="video-entity-row">
                    <span className="entity-title">Participant</span>
                    <label className="zoom-radio-label inline-radio">
                      <input
                        type="radio"
                        name="participant-video"
                        checked={participantVideo}
                        onChange={() => setParticipantVideo(true)}
                      />
                      <span>on</span>
                    </label>
                    <label className="zoom-radio-label inline-radio">
                      <input
                        type="radio"
                        name="participant-video"
                        checked={!participantVideo}
                        onChange={() => setParticipantVideo(false)}
                      />
                      <span>off</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Options */}
              <div className="zoom-form-row">
                <div className="zoom-form-label">Options</div>
                <div className="zoom-form-content">
                  <button type="button" className="zoom-link-button font-normal">
                    Show
                  </button>
                </div>
              </div>
            </>
          )}

          {error && <p className="schedule-error" role="alert">{error}</p>}

          {/* Bottom buttons */}
          <div className="zoom-actions-row">
            <button
              type="button"
              className="zoom-primary-save-btn"
              onClick={save}
              disabled={loading || saving || (Boolean(editCode) && !generatedId)}
              aria-busy={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>

            <button
              type="button"
              className="zoom-secondary-cancel-btn"
              onClick={() => router.push(cancelHref)}
            >
              Cancel
            </button>
          </div>
        </div>
      </main>

      {/* Scoped CSS targeting this page to ensure pixel-perfect Zoom visual design */}
      <style jsx>{`
        .zoom-form-row {
          display: grid;
          grid-template-columns: 160px minmax(0, 1fr);
          gap: 28px;
          align-items: start;
          max-width: 960px;
          margin-bottom: 22px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        .zoom-form-label {
          padding-top: 6px;
          font-size: 14px;
          color: #232333;
          font-weight: 400;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .zoom-form-label.required::before {
          content: "*";
          color: #e53935;
          margin-right: 2px;
        }

        .zoom-form-content {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;
          width: 100%;
        }

        .zoom-inline-group {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .unit-label {
          font-size: 14px;
          color: #555566;
          margin-right: 4px;
        }

        /* Text Input & Textarea */
        .zoom-text-input {
          width: 100%;
          max-width: 440px;
          height: 38px;
          padding: 0 14px;
          font-size: 14px;
          color: #232333;
          background: #ffffff;
          border: 1px solid #d0d5dd;
          border-radius: 8px;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }

        .zoom-text-input:focus {
          border-color: #0e71eb;
          box-shadow: 0 0 0 3px rgba(14, 113, 235, 0.12);
        }

        .zoom-textarea {
          height: auto;
          padding: 10px 14px;
          resize: vertical;
        }

        /* Custom Styled Dropdowns */
        .zoom-select-input {
          height: 38px;
          padding: 0 32px 0 14px;
          font-size: 14px;
          color: #232333;
          background-color: #ffffff;
          border: 1px solid #d0d5dd;
          border-radius: 8px;
          outline: none;
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
          background-repeat: no-repeat;
          background-position: right 10px center;
          background-size: 16px;
          transition: border-color 0.15s;
        }

        .zoom-select-input:focus {
          border-color: #0e71eb;
          box-shadow: 0 0 0 3px rgba(14, 113, 235, 0.12);
        }

        .date-field { width: 180px; }
        .time-field { width: 140px; }
        .ampm-field { width: 85px; }
        .duration-field { width: 90px; }
        .full-width-field { width: 100%; max-width: 440px; }
        .template-select-field { width: 100%; max-width: 440px; }

        /* Radios and Checkboxes */
        .zoom-horizontal-radios {
          display: flex;
          align-items: center;
          gap: 28px;
          padding-top: 6px;
        }

        .zoom-radio-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          color: #232333;
          cursor: pointer;
          user-select: none;
        }

        .zoom-radio-label input[type="radio"] {
          width: 17px;
          height: 17px;
          accent-color: #0e71eb;
          cursor: pointer;
          margin: 0;
        }

        .zoom-checkbox-label,
        .zoom-checkbox-row {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          color: #232333;
          cursor: pointer;
          user-select: none;
        }

        .zoom-checkbox-label input[type="checkbox"],
        .zoom-checkbox-row input[type="checkbox"] {
          width: 17px;
          height: 17px;
          accent-color: #0e71eb;
          cursor: pointer;
          border-radius: 4px;
          margin: 0;
        }

        .zoom-indented-radios {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 8px;
          margin-left: 26px;
        }

        /* Pill Buttons: Add Whiteboard / Add Docs */
        .zoom-pill-button {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 18px;
          background: #edf5ff;
          color: #0e71eb;
          font-size: 14px;
          font-weight: 500;
          border: 1px solid rgba(14, 113, 235, 0.12);
          border-radius: 8px;
          cursor: pointer;
          transition: background-color 0.15s, border-color 0.15s;
        }

        .zoom-pill-button:hover {
          background: #e1effe;
          border-color: rgba(14, 113, 235, 0.25);
        }

        .pill-btn-icon {
          width: 16px;
          height: 16px;
        }

        /* Info Badge Icon ⓘ */
        .zoom-info-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #717680;
          font-size: 13px;
          font-weight: normal;
          cursor: help;
          margin-left: 3px;
        }

        /* Security Section */
        .security-column {
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 100%;
        }

        .security-subrow {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .zoom-passcode-input {
          width: 140px;
          height: 34px;
          padding: 0 12px;
          font-size: 14px;
          font-weight: 500;
          color: #232333;
          background: #ffffff;
          border: 1px solid #d0d5dd;
          border-radius: 6px;
          outline: none;
        }

        .zoom-passcode-input:focus {
          border-color: #0e71eb;
        }

        .zoom-helper-text {
          margin: 2px 0 6px 26px;
          font-size: 13px;
          color: #667085;
          line-height: 1.4;
        }

        /* Divider */
        .zoom-section-divider {
          max-width: 960px;
          height: 1px;
          background: #eaecf0;
          margin: 16px 0 24px;
        }

        /* Shield Icons */
        .shield-green-icon {
          width: 17px;
          height: 17px;
          display: inline-block;
          vertical-align: middle;
        }

        /* Video Settings Table */
        .video-table-layout {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding-top: 6px;
        }

        .video-entity-row {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .entity-title {
          width: 90px;
          font-size: 14px;
          color: #232333;
        }

        .inline-radio {
          min-width: 50px;
        }

        /* Links and Secondary Buttons */
        .zoom-link-button {
          background: none;
          border: none;
          color: #0e71eb;
          font-size: 14px;
          cursor: pointer;
          padding: 0;
          text-decoration: none;
        }

        .zoom-link-button:hover {
          text-decoration: underline;
        }

        .zoom-warning-box {
          display: flex;
          gap: 10px;
          background: #fffdfa;
          border: 1px solid #f9d8b7;
          border-radius: 8px;
          padding: 12px 14px;
          max-width: 680px;
          margin-top: 8px;
          font-size: 13px;
          line-height: 1.5;
          color: #4b5563;
        }

        .warning-icon {
          color: #d97706;
          font-size: 16px;
        }

        .zoom-link {
          color: #0e71eb;
          text-decoration: none;
          font-weight: 500;
        }

        .zoom-link:hover {
          text-decoration: underline;
        }

        /* Action Buttons */
        .zoom-actions-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 36px;
          padding-top: 16px;
        }

        .zoom-primary-save-btn {
          height: 38px;
          padding: 0 26px;
          background: #0e71eb;
          color: #ffffff;
          font-size: 14px;
          font-weight: 500;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: background-color 0.15s;
        }

        .zoom-primary-save-btn:hover:not(:disabled) {
          background: #005ce6;
        }

        .zoom-primary-save-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .zoom-secondary-cancel-btn {
          height: 38px;
          padding: 0 22px;
          background: #f0f3f7;
          color: #0e71eb;
          font-size: 14px;
          font-weight: 500;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: background-color 0.15s;
        }

        .zoom-secondary-cancel-btn:hover {
          background: #e4e9f0;
        }

        @media (max-width: 768px) {
          .zoom-form-row {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .zoom-horizontal-radios {
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
          }
        }

        /* Phone: date on its own line, then time and AM/PM; buttons wrap */
        @media (max-width: 640px) {
          .zoom-inline-group {
            flex-wrap: wrap;
            width: 100%;
          }
          .date-field {
            flex: 1 1 100%;
            width: 100%;
            max-width: 440px;
          }
          .time-field {
            flex: 1 1 0;
            width: auto;
            min-width: 0;
          }
          .zoom-actions-row {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </div>
  );
}

function AttachmentChips({ items, kind, onRemove }: {
  items: { kind: AttachmentKind; title: string }[];
  kind: AttachmentKind;
  onRemove: (index: number) => void;
}) {
  const mine = items.map((item, index) => ({ ...item, index })).filter((item) => item.kind === kind);
  if (!mine.length) return null;
  return (
    <ul className="schedule-attachments">
      {mine.map((item) => (
        <li key={item.index}>
          <span>{item.title}</span>
          <button type="button" aria-label={`Remove ${item.title}`} onClick={() => onRemove(item.index)}>×</button>
        </li>
      ))}
    </ul>
  );
}
