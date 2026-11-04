"use client";

import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard needs a secure context; the command stays visible to select by hand.
    }
  }

  return (
    <button type="button" onClick={copy} className="btn-ghost">
      {copied ? <Check aria-hidden className="h-5 w-5" /> : <Copy aria-hidden className="h-5 w-5" />}
      <span aria-live="polite">{copied ? "Tersalin" : "Salin perintah"}</span>
    </button>
  );
}
