import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** An identifier in monospace with a copy button; `short` shows the start and the end, the full value stays in the title. */
export function MonoId({ value, short = false }: { value: string; short?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const shown = short && value.length > 28 ? `${value.slice(0, 20)}…${value.slice(-4)}` : value;
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="font-mono text-xs break-all" title={value}>
        {shown}
      </span>
      <button
        type="button"
        aria-label={t("identity.copy")}
        className="relative inline-grid size-6 shrink-0 place-items-center rounded-md before:absolute before:-inset-2 before:content-[''] hover:bg-surface"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
        <span role="status" className="sr-only">
          {copied ? t("identity.copied") : ""}
        </span>
      </button>
    </span>
  );
}
