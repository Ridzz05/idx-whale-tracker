import React from "react";
import Link from "next/link";
import { Inbox, Search } from "lucide-react";
import { CopyCommand } from "./CopyCommand";

export function OriginBadge({ lf }: { lf: "L" | "F" }) {
  return lf === "L" ? (
    <span className="scribble inline-block border border-gain bg-card px-2 py-0.5 text-sm text-gain">Local</span>
  ) : (
    <span className="scribble inline-block border border-amber bg-card px-2 py-0.5 text-sm text-amber">Foreign</span>
  );
}

export function Panel({
  title,
  aside,
  children,
}: {
  title?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel min-w-0 overflow-hidden">
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
          <h2 className="text-xl">{title}</h2>
          {aside && <span className="text-base text-muted">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function ScrollTable({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function PageHeader({
  title,
  description,
  meta,
}: {
  title: string;
  description?: string;
  meta?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-[clamp(2rem,4vw,2.5rem)] leading-tight font-bold">{title}</h1>
        {description && <p className="mt-1 max-w-[72ch] text-base text-muted">{description}</p>}
      </div>
      {meta && <div className="text-base text-muted">{meta}</div>}
    </header>
  );
}

export function SearchBox({
  action,
  defaultValue,
  placeholder,
  label,
}: {
  action: string;
  defaultValue: string;
  placeholder: string;
  label: string;
}) {
  return (
    <form method="GET" action={action} role="search" className="w-full max-w-sm">
      <label htmlFor="q" className="mb-1 block text-base">
        {label}
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-3 left-3 h-5 w-5 text-muted" />
        <input
          id="q"
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="field pl-10"
        />
      </div>
    </form>
  );
}

export function EmptyState({
  title,
  hint,
  command,
}: {
  title: string;
  hint: string;
  command?: string;
}) {
  return (
    <div className="panel flex flex-col items-center gap-3 px-6 py-12 text-center">
      <Inbox aria-hidden className="h-10 w-10 text-muted" />
      <h2 className="text-2xl">{title}</h2>
      <p className="max-w-[60ch] text-base text-muted">{hint}</p>
      {command && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <code className="scribble border border-edge bg-highlight px-3 py-2 font-mono text-sm">{command}</code>
          <CopyCommand command={command} />
        </div>
      )}
    </div>
  );
}

export function Pagination({
  basePath,
  q,
  page,
  pageSize,
  total,
  noun,
}: {
  basePath: string;
  q: string;
  page: number;
  pageSize: number;
  total: number;
  noun: string;
}) {
  if (total <= pageSize) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => `${basePath}?q=${encodeURIComponent(q)}&page=${p}`;
  return (
    <nav aria-label="Paginasi" className="flex flex-wrap items-center justify-between gap-3 text-base text-muted">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} dari {total.toLocaleString("id-ID")} {noun}
      </span>
      <div className="flex items-center gap-3">
        {page > 1 && (
          <Link href={href(page - 1)} className="btn-ghost">
            Sebelumnya
          </Link>
        )}
        <span>
          Hal {page} / {totalPages}
        </span>
        {page < totalPages && (
          <Link href={href(page + 1)} className="btn-ghost">
            Berikutnya
          </Link>
        )}
      </div>
    </nav>
  );
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="panel scribble min-w-[9rem] px-4 py-3 text-right">
      <div className="text-base text-muted">{label}</div>
      <div className="font-mono text-lg font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div className="text-sm text-muted">{sub}</div>}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Memuat data" className="panel space-y-3 p-5">
      <div className="shimmer h-5 w-1/3 rounded-control" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="shimmer h-8 w-full rounded-control" />
      ))}
    </div>
  );
}
