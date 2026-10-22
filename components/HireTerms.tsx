import type { Settings } from "@/lib/types";
import { money } from "@/lib/util";

// The dry-hire acceptance. Every channel ends at checkout, so it's accepted there unless the web form already took it.
export function HireTermsText({ s }: { s: Settings }) {
  return (
    <>
      I agree to the hire terms: I&apos;m responsible for responsible service of alcohol and any liquor licence; the truck
      needs firm, flat ground; a {money(s.bond)} bond is held on my card {s.bondHoldDaysBefore} days before.
    </>
  );
}
