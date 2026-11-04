"use client";

import React, { createContext, useContext } from "react";
import { MessageSquare } from "lucide-react";

const ChatOpenContext = createContext<() => void>(() => {});

export const ChatOpenProvider = ChatOpenContext.Provider;

export function AskButton({ children }: { children: React.ReactNode }) {
  const open = useContext(ChatOpenContext);
  return (
    <button type="button" onClick={open} className="btn-ghost">
      <MessageSquare aria-hidden className="h-5 w-5" />
      {children}
    </button>
  );
}
