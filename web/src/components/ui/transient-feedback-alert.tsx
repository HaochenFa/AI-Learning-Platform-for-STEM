"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TRANSIENT_FEEDBACK_RETRY_EVENT } from "@/lib/ui/transient-feedback";

type TransientFeedbackAlertProps = {
  message: string;
  title?: string;
  variant: "error" | "warning";
  className?: string;
  dismissOnRetry?: boolean;
};

export default function TransientFeedbackAlert({
  message,
  title,
  variant,
  className,
  dismissOnRetry = true,
}: TransientFeedbackAlertProps) {
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!dismissOnRetry) {
      return;
    }

    const handleRetryIntent = () => {
      setDismissedMessage(message);
    };

    const handleSubmitCapture = (event: Event) => {
      if (event.target instanceof HTMLFormElement) {
        setDismissedMessage(message);
      }
    };

    window.addEventListener(TRANSIENT_FEEDBACK_RETRY_EVENT, handleRetryIntent);
    window.addEventListener("submit", handleSubmitCapture, true);

    return () => {
      window.removeEventListener(TRANSIENT_FEEDBACK_RETRY_EVENT, handleRetryIntent);
      window.removeEventListener("submit", handleSubmitCapture, true);
    };
  }, [dismissOnRetry, message]);

  if (!message || dismissedMessage === message) {
    return null;
  }

  return (
    <Alert variant={variant} className={className}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
