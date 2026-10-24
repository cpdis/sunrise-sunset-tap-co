import { LINK_MINUTES } from "@/lib/server/auth";
import { ConfirmForm } from "./ConfirmForm";

export const metadata = { title: "Sign in · Sunrise Sunset Tap Co.", robots: { index: false } };

// Where a sign-in link lands (A5). Opening the page changes nothing: a mail scanner or link preview that fetches it
// signs nobody in, and the token, in the link's fragment, reaches the server only when the owner presses the button.
export default function Confirm() {
  return <ConfirmForm minutes={LINK_MINUTES} />;
}
