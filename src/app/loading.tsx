import React from "react";
import { TableSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <>
      <div role="status" aria-label="Memuat halaman" className="space-y-2">
        <div className="shimmer h-10 w-1/3 rounded-control" />
        <div className="shimmer h-5 w-1/2 rounded-control" />
      </div>
      <TableSkeleton />
    </>
  );
}
