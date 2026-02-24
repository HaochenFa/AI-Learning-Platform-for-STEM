"use client";

import type { ReactNode } from "react";

type ClassWorkspaceShellProps = {
  title: string;
  subtitle: string;
  sidebar: ReactNode;
  main: ReactNode;
  onExit: () => void;
};

export default function ClassWorkspaceShell({
  title,
  subtitle,
  sidebar,
  main,
  onExit,
}: ClassWorkspaceShellProps) {
  return (
    <section className="space-y-4">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Focused Workspace</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="ui-motion-color rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:border-cyan-300 hover:text-cyan-700"
          >
            Back to overview
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="ui-motion-lift min-h-[32rem] rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          {main}
        </div>
        <aside className="ui-motion-lift rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          {sidebar}
        </aside>
      </div>
    </section>
  );
}
