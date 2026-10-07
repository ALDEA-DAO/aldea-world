import { useCallback, useState } from "react";
import { track } from "../../lib/analytics";

/** How the card left: through the device's share sheet, or as a download with the soul's link copied. */
export type ShareOutcome = "shared" | "downloaded";

/**
 * Turns the soul card on screen into a PNG and shares it: with the device's share sheet where it takes files, and
 * otherwise as a download with the link to the soul's public page copied. The image is drawn in the browser from the
 * card itself, so it carries exactly what the card shows and nothing else.
 */
export function useShareSoulCard(almaId: string) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ShareOutcome | "failed">();

  const share = useCallback(
    async (card: HTMLElement, title: string) => {
      setBusy(true);
      setOutcome(undefined);
      try {
        const { toBlob } = await import("html-to-image");
        const blob = await toBlob(card, { pixelRatio: 3, cacheBust: true });
        if (!blob) throw new Error("the card could not be drawn");
        const file = new File([blob], "alma-aldea.png", { type: "image/png" });
        const url = `${location.origin}${location.pathname}#/alma/${almaId}`;
        let how: ShareOutcome = "downloaded";
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title, url });
            how = "shared";
          } catch (err) {
            // Closing the share sheet is not a failure, and nothing was shared
            if ((err as { name?: string }).name === "AbortError") return;
            throw err;
          }
        } else {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = file.name;
          link.click();
          URL.revokeObjectURL(link.href);
          await navigator.clipboard?.writeText(url).catch(() => undefined);
        }
        setOutcome(how);
        track("soul_card_shared", { method: how });
      } catch {
        setOutcome("failed");
      } finally {
        setBusy(false);
      }
    },
    [almaId],
  );

  return { share, busy, outcome };
}
