import type { ButtonHTMLAttributes } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export default function Button({
  variant = "secondary",
  type = "button",
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`sp-button sp-button--${variant} ${className}`.trim()}
      {...rest}
    />
  );
}
