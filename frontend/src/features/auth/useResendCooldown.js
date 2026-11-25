import { useEffect, useState } from "react";

/** Simple countdown used to throttle "resend email" buttons on the client. */
export function useCooldown(seconds = 60) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return undefined;
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return { remaining, start: () => setRemaining(seconds) };
}
