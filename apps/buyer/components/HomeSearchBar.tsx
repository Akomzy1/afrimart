"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon, MicIcon } from "@afrimart/ui";

const words = ["egusi", "gari", "ata rodo", "berbere", "suya spice"];

/** The home hero's search field — rotating placeholder word, taps through to /search (AfriMart Buyer App.html). */
export function HomeSearchBar() {
  const router = useRouter();
  const [wordIndex, setWordIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setWordIndex((i) => (i + 1) % words.length);
        setFading(false);
      }, 320);
    }, 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ margin: "-26px 18px 0", position: "relative", zIndex: 5 }}>
      <button
        type="button"
        onClick={() => router.push("/search")}
        className="sbar"
        style={{
          width: "100%",
          height: 58,
          boxShadow: "0 16px 34px -20px rgba(31,61,43,.4)",
          textAlign: "left",
          background: "var(--card)",
        }}
      >
        <SearchIcon style={{ color: "var(--green)", width: 20, height: 20 }} />
        <span style={{ flex: 1, color: "var(--ink-3)", fontSize: "15.5px", display: "flex", gap: 5 }}>
          Search the market —{" "}
          <span style={{ color: "var(--ink-2)", fontWeight: 500, opacity: fading ? 0 : 1, transition: "opacity .32s ease" }}>
            {words[wordIndex]}
          </span>
        </span>
        <span
          onClick={(e) => e.stopPropagation()}
          role="button"
          tabIndex={-1}
          aria-label="Voice search"
          style={{
            width: 42,
            height: 42,
            borderRadius: "var(--r-sm)",
            background: "var(--green-50)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--green)",
            flex: "none",
          }}
        >
          <MicIcon style={{ width: 19, height: 19 }} />
        </span>
      </button>
    </div>
  );
}
