"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AUTH_MODAL_QUERY_KEYS,
  type AuthMode,
} from "@/lib/auth/ui";

type HomeAuthDialogProps = {
  mode: AuthMode | null;
  children: ReactNode;
};

const AUTH_MODAL_LABELS: Record<AuthMode, string> = {
  "sign-in": "Sign in dialog",
  "sign-up": "Create account dialog",
  "forgot-password": "Password reset dialog",
};

const AUTH_MODAL_DESCRIPTIONS: Record<AuthMode, string> = {
  "sign-in": "Sign in to access your workspace.",
  "sign-up": "Create an account and choose the role that matches how you will use the platform.",
  "forgot-password": "Request a password reset link for your account.",
};

export default function HomeAuthDialog({ mode, children }: HomeAuthDialogProps) {
  const open = Boolean(mode);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (open) {
      document.body.dataset.authModalOpen = "true";
      return () => {
        delete document.body.dataset.authModalOpen;
      };
    }

    delete document.body.dataset.authModalOpen;
    return undefined;
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !mode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScale(1);
      return;
    }

    const node = frameRef.current;
    if (!node) {
      return;
    }

    let animationFrame = 0;

    const updateScale = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const availableWidth = viewportWidth - (viewportWidth < 640 ? 16 : 72);
      const availableHeight = viewportHeight - (viewportWidth < 640 ? 16 : 72);
      const naturalWidth = node.offsetWidth;
      const naturalHeight = node.offsetHeight;

      if (!naturalWidth || !naturalHeight) {
        setScale(1);
        return;
      }

      const nextScale = Math.min(
        1,
        availableWidth / naturalWidth,
        availableHeight / naturalHeight,
      );

      setScale(nextScale < 0.999 ? Math.max(nextScale, 0.82) : 1);
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateScale);
    };

    scheduleUpdate();

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(node);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [open, mode]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    AUTH_MODAL_QUERY_KEYS.forEach((key) => nextParams.delete(key));
    const nextHref = nextParams.size ? `${pathname}?${nextParams.toString()}` : pathname;
    router.replace(nextHref, { scroll: false });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label={mode ? AUTH_MODAL_LABELS[mode] : "Authentication dialog"}
        className={[
          "dialog-content-static bottom-2 top-auto w-[calc(100vw-1rem)] max-w-none -translate-y-0 border-0 bg-transparent p-0 shadow-none sm:bottom-auto sm:top-1/2 sm:w-full sm:-translate-y-1/2",
          mode === "sign-up" ? "sm:max-w-[31rem]" : "sm:max-w-[28rem]",
        ].join(" ")}
      >
        {mode ? (
          <div className="sr-only">
            <DialogTitle>{AUTH_MODAL_LABELS[mode]}</DialogTitle>
            <DialogDescription>{AUTH_MODAL_DESCRIPTIONS[mode]}</DialogDescription>
          </div>
        ) : null}

        <AnimatePresence mode="wait" initial={false}>
          {mode ? (
            <motion.div
              ref={frameRef}
              key={mode}
              initial={{ opacity: 0, y: 16, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale }}
              exit={{ opacity: 0, y: 8, scale: Math.max(scale - 0.01, 0.95) }}
              transition={{ duration: 0.28 }}
              style={{ transformOrigin: "center center" }}
            >
              {children}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
