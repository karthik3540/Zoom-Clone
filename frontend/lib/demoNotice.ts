// One notice for buttons and links that are part of the Zoom look but have no feature behind them.
// Any page calls showDemoNotice(); the DemoNotice component in the root layout shows it.

export const DEMO_MESSAGE = "This is a demo feature and is not available right now.";

const EVENT = "zoom-demo-notice";

export function showDemoNotice(message: string = DEMO_MESSAGE): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

/** Subscribe to notices; returns the unsubscribe function. */
export function onDemoNotice(listener: (message: string) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
