// Zoom's "Joining Meeting..." screen: a spinning ring over the dark meeting background.

export default function JoiningMeeting({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div className={`zr-joining ${fullPage ? "is-page" : ""}`} role="status" aria-live="polite">
      <span className="zr-joining-spinner" aria-hidden="true" />
      <p>Joining Meeting...</p>
    </div>
  );
}
