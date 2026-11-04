import React from "react";

const INK = "#0e2a5c";
const PEN = "#1f2bc2";

export function WhaleDoodle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 230 150"
      fill="none"
      aria-hidden
      focusable="false"
      className={className}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M14 86 C14 48 60 24 112 30 C150 34 178 56 188 82 C168 76 150 86 142 102 C120 120 60 120 14 86 Z"
        stroke={INK}
        strokeWidth="2.5"
      />
      <path d="M188 82 C200 68 208 58 214 46 M188 82 C202 84 210 92 216 102" stroke={INK} strokeWidth="2.5" />
      <path d="M24 88 C40 98 62 100 80 94" stroke={INK} strokeWidth="2" />
      <circle cx="46" cy="72" r="3.2" fill={INK} />
      <path d="M100 30 C98 16 90 10 82 8 M100 30 C104 16 112 10 120 8 M100 30 L100 12" stroke={PEN} strokeWidth="2.5" />
      <path d="M8 132 C28 124 48 138 68 130 S108 138 128 130 S168 138 190 130" stroke={PEN} strokeWidth="2" />
      <path d="M60 106 C72 112 90 112 104 106" stroke={INK} strokeWidth="1.5" strokeDasharray="3 5" />
    </svg>
  );
}

export function ArrowDoodle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 110 50"
      fill="none"
      aria-hidden
      focusable="false"
      className={className}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 36 C30 6 72 4 100 28 M100 28 L84 26 M100 28 L96 12" stroke={INK} strokeWidth="2.5" />
    </svg>
  );
}

export function CoffeeRing({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden focusable="false" className={className}>
      <circle cx="60" cy="60" r="46" stroke="#92400e" strokeWidth="5" strokeDasharray="210 80" opacity="0.16" />
      <circle cx="62" cy="58" r="40" stroke="#92400e" strokeWidth="2" opacity="0.1" />
    </svg>
  );
}
