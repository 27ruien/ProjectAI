import * as React from "react";
import { Button as MantineButton, Loader } from "@mantine/core";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variants = {
  primary: "filled",
  secondary: "light",
  ghost: "subtle",
  danger: "light",
  outline: "outline",
} as const;

const sizes = { sm: "sm", md: "md", lg: "lg", icon: "compact-md" } as const;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => (
    <MantineButton
      ref={ref}
      variant={variants[variant]}
      color={variant === "danger" ? "red" : "projectBlue"}
      size={sizes[size]}
      disabled={disabled || loading}
      className={className}
      loaderProps={{ children: <Loader size={14} color="currentColor" /> }}
      loading={loading}
      {...props}
    >
      {children}
    </MantineButton>
  ),
);
Button.displayName = "Button";
