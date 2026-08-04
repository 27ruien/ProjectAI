"use client";

import {
  Alert as MantineAlert,
  Badge as MantineBadge,
  Button as MantineButton,
  Group,
  Modal,
  NativeSelect,
  Stack,
  Switch as MantineSwitch,
  Text,
  TextInput,
} from "@mantine/core";
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  type ComponentProps,
  type FormEvent,
  type InputHTMLAttributes,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useContext,
} from "react";

type DialogState = { open: boolean; onOpenChange: (open: boolean) => void };
const dialogContext = createContext<DialogState | null>(null);

function useDialogContext() {
  const value = useContext(dialogContext);
  if (!value) throw new Error("Dialog content must be rendered inside Dialog");
  return value;
}

export function Alert({
  variant,
  children,
  ...props
}: PropsWithChildren<{ variant?: "destructive" | string; [key: string]: unknown }>) {
  const alertProps = props as ComponentProps<typeof MantineAlert>;
  return <MantineAlert color={variant === "destructive" ? "red" : alertProps.color} {...alertProps}>{children}</MantineAlert>;
}

export function AlertTitle({ children }: { children: ReactNode }) {
  return <Text fw={650}>{children}</Text>;
}

export function AlertDescription({ children }: { children: ReactNode }) {
  return <Text size="sm" mt={4}>{children}</Text>;
}

export function Badge({
  variant,
  children,
  ...props
}: PropsWithChildren<{ variant?: "outline" | string; [key: string]: unknown }>) {
  const badgeProps = props as ComponentProps<typeof MantineBadge>;
  return <MantineBadge variant={variant === "outline" ? "outline" : "light"} {...badgeProps}>{children}</MantineBadge>;
}

export function Button({
  variant,
  size,
  children,
  ...props
}: PropsWithChildren<{ variant?: "outline" | "ghost" | string; size?: "icon" | string; [key: string]: unknown }>) {
  const resolvedVariant = variant === "outline" ? "default" : variant === "ghost" ? "subtle" : variant;
  const iconOnly = size === "icon";
  const buttonProps = props as ComponentProps<typeof MantineButton>;
  return <MantineButton variant={resolvedVariant as never} size={(iconOnly ? "compact-sm" : size) as never} px={iconOnly ? 8 : undefined} {...buttonProps}>{children}</MantineButton>;
}

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return <dialogContext.Provider value={{ open, onOpenChange }}>{children}</dialogContext.Provider>;
}

export function DialogTrigger({ children }: { children: ReactNode; asChild?: boolean }) {
  const { onOpenChange } = useDialogContext();
  if (!isValidElement(children)) return null;
  const child = children as ReactElement<{ onClick?: (event: unknown) => void }>;
  return cloneElement(child, {
    onClick: (event: unknown) => {
      child.props.onClick?.(event);
      onOpenChange(true);
    },
  });
}

export function DialogContent({ children, ...props }: PropsWithChildren<{ [key: string]: unknown }>) {
  const { open, onOpenChange } = useDialogContext();
  const modalProps = props as Omit<ComponentProps<typeof Modal>, "opened" | "onClose">;
  return <Modal {...modalProps} opened={open} onClose={() => onOpenChange(false)} centered>{children}</Modal>;
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <Stack gap={4} mb="md">{children}</Stack>;
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return <Text fw={700} size="lg">{children}</Text>;
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return <Text size="sm" c="dimmed">{children}</Text>;
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <Group justify="flex-end" mt="lg">{children}</Group>;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <TextInput className={className} {...(props as ComponentProps<typeof TextInput>)} />;
}

type SelectProps<T extends string> = {
  value?: T;
  onValueChange?: (value: T) => void;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
};

function selectOptions(children: ReactNode): Array<{ value: string; label: string }> {
  const values: Array<{ value: string; label: string }> = [];
  const visit = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === SelectItem) {
        const item = child.props as { value: string; children?: ReactNode };
        values.push({ value: item.value, label: String(item.children ?? item.value) });
        return;
      }
      visit((child.props as { children?: ReactNode }).children);
    });
  };
  visit(children);
  return values;
}

export function Select<T extends string>({ value, onValueChange, children, disabled, className }: SelectProps<T>) {
  return <NativeSelect value={value} onChange={(event) => onValueChange?.(event.currentTarget.value as T)} data={selectOptions(children)} disabled={disabled} className={className} />;
}

export function SelectTrigger({ children, className }: { children?: ReactNode; className?: string }) {
  return <>{children ?? <span className={className} />}</>;
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  return <>{placeholder}</>;
}

export function SelectContent({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function SelectItem({ children }: { value: string; children?: ReactNode; disabled?: boolean }) {
  return <>{children}</>;
}

export function Switch({
  checked,
  onCheckedChange,
  ...props
}: Omit<ComponentProps<typeof MantineSwitch>, "onChange"> & {
  onCheckedChange?: (checked: boolean) => void;
}) {
  return <MantineSwitch checked={checked} onChange={(event) => onCheckedChange?.(event.currentTarget.checked)} {...props} />;
}

export type LegacyFormEvent = FormEvent;
