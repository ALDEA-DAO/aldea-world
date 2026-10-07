import { useCallback, useRef, useState } from "react";
import { track } from "../../lib/analytics";

/** How the card left: through the device's share sheet, or as a download with the soul's link copied. */
export type ShareOutcome = "shared" | "downloaded";

/**
 * Turns the soul card on screen into a PNG and shares it: with the device's share sheet where it takes files, and
 * otherwise as a download with the link to the soul's public page copied. The image is drawn in the browser from the
 * card itself, so it carries exactly what the card shows and nothing else.
 *
 * `prepare` does the slow part ahead of the click, while the card is being looked at: loading the drawing code and
 * gathering the card's fonts. Sharing then only has to draw.
 */
export function useShareSoulCard(almaId: string) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ShareOutcome | "failed">();
  const fonts = useRef<Promise<string | undefined>>(undefined);

  const prepare = useCallback((card: HTMLElement) => {
    fonts.current ??= import("html-to-image").then(({ getFontEmbedCSS }) => getFontEmbedCSS(card)).catch(() => undefined);
  }, []);

  const share = useCallback(
    async (card: HTMLElement, title: string) => {
      setBusy(true);
      setOutcome(undefined);
      try {
        const [{ toBlob }, fontEmbedCSS] = await Promise.all([import("html-to-image"), fonts.current]);
        const blob = await toBlob(card, { pixelRatio: 3, fontEmbedCSS });
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

  return { prepare, share, busy, outcome };
}
