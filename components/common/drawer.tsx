"use client";

import type { ReactNode } from "react";
import { Box, Drawer as MantineDrawer, Group, Stack, Text } from "@mantine/core";

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <MantineDrawer opened={open} onClose={onClose} title={title} position="right" size="md" className={width}>
      <Stack gap="md" h="100%">
        {description ? <Text size="sm" c="dimmed">{description}</Text> : null}
        <Box style={{ flex: 1, overflowY: "auto" }}>{children}</Box>
        {footer ? <Group justify="flex-end" pt="sm" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>{footer}</Group> : null}
      </Stack>
    </MantineDrawer>
  );
}
