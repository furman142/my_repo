"use client";
import { useEffect } from "react";

/** Registers the service worker in production only. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* non-fatal — PWA offline support just won't be available */
    });
  }, []);
  return null;
}
