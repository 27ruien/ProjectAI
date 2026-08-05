import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { Button as ShadcnButton } from "@/components/ui/button";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variants = { primary: "default", secondary: "secondary", ghost: "ghost", danger: "destructive", outline: "outline" } as const;
const sizes = { sm: "sm", md: "default", lg: "lg", icon: "icon" } as const;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => (
    <ShadcnButton ref={ref} variant={variants[variant]} size={sizes[size]} disabled={disabled || loading} className={className} {...props}>
      {loading ? <LoaderCircle aria-hidden className="animate-spin" /> : null}{children}
    </ShadcnButton>
  ),
);
Button.displayName = "Button";
