// Who is using the app (no real authentication).
//
// - user_id:      the account, returned by POST /api/users/identify for an email.
//                 Sent as X-User-Id on user-specific requests.
// - client_token: this browser, a random value created once and kept here.
//                 Sent as X-Client-Token on meeting requests; never shown in the UI.

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/+$/, "");
const USER_ID_KEY = "user_id";
const CLIENT_TOKEN_KEY = "client_token";

export type IdentifiedUser = {
  id: number;
  email: string;
  display_name: string;
  personal_meeting_id: string; // 10 digits, kept as a string so leading zeros survive
  is_new: boolean;
};

/** Finds the user with this email, creating it on first use. Throws with a message to show. */
export async function identifyUser(email: string): Promise<IdentifiedUser> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/users/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new Error("Can't reach the server. Please try again.");
  }
  if (response.status === 422) throw new Error("Enter a valid email address.");
  if (!response.ok) throw new Error("Couldn't sign in. Please try again.");
  return (await response.json()) as IdentifiedUser;
}

export function getUserId(): string | null {
  const value = window.localStorage.getItem(USER_ID_KEY);
  return value && /^[1-9]\d*$/.test(value) ? value : null;
}

/**
 * Send a signed-out visitor to the sign-in page, coming back to this page afterwards.
 * Returns true when it redirected (the caller should stop).
 */
export function requireSignIn(router: { replace: (url: string) => void }): boolean {
  if (getUserId()) return false;
  router.replace(`/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  return true;
}

/** Where to go after signing in: a path on this site, or Home. Never another site. */
export function safeNextPath(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export function saveUserId(id: number): void {
  window.localStorage.setItem(USER_ID_KEY, String(id));
}

/** Sign out: forget the account (user_id and the saved display name). The browser's client_token stays. */
export function signOut(): void {
  window.localStorage.removeItem(USER_ID_KEY);
  window.localStorage.removeItem("zoom-user-name");
}

/** This browser's token, created on first use and reused afterwards. */
export function getClientToken(): string {
  let token = window.localStorage.getItem(CLIENT_TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_TOKEN_KEY, token);
  }
  return token;
}

/** Headers for meeting API requests: X-User-Id (when identified) and X-Client-Token. */
export function identityHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "X-Client-Token": getClientToken() };
  const userId = getUserId();
  if (userId) headers["X-User-Id"] = userId;
  return headers;
}
