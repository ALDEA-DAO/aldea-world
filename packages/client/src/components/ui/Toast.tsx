import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type ToastKind = "info" | "success" | "warning" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const icons = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle } as const;
const iconColor = { info: "text-info", success: "text-success", warning: "text-warning", error: "text-error" } as const;

/** Toasts at the bottom center, 4 s (errors stay until dismissed), announced politely (PRD § Design System > Toast). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId.current++;
      setToasts((all) => [...all, { id, kind, message }]);
      if (kind !== "error") setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--hud-bottom)+var(--space-4))] z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => {
          const Icon = icons[toast.kind];
          return (
            <div
              key={toast.id}
              role={toast.kind === "error" ? "alert" : "status"}
              className="pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-md bg-wood px-4 py-3 text-on-wood shadow-raised"
            >
              <Icon aria-hidden className={clsx("mt-0.5 size-5 shrink-0 brightness-150", iconColor[toast.kind])} />
              <p className="flex-1 text-sm">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label={t("common.dismiss")}
                className="-m-2 inline-flex size-9 items-center justify-center rounded-md hover:bg-black/20"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
