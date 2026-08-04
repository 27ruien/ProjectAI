"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Avatar,
  Box,
  Divider,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import {
  Bot,
  Building2,
  ChevronRight,
  FileText,
  FolderOpen,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { initials } from "@/components/project/mock-view";
import { navigateToLogin, signOut } from "@/components/auth/auth-client";
import { productRoleLabel, type ViewerContext } from "@/lib/auth/ui-types";

const navigation = [
  { label: "AI 助手", href: "/assistant", icon: Bot },
  { label: "资料空间", href: "/data-spaces", icon: FolderOpen },
] as const;

interface SidebarProps {
  viewer: ViewerContext;
  currentPath: string;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ viewer, currentPath, onMobileClose }: SidebarProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const active = (href: string) => currentPath === href || currentPath.startsWith(`${href}/`);
  const admin = viewer.user.systemRole === "system_admin" || viewer.user.productRole === "admin";
  const canManageAiModels = viewer.user.systemRole === "system_admin" || Boolean(viewer.aiConfigurationOrganizationId);
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut();
      navigateToLogin();
    } finally {
      setLoggingOut(false);
    }
  };
  return (
    <Stack h="100%" gap={0}>
      <Group h={56} px="md" wrap="nowrap">
        <Avatar color="projectBlue" variant="light" radius="md" size={34}><Building2 size={18} /></Avatar>
        <Text component={Link} href="/assistant" fw={700} c="dark" onClick={onMobileClose}>ProjectAI</Text>
      </Group>
      <Divider />
      <ScrollArea style={{ flex: 1 }} p="sm">
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" py={8}>工作区</Text>
        <Stack gap={4}>
          {navigation.map((item) => (
            <NavLink
              key={item.href}
              component={Link}
              href={item.href}
              label={item.label}
              leftSection={<item.icon size={17} />}
              active={active(item.href)}
              color="projectBlue"
              variant="light"
              onClick={onMobileClose}
              rightSection={item.href === "/data-spaces" ? <ChevronRight size={14} /> : undefined}
            />
          ))}
          {active("/data-spaces") ? (
            <Box ml="lg" pl="xs" bd="0 0 0 1px solid var(--mantine-color-gray-3)">
              <NavLink component={Link} href="/data-spaces/projects" label="项目资料" leftSection={<FolderOpen size={15} />} active={active("/data-spaces/projects")} color="projectBlue" variant="light" onClick={onMobileClose} />
              <NavLink component={Link} href="/data-spaces/company" label="公司资料" leftSection={<FileText size={15} />} active={active("/data-spaces/company")} color="projectBlue" variant="light" onClick={onMobileClose} />
            </Box>
          ) : null}
        </Stack>
      </ScrollArea>
      <Divider />
      <Box p="sm">
        <Menu width={240} position="top-start" shadow="md">
          <Menu.Target>
            <UnstyledButton w="100%" p="xs" style={{ borderRadius: "var(--mantine-radius-md)" }} aria-label="账户菜单">
              <Group wrap="nowrap">
                <Avatar color="projectBlue" variant="light" size={34}>{initials(viewer.user.displayName)}</Avatar>
                <Box miw={0} style={{ flex: 1 }}><Text size="sm" fw={600} truncate>{viewer.user.displayName}</Text><Text size="xs" c="dimmed" truncate>{productRoleLabel(viewer.user.productRole)}</Text></Box>
                <ChevronRight size={15} />
              </Group>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label><Group gap={6}><ShieldCheck size={14} />{productRoleLabel(viewer.user.productRole)}</Group></Menu.Label>
            <Menu.Divider />
            {admin ? <>
              <Menu.Item component={Link} href="/organization" leftSection={<Users size={15} />} onClick={onMobileClose}>组织与账号</Menu.Item>
              <Menu.Item component={Link} href="/settings" leftSection={<Settings size={15} />} onClick={onMobileClose}>管理设置</Menu.Item>
            </> : null}
            {canManageAiModels ? <Menu.Item component={Link} href="/admin/models" leftSection={<Bot size={15} />} onClick={onMobileClose}>Provider 与模型</Menu.Item> : null}
            <Menu.Item component={Link} href="/help/models-and-api" leftSection={<FileText size={15} />} onClick={onMobileClose}>模型与 API 帮助</Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<LogOut size={15} />} disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? "正在退出" : "退出登录"}</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Box>
    </Stack>
  );
}
