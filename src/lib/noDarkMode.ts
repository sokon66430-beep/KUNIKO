"use client";

import { useEffect } from "react";

/**
 * Hold this screen in light mode, whatever the device's theme is set to.
 *
 * For the CUSTOMER-FACING displays — the queue TV board and the customer
 * screen. Two reasons they must not follow the app's dark mode:
 *
 *  - They are designed to an exact palette in hard-coded hex. The dark-mode
 *    remap in globals.css only repaints backgrounds written with Tailwind's
 *    neutral class names, so it turns a `bg-white` card dark and leaves the
 *    #111827 text on it black. Half-converted is worse than either.
 *
 *  - The theme is a per-device preference for the person working the till at
 *    night. It has no business reaching a television a customer is reading.
 *
 * Adds `no-dark` to <html>, which every dark rule is scoped against, and takes
 * it off again on unmount so the rest of the app keeps its theme.
 */
export function useNoDarkMode() {
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("no-dark");
    return () => el.classList.remove("no-dark");
  }, []);
}
