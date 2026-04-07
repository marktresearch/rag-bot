"use client";

import type { ReactNode } from "react";

type ChatLayoutProps = {
  title: string;
  statusLine: ReactNode;
  sidebar: ReactNode;
  mobileSidebar: ReactNode;
  rightPanel: ReactNode;
  mobileRightPanel: ReactNode;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  onSidebarOpen: () => void;
  onSidebarClose: () => void;
  onRightPanelOpen: () => void;
  onRightPanelClose: () => void;
  children: ReactNode;
  composer: ReactNode;
};

export default function ChatLayout({
  title,
  statusLine,
  sidebar,
  mobileSidebar,
  rightPanel,
  mobileRightPanel,
  sidebarOpen,
  rightPanelOpen,
  onSidebarOpen,
  onSidebarClose,
  onRightPanelOpen,
  onRightPanelClose,
  children,
  composer,
}: ChatLayoutProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden text-slate-100">
      <aside className="hidden w-[280px] min-w-[280px] flex-shrink-0 flex-col h-full overflow-hidden border-r border-white/10 bg-white/[0.03] lg:flex">
        {sidebar}
      </aside>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <aside className="relative z-10 flex w-[86vw] max-w-[320px] border-r border-white/10 bg-[#0F141B]">
            {mobileSidebar}
          </aside>
          <button
            aria-label="Close chat sidebar"
            className="flex-1 bg-black/70 backdrop-blur-sm"
            onClick={onSidebarClose}
            type="button"
          />
        </div>
      ) : null}

      <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden bg-[#0F141B]/90">
        <header className="flex-shrink-0 border-b border-white/10 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-[18px] font-semibold text-white">{title}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">{statusLine}</div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 text-[14px] text-slate-200 transition hover:bg-white/[0.06] lg:hidden"
                onClick={onSidebarOpen}
                type="button"
              >
                Chats
              </button>
              <button
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 text-[14px] text-slate-200 transition hover:bg-white/[0.06]"
                onClick={rightPanelOpen ? onRightPanelClose : onRightPanelOpen}
                type="button"
              >
                {rightPanelOpen ? "Hide panel" : "Panel"}
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>

        <div className="flex-shrink-0 border-t border-white/10 p-4">
          {composer}
        </div>
      </main>

      {rightPanelOpen ? (
        <aside className="hidden w-[320px] min-w-[320px] flex-shrink-0 h-full overflow-hidden border-l border-white/10 bg-white/[0.02] lg:flex">
          {rightPanel}
        </aside>
      ) : null}

      {rightPanelOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
          <button
            aria-label="Close details panel"
            className="flex-1 bg-black/70 backdrop-blur-sm"
            onClick={onRightPanelClose}
            type="button"
          />
          <aside className="relative z-10 flex w-[88vw] max-w-[360px] border-l border-white/10 bg-[#0F141B]">
            {mobileRightPanel}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
