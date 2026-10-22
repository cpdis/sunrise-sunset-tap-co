"use client";

import { useEffect } from "react";

// Review switch for the hand-made feel options. ?form=a|b|c sets html[data-form] and sticks for the
// tab so the choice survives clicking through to /book. Remove once one option is chosen.
export function FormSwitch() {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("form");
    const form = q ?? sessionStorage.getItem("form");
    if (form && /^[abc]$/.test(form)) {
      document.documentElement.dataset.form = form;
      sessionStorage.setItem("form", form);
    } else if (q === "") {
      delete document.documentElement.dataset.form;
      sessionStorage.removeItem("form");
    }
  }, []);
  return null;
}
