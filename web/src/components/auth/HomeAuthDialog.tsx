"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  AUTH_MODAL_QUERY_KEYS,
  type AuthMode,
} from "@/lib/auth/ui";

type HomeAuthDialogProps = {
  mode: AuthMode | null;
  children: ReactNode;
};

export default function HomeAuthDialog({ mode, children }: HomeAuthDialogProps) {
  const open = Boolean(mode);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
        className="dialog-content-static bottom-3 top-auto w-[calc(100vw-1rem)] max-w-none -translate-y-0 border-0 bg-transparent p-0 shadow-none sm:bottom-auto sm:top-1/2 sm:w-full sm:max-w-[32rem] sm:-translate-y-1/2"
      >
        <AnimatePresence mode="wait" initial={false}>
          {mode ? (
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 16, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.99 }}
              transition={{ duration: 0.28 }}
            >
              {children}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
