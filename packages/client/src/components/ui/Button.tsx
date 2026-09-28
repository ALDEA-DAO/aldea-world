import clsx from "clsx";
import type { ButtonHTMLAttributes, Ref } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary enabled:hover:bg-primary-hover bevel",
  secondary: "bg-wood text-on-wood enabled:hover:brightness-110 bevel",
  ghost: "bg-transparent text-text enabled:hover:bg-surface-raised",
  danger: "bg-error text-on-primary enabled:hover:brightness-110 bevel",
};

const sizes: Record<ButtonSize, string> = {
  // sm is 32 px tall; the ::before pseudo-element extends the touch target to 44 px
  sm: "h-8 px-3 text-sm before:absolute before:-inset-x-0 before:-inset-y-1.5 before:content-['']",
  md: "h-10 px-4 text-base",
  lg: "h-12 px-5 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

/** Primary (ember), secondary (wood), ghost and danger buttons in three sizes, with a 44 px touch target. */
export function Button({ variant = "primary", size = "md", className, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={clsx(
        "relative inline-flex min-w-11 items-center justify-center gap-2 rounded-md font-body font-medium",
        "transition-[background-color,filter,transform] duration-fast ease-out-soft select-none",
        "enabled:active:translate-y-px enabled:active:shadow-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
