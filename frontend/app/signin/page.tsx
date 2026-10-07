"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { identifyUser, safeNextPath, saveUserId } from "@/lib/identity";

export default function SignInPage() {
  const router = useRouter();
  const [identity, setIdentity] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);

  const showDemo = (msg = "This demo will be available soon.") => {
    setDemoNotice(msg);
    setTimeout(() => setDemoNotice(null), 3500);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = identity.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const user = await identifyUser(value);
      saveUserId(user.id);
      window.localStorage.setItem("zoom-user-name", user.display_name);
      // Back to the meeting (or other page) that sent them here, otherwise Home.
      router.push(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't sign in. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <main className="signin-page">
      <section className="signin-promo">
        <div className="promo-orb promo-orb-one" />
        <div className="promo-orb promo-orb-two" />
        <div className="promo-content">
          <div className="promo-wordmark">zoomtopia</div>
          <p>New products. Big ideas. Fresh inspiration.</p>
          <p>Be part of what&apos;s next at Zoomtopia 2026.</p>
          <strong>October 22</strong>
          <button type="button" onClick={() => showDemo()}>Register now</button>
        </div>
      </section>

      <section className="signin-panel">
        <h1>Sign in</h1>
        <form onSubmit={handleSubmit}>
          <label htmlFor="signin-identity">Enter email</label>
          <input
            id="signin-identity"
            value={identity}
            onChange={(event) => setIdentity(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "signin-error" : undefined}
            autoFocus
          />
          {error && <p id="signin-error" className="signin-error" role="alert">{error}</p>}
          <button type="submit" disabled={!identity.trim() || submitting}>Next</button>
        </form>
        <div className="signin-divider">Or sign in with</div>
        <div className="signin-providers">
          <button type="button" onClick={() => showDemo()}>SSO</button>
          <button type="button" onClick={() => showDemo()}>Apple</button>
          <button type="button" onClick={() => showDemo()}>Google</button>
          <button type="button" onClick={() => showDemo()}>Facebook</button>
          <button type="button" onClick={() => showDemo()}>Microsoft</button>
        </div>
        <button type="button" className="forgot-link" onClick={() => showDemo()}>Forgot email?</button>
        <div className="signin-links">
          <button type="button" onClick={() => showDemo()}>Help</button>
          <button type="button" onClick={() => showDemo()}>Terms</button>
          <button type="button" onClick={() => showDemo()}>Privacy</button>
        </div>
        <p className="recaptcha-note">Zoom is protected by reCAPTCHA and the Google Privacy Policy and Terms of Service apply.</p>

        {demoNotice && (
          <div className="zoom-toast" role="status">
            <span className="toast-icon">ℹ</span>
            {demoNotice}
          </div>
        )}
      </section>
    </main>
  );
}
