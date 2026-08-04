"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Center,
  Divider,
  Drawer,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  Grid2X2,
  Info,
  Link2,
  List,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { ProjectContextHeader } from "./ProjectContextHeader";
import { resolvePendingDocumentUpload } from "./DocumentUploadDrawer";
import { useToast } from "@/components/common/toast";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import {
  createProjectFolder,
  deleteProjectDocument,
  deleteProjectFolder,
  documentErrorMessage,
  duplicateProjectDocument,
  listProjectDocuments,
  listProjectFolders,
  moveProjectDocument,
  renameProjectDocument,
  updateProjectFolder,
  uploadProjectDocument,
} from "@/lib/documents/client";
import { documentViewerPath } from "@/lib/documents/viewer-route";
import type {
  DocumentListPermissionsDto,
  DocumentUploadPolicyDto,
  ProjectDocumentDto,
} from "@/types/documents";
import type { ProjectDocumentFolderDto } from "@/types/file-workspace";

type SortKey = "name" | "created" | "updated" | "owner" | "type";
type SortOrder = "asc" | "desc";
type ViewMode = "list" | "grid";
type WorkspaceEntry =
  | { kind: "folder"; folder: ProjectDocumentFolderDto }
  | { kind: "file"; document: ProjectDocumentDto };

type UploadJob = {
  id: string;
  name: string;
  progress: number;
  state: "queued" | "uploading" | "done" | "failed";
  error?: string;
};

const defaultPolicy: DocumentUploadPolicyDto = {
  maxBytes: 50 * 1024 * 1024,
  acceptsAllFiles: true,
  aiReadableExtensions: ["pdf", "docx", "xlsx", "pptx", "txt", "md"],
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function displayNameFromFile(file: globalThis.File) {
  return (file.name.replace(/\.[^.]+$/, "").trim() || "未命名资料").slice(0, 240);
}

function fileType(document: ProjectDocumentDto) {
  return document.currentVersion?.extension?.toLocaleUpperCase("en-US") || "FILE";
}

function FileTypeIcon({ document, size }: { document: ProjectDocumentDto; size: number }) {
  const extension = document.currentVersion?.extension.toLocaleLowerCase("en-US");
  if (extension === "xlsx" || extension === "xls") return <FileSpreadsheet size={size} />;
  if (["doc", "docx", "md", "txt", "pdf"].includes(extension ?? "")) return <FileText size={size} />;
  if (["zip", "rar", "7z"].includes(extension ?? "")) return <FileArchive size={size} />;
  return <File size={size} />;
}

function EntryIcon({ entry, size }: { entry: WorkspaceEntry; size: number }) {
  return entry.kind === "folder"
    ? <Folder size={size} />
    : <FileTypeIcon document={entry.document} size={size} />;
}

function entryName(entry: WorkspaceEntry) {
  return entry.kind === "folder" ? entry.folder.name : entry.document.displayName;
}

function entryCreatedAt(entry: WorkspaceEntry) {
  return entry.kind === "folder" ? entry.folder.createdAt : entry.document.createdAt;
}

function entryUpdatedAt(entry: WorkspaceEntry) {
  return entry.kind === "folder" ? entry.folder.updatedAt : entry.document.updatedAt;
}

function entryOwner(entry: WorkspaceEntry) {
  if (entry.kind === "folder") return entry.folder.createdBy.displayName;
  return entry.document.currentVersion?.uploadedBy.displayName ?? entry.document.createdBy.displayName;
}

function entryType(entry: WorkspaceEntry) {
  return entry.kind === "folder" ? "文件夹" : fileType(entry.document);
}

function fileProcessingStatus(document: ProjectDocumentDto) {
  const version = document.currentVersion;
  if (!version) return { label: "等待上传", color: "gray" as const };
  if (version.storageStatus !== "stored") return { label: "正在安全存储", color: "orange" as const };
  if (version.ingestion.status === "failed" || version.embedding.status === "failed") {
    return { label: "处理失败", color: "red" as const };
  }
  if (version.ingestion.status === "needs_ocr") return { label: "等待 OCR", color: "orange" as const };
  if (version.ingestion.status !== "succeeded" || version.embedding.status !== "succeeded") {
    return { label: "正在处理", color: "projectBlue" as const };
  }
  return { label: "可用于 AI", color: "green" as const };
}

function compareEntries(left: WorkspaceEntry, right: WorkspaceEntry, key: SortKey) {
  if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
  const values: Record<SortKey, [string, string]> = {
    name: [entryName(left), entryName(right)],
    created: [entryCreatedAt(left), entryCreatedAt(right)],
    updated: [entryUpdatedAt(left), entryUpdatedAt(right)],
    owner: [entryOwner(left), entryOwner(right)],
    type: [entryType(left), entryType(right)],
  };
  return values[key][0].localeCompare(values[key][1], "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function entryKey(entry: WorkspaceEntry) {
  return entry.kind === "folder" ? `folder:${entry.folder.id}` : `file:${entry.document.id}`;
}

function internalFolderUrl(pathname: string, folderId: string | null) {
  const query = new URLSearchParams();
  if (folderId) query.set("folder", folderId);
  return query.size ? `${pathname}?${query.toString()}` : pathname;
}

function currentVersionUrl(document: ProjectDocumentDto) {
  if (!document.currentVersion) return null;
  return documentViewerPath({
    projectId: document.projectId,
    documentId: document.id,
    versionId: document.currentVersion.id,
  });
}

function isDescendant(
  folders: ProjectDocumentFolderDto[],
  candidateId: string,
  ancestorId: string,
) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let cursor = byId.get(candidateId);
  for (let depth = 0; cursor && depth < 64; depth += 1) {
    if (cursor.parentFolderId === ancestorId) return true;
    cursor = cursor.parentFolderId ? byId.get(cursor.parentFolderId) : undefined;
  }
  return false;
}

export function ProjectFileWorkspace({ project }: { project: AuthorizedProjectSummary }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const isNarrow = useMediaQuery("(max-width: 74rem)");
  const [detailOpened, detailHandlers] = useDisclosure(false);
  const [createOpened, createHandlers] = useDisclosure(false);
  const [shareOpened, shareHandlers] = useDisclosure(false);
  const [deleteOpened, deleteHandlers] = useDisclosure(false);
  const [documents, setDocuments] = useState<ProjectDocumentDto[]>([]);
  const [folders, setFolders] = useState<ProjectDocumentFolderDto[]>([]);
  const [permissions, setPermissions] = useState<DocumentListPermissionsDto | null>(null);
  const [policy, setPolicy] = useState<DocumentUploadPolicyDto>(defaultPolicy);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [selected, setSelected] = useState<WorkspaceEntry | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [editName, setEditName] = useState("");
  const [moveFolderId, setMoveFolderId] = useState<string | null>(null);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const loadSequence = useRef(0);

  const folderId = searchParams.get("folder");
  const sortKey = (searchParams.get("sort") as SortKey | null) ?? "name";
  const sortOrder = (searchParams.get("order") as SortOrder | null) ?? "asc";
  const viewMode = (searchParams.get("view") as ViewMode | null) ?? "list";
  const currentFolder = folders.find((folder) => folder.id === folderId) ?? null;

  const replaceQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace(next.size ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const load = useCallback(async (background = false) => {
    const sequence = ++loadSequence.current;
    if (!background) setLoading(true);
    setError(null);
    try {
      const [documentResult, folderResult] = await Promise.all([
        listProjectDocuments(project.id, "active"),
        listProjectFolders(project.id),
      ]);
      if (sequence !== loadSequence.current) return;
      setDocuments(documentResult.documents);
      setFolders(folderResult.folders);
      setPermissions(documentResult.permissions);
      setPolicy(documentResult.uploadPolicy);
    } catch (caught) {
      if (sequence !== loadSequence.current) return;
      setError(documentErrorMessage(caught));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (folderId && !loading && folders.length > 0 && !currentFolder) {
      replaceQuery({ folder: null });
    }
  }, [currentFolder, folderId, folders.length, loading, replaceQuery]);

  const knowledgeSpaceId =
    currentFolder?.knowledgeSpaceId ??
    permissions?.uploadDestinations.find((space) => space.projectId === project.id)?.id ??
    permissions?.uploadDestinations[0]?.id ??
    "";
  const canUpload = Boolean(project.permissions.canUploadDocuments && permissions?.canUpload);

  const breadcrumbFolders = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const result: ProjectDocumentFolderDto[] = [];
    let cursor = currentFolder;
    for (let depth = 0; cursor && depth < 64; depth += 1) {
      result.unshift(cursor);
      cursor = cursor.parentFolderId ? byId.get(cursor.parentFolderId) ?? null : null;
    }
    return result;
  }, [currentFolder, folders]);

  const visibleEntries = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    // 搜索是项目范围的；不输入关键字时才只显示当前文件夹。这能让用户
    // 从深层目录快速找回资料，同时不会改变日常文件夹浏览的层级语义。
    const entries: WorkspaceEntry[] = [
      ...folders
        .filter((folder) => keyword || folder.parentFolderId === (folderId ?? null))
        .map((folder): WorkspaceEntry => ({ kind: "folder", folder })),
      ...documents
        .filter((document) => keyword || document.folderId === (folderId ?? null))
        .map((document): WorkspaceEntry => ({ kind: "file", document })),
    ];
    const filtered = keyword
      ? entries.filter((entry) => entryName(entry).toLocaleLowerCase("zh-CN").includes(keyword))
      : entries;
    return filtered.sort((left, right) => {
      const result = compareEntries(left, right, sortKey);
      return sortOrder === "asc" ? result : -result;
    });
  }, [documents, folderId, folders, search, sortKey, sortOrder]);

  const openFolder = (nextFolderId: string | null) => {
    setSelected(null);
    replaceQuery({ folder: nextFolderId, q: null });
    setSearch("");
  };

  const selectEntry = (entry: WorkspaceEntry) => {
    setSelected(entry);
    setEditName(entryName(entry));
    setMoveFolderId(entry.kind === "folder" ? entry.folder.parentFolderId : entry.document.folderId);
    if (isNarrow) detailHandlers.open();
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !knowledgeSpaceId) return;
    setBusy("create-folder");
    setError(null);
    try {
      await createProjectFolder(project.id, {
        name,
        knowledgeSpaceId,
        parentFolderId: folderId,
      });
      setNewFolderName("");
      createHandlers.close();
      toast(`文件夹“${name}”已创建`);
      await load(true);
    } catch (caught) {
      setError(documentErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const uploadFiles = async (files: globalThis.File[]) => {
    if (!canUpload || !knowledgeSpaceId || files.length === 0) return;
    const accepted = files.filter((file) => file.size > 0 && file.size <= policy.maxBytes);
    const jobs = accepted.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      progress: 0,
      state: "queued" as const,
    }));
    setUploadJobs((current) => [...jobs, ...current].slice(0, 12));
    for (let index = 0; index < accepted.length; index += 1) {
      const file = accepted[index];
      const job = jobs[index];
      setUploadJobs((current) => current.map((item) => item.id === job.id ? { ...item, state: "uploading" } : item));
      try {
        let response = await uploadProjectDocument({
          projectId: project.id,
          file,
          displayName: displayNameFromFile(file),
          knowledgeSpaceId,
          folderId: folderId ?? undefined,
          idempotencyKey: crypto.randomUUID(),
          onProgress: ({ percent }) => {
            setUploadJobs((current) => current.map((item) => item.id === job.id ? { ...item, progress: percent } : item));
          },
        });
        response = await resolvePendingDocumentUpload(project.id, response);
        if (response.uploadStatus !== "stored") throw new Error("文件未能完成安全存储");
        setUploadJobs((current) => current.map((item) => item.id === job.id ? { ...item, progress: 100, state: "done" } : item));
      } catch (caught) {
        setUploadJobs((current) => current.map((item) => item.id === job.id ? { ...item, state: "failed", error: documentErrorMessage(caught) } : item));
      }
    }
    await load(true);
  };

  const stableLink = (entry: WorkspaceEntry) => {
    if (entry.kind === "folder") {
      return new URL(internalFolderUrl(pathname, entry.folder.id), window.location.origin).toString();
    }
    const href = currentVersionUrl(entry.document);
    return href ? new URL(href, window.location.origin).toString() : window.location.href;
  };

  const copyLink = async (entry: WorkspaceEntry) => {
    await navigator.clipboard.writeText(stableLink(entry));
    toast("内部访问链接已复制");
  };

  const share = (entry: WorkspaceEntry) => {
    selectEntry(entry);
    shareHandlers.open();
  };

  const duplicateFolderTree = async (source: ProjectDocumentFolderDto) => {
    const descendants = folders.filter((folder) => folder.id === source.id || isDescendant(folders, folder.id, source.id));
    const relatedDocuments = documents.filter((document) =>
      document.folderId ? descendants.some((folder) => folder.id === document.folderId) : false,
    );
    if (descendants.length + relatedDocuments.length > 200) {
      throw new Error("该文件夹内容超过 200 项，请拆分后再创建副本。");
    }
    const cloneMap = new Map<string, string>();
    const siblingNames = new Set(
      folders
        .filter((folder) => folder.parentFolderId === source.parentFolderId)
        .map((folder) => folder.name.toLocaleLowerCase("zh-CN")),
    );
    let copyName = `${source.name} 副本`;
    for (let suffix = 2; siblingNames.has(copyName.toLocaleLowerCase("zh-CN")); suffix += 1) {
      copyName = `${source.name} 副本 ${suffix}`;
    }
    const descendantIds = new Set(descendants.map((folder) => folder.id));
    const depth = (folder: ProjectDocumentFolderDto) => {
      let value = 0;
      let cursor = folder.parentFolderId;
      const visited = new Set<string>();
      while (cursor && descendantIds.has(cursor) && !visited.has(cursor)) {
        visited.add(cursor);
        value += 1;
        cursor = folders.find((candidate) => candidate.id === cursor)?.parentFolderId ?? null;
      }
      return value;
    };
    const ordered = [...descendants].sort((left, right) =>
      depth(left) - depth(right)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id),
    );
    for (const folder of ordered) {
      const parentFolderId = folder.id === source.id
        ? folder.parentFolderId
        : folder.parentFolderId
          ? cloneMap.get(folder.parentFolderId) ?? (() => { throw new Error("文件夹层级不完整，无法安全创建副本"); })()
          : null;
      const result = await createProjectFolder(project.id, {
        name: folder.id === source.id ? copyName : folder.name,
        knowledgeSpaceId: folder.knowledgeSpaceId,
        parentFolderId,
      });
      cloneMap.set(folder.id, result.folder.id);
    }
    for (const document of relatedDocuments) {
      const targetFolderId = document.folderId ? cloneMap.get(document.folderId) : null;
      await duplicateProjectDocument(project.id, document.id, targetFolderId);
    }
  };

  const duplicate = async (entry: WorkspaceEntry) => {
    const key = `duplicate:${entryKey(entry)}`;
    setBusy(key);
    setError(null);
    try {
      if (entry.kind === "file") {
        await duplicateProjectDocument(project.id, entry.document.id, entry.document.folderId);
      } else {
        await duplicateFolderTree(entry.folder);
      }
      toast(`“${entryName(entry)}”的副本已创建`);
      await load(true);
    } catch (caught) {
      setError(documentErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const requestDelete = (entry: WorkspaceEntry) => {
    selectEntry(entry);
    deleteHandlers.open();
  };

  const confirmDelete = async () => {
    if (!selected) return;
    setBusy(`delete:${entryKey(selected)}`);
    setError(null);
    try {
      if (selected.kind === "file") {
        await deleteProjectDocument(project.id, selected.document.id);
      } else {
        await deleteProjectFolder(project.id, selected.folder.id);
      }
      toast(`“${entryName(selected)}”已删除`);
      setSelected(null);
      deleteHandlers.close();
      await load(true);
    } catch (caught) {
      setError(documentErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const saveMetadata = async () => {
    if (!selected) return;
    setBusy(`metadata:${entryKey(selected)}`);
    setError(null);
    try {
      if (selected.kind === "file") {
        if (editName.trim() !== selected.document.displayName) {
          await renameProjectDocument(project.id, selected.document.id, editName.trim());
        }
        if (moveFolderId !== selected.document.folderId) {
          await moveProjectDocument(project.id, selected.document.id, moveFolderId);
        }
      } else {
        await updateProjectFolder(project.id, selected.folder.id, {
          name: editName.trim(),
          parentFolderId: moveFolderId,
        });
      }
      toast("名称和位置已更新");
      await load(true);
    } catch (caught) {
      setError(documentErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const moveOptions = useMemo(() => folders
    .filter((folder) => {
      if (selected?.kind !== "folder") return true;
      return folder.id !== selected.folder.id && !isDescendant(folders, folder.id, selected.folder.id);
    })
    .map((folder) => ({ value: folder.id, label: folder.name })), [folders, selected]);

  const details = selected ? (
    <EntryDetails
      entry={selected}
      editName={editName}
      moveFolderId={moveFolderId}
      moveOptions={moveOptions}
      busy={Boolean(busy)}
      editable={selected.kind === "folder" ? selected.folder.permissions.canEdit : selected.document.permissions.canUploadVersion}
      onEditName={setEditName}
      onMove={setMoveFolderId}
      onSave={() => void saveMetadata()}
      onShare={() => share(selected)}
      onCopy={() => void copyLink(selected)}
    />
  ) : (
    <Center mih={320} p="xl">
      <Stack align="center" gap="xs">
        <Info size={24} color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed" ta="center">选择一个文件或文件夹后，可在这里查看详情与管理位置。</Text>
      </Stack>
    </Center>
  );

  return (
    <Box bg="var(--mantine-color-gray-0)" mih="100%">
      <ProjectContextHeader project={project} activeTab="files" />
      <Box p={{ base: "md", lg: "xl" }} data-testid="project-documents-panel">
        <Group justify="space-between" align="flex-start" mb="lg">
          <Box>
            <Title order={2} size="h3">项目资料</Title>
            <Text c="dimmed" size="sm" mt={4}>像云盘一样管理文件夹与资料；AI 解析状态和原文件预览互不混用。</Text>
          </Box>
          <Group gap="xs">
            {canUpload ? (
              <Button leftSection={<FolderPlus size={16} />} variant="light" onClick={createHandlers.open}>新建文件夹</Button>
            ) : null}
            {canUpload ? (
              <Button data-testid="project-document-upload-button" leftSection={<UploadCloud size={16} />} onClick={() => document.getElementById("project-workspace-upload")?.click()}>上传</Button>
            ) : null}
          </Group>
        </Group>

        {error ? <Alert color="red" title="操作未完成" withCloseButton onClose={() => setError(null)} mb="md">{error}</Alert> : null}

        <Dropzone
          onDrop={(files) => void uploadFiles(files)}
          disabled={!canUpload}
          maxSize={policy.maxBytes}
          multiple
          bd="1px dashed var(--mantine-color-projectBlue-2)"
          bg="var(--mantine-color-projectBlue-0)"
          mb="md"
          p="md"
          data-testid="project-file-dropzone"
        >
          <input
            id="project-workspace-upload"
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void uploadFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <Group justify="center" gap="sm" wrap="nowrap">
            <UploadCloud size={20} color="var(--mantine-color-projectBlue-6)" />
            <Box>
              <Text size="sm" fw={600}>拖入多个文件，或点击右上角上传</Text>
              <Text size="xs" c="dimmed">单文件不超过 {Math.round(policy.maxBytes / 1024 / 1024)} MB，失败项可单独重新选择上传。</Text>
            </Box>
          </Group>
        </Dropzone>

        {uploadJobs.length ? (
          <Paper withBorder p="sm" mb="md" radius="md">
            <Stack gap={8}>
              {uploadJobs.slice(0, 5).map((job) => (
                <Box key={job.id}>
                  <Group justify="space-between" gap="xs">
                    <Text size="xs" truncate>{job.name}</Text>
                    <Text size="xs" c={job.state === "failed" ? "red" : "dimmed"}>{job.state === "failed" ? job.error : job.state === "done" ? "完成" : `${job.progress}%`}</Text>
                  </Group>
                  <Progress value={job.progress} color={job.state === "failed" ? "red" : "projectBlue"} size="xs" mt={4} />
                </Box>
              ))}
            </Stack>
          </Paper>
        ) : null}

        <Paper withBorder radius="lg" style={{ overflow: "hidden" }}>
          <Group justify="space-between" p="md" bd="0 0 1px 0 solid var(--mantine-color-gray-3)">
            <Breadcrumbs separator={<ChevronRight size={14} />}>
              <Anchor component="button" type="button" onClick={() => openFolder(null)} fw={folderId ? 500 : 700}>全部资料</Anchor>
              {breadcrumbFolders.map((folder) => (
                <Anchor component="button" type="button" key={folder.id} onClick={() => openFolder(folder.id)} fw={folder.id === folderId ? 700 : 500}>{folder.name}</Anchor>
              ))}
            </Breadcrumbs>
            <Group gap="xs">
              <TextInput
                value={search}
                onChange={(event) => {
                  setSearch(event.currentTarget.value);
                  replaceQuery({ q: event.currentTarget.value || null });
                }}
                leftSection={<Search size={14} />}
                placeholder="搜索项目资料"
                size="xs"
                w={220}
              />
              <Select
                aria-label="排序方式"
                value={sortKey}
                onChange={(value) => replaceQuery({ sort: value })}
                data={[
                  { value: "name", label: "名称" },
                  { value: "created", label: "创建时间" },
                  { value: "updated", label: "更新时间" },
                  { value: "owner", label: "所有者" },
                  { value: "type", label: "类型" },
                ]}
                size="xs"
                w={128}
              />
              <Tooltip label={sortOrder === "asc" ? "改为降序" : "改为升序"}>
                <ActionIcon variant="default" aria-label="切换排序方向" onClick={() => replaceQuery({ order: sortOrder === "asc" ? "desc" : "asc" })}>{sortOrder === "asc" ? "↑" : "↓"}</ActionIcon>
              </Tooltip>
              <SegmentedControl
                size="xs"
                value={viewMode}
                onChange={(value) => replaceQuery({ view: value })}
                data={[
                  { value: "list", label: <List size={14} aria-label="列表视图" /> },
                  { value: "grid", label: <Grid2X2 size={14} aria-label="网格视图" /> },
                ]}
              />
              <ActionIcon variant="subtle" aria-label="刷新资料" loading={loading} onClick={() => void load(true)}><RefreshCw size={16} /></ActionIcon>
            </Group>
          </Group>

          <Group align="stretch" gap={0} wrap="nowrap">
            <Box style={{ flex: 1, minWidth: 0 }}>
              {loading ? <Center mih={320}><Loader size="sm" /></Center> : visibleEntries.length === 0 ? (
                <Center mih={320}>
                  <Stack align="center" gap="xs">
                    <Folder size={32} color="var(--mantine-color-gray-5)" />
                    <Text fw={600}>{search ? "没有匹配内容" : "这个文件夹是空的"}</Text>
                    <Text size="sm" c="dimmed">{canUpload ? "可拖入文件，或创建子文件夹。" : "当前没有可查看的资料。"}</Text>
                  </Stack>
                </Center>
              ) : viewMode === "grid" ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} p="md">
                  {visibleEntries.map((entry) => (
                    <EntryCard
                      key={entryKey(entry)}
                      entry={entry}
                      selected={selected ? entryKey(selected) === entryKey(entry) : false}
                      busy={Boolean(busy)}
                      pathname={pathname}
                      onOpenFolder={openFolder}
                      onSelect={selectEntry}
                      onShare={share}
                      onCopy={copyLink}
                      onDuplicate={duplicate}
                      onDelete={requestDelete}
                    />
                  ))}
                </SimpleGrid>
              ) : (
                <ScrollArea>
                  <Table highlightOnHover verticalSpacing="sm" miw={780}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>名称</Table.Th>
                        <Table.Th w={100}>类型</Table.Th>
                        <Table.Th w={100}>版本</Table.Th>
                        <Table.Th w={140}>所有者</Table.Th>
                        <Table.Th w={180}>更新时间</Table.Th>
                        <Table.Th w={54}><span className="sr-only">操作</span></Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {visibleEntries.map((entry) => (
                        <EntryRow
                          key={entryKey(entry)}
                          entry={entry}
                          selected={selected ? entryKey(selected) === entryKey(entry) : false}
                          busy={Boolean(busy)}
                          pathname={pathname}
                          onOpenFolder={openFolder}
                          onSelect={selectEntry}
                          onShare={share}
                          onCopy={copyLink}
                          onDuplicate={duplicate}
                          onDelete={requestDelete}
                        />
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}
            </Box>
            {!isNarrow ? (
              <Paper radius={0} w={320} bd="0 0 0 1px solid var(--mantine-color-gray-3)">
                {details}
              </Paper>
            ) : null}
          </Group>
        </Paper>
      </Box>

      <Drawer opened={detailOpened} onClose={detailHandlers.close} title="资料详情" position="right" size="md">{details}</Drawer>

      <Modal opened={createOpened} onClose={createHandlers.close} title="新建文件夹" centered>
        <Stack>
          <TextInput label="文件夹名称" value={newFolderName} onChange={(event) => setNewFolderName(event.currentTarget.value)} autoFocus maxLength={160} />
          <Group justify="flex-end"><Button variant="default" onClick={createHandlers.close}>取消</Button><Button loading={busy === "create-folder"} disabled={!newFolderName.trim()} onClick={() => void createFolder()}>创建</Button></Group>
        </Stack>
      </Modal>

      <Modal opened={shareOpened} onClose={shareHandlers.close} title="分享内部访问链接" centered>
        <Stack>
          <Alert color="projectBlue" title="只对已有权限成员有效">本轮使用受控内部链接，不创建匿名公开链接。访问者仍需登录，并通过项目与文档 ACL 校验；链接本身不会扩大权限。</Alert>
          <TextInput readOnly value={selected ? stableLink(selected) : ""} rightSection={<Link2 size={15} />} />
          <Group justify="flex-end"><Button variant="default" onClick={shareHandlers.close}>关闭</Button><Button leftSection={<Copy size={15} />} onClick={() => selected && void copyLink(selected)}>复制链接</Button></Group>
        </Stack>
      </Modal>

      <Modal opened={deleteOpened} onClose={deleteHandlers.close} title="确认删除" centered>
        <Stack>
          <Alert color="red" title={`删除“${selected ? entryName(selected) : ""}”？`}>
            {selected?.kind === "folder"
              ? "仅空文件夹可以删除。存在子文件夹或文件时会安全阻止，不会静默递归删除。"
              : "文件原件、版本、预览、解析块和向量会被精确清理；若已成为人工审核通过的正式需求来源，将阻止删除并提示归档。"}
          </Alert>
          <Group justify="flex-end"><Button variant="default" onClick={deleteHandlers.close}>取消</Button><Button color="red" leftSection={<Trash2 size={15} />} loading={Boolean(busy?.startsWith("delete:"))} onClick={() => void confirmDelete()}>确认删除</Button></Group>
        </Stack>
      </Modal>
    </Box>
  );
}

function EntryActions({
  entry,
  disabled,
  onShare,
  onCopy,
  onDuplicate,
  onDelete,
}: {
  entry: WorkspaceEntry;
  disabled: boolean;
  onShare: (entry: WorkspaceEntry) => void;
  onCopy: (entry: WorkspaceEntry) => Promise<void>;
  onDuplicate: (entry: WorkspaceEntry) => Promise<void>;
  onDelete: (entry: WorkspaceEntry) => void;
}) {
  const canManage = entry.kind === "folder"
    ? entry.folder.permissions.canDelete
    : entry.document.permissions.canDelete;
  return (
    <Menu position="bottom-end" shadow="md" withinPortal>
      <Menu.Target><ActionIcon variant="subtle" color="gray" aria-label={`${entryName(entry)} 操作`} disabled={disabled}><MoreHorizontal size={18} /></ActionIcon></Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<Share2 size={15} />} onClick={() => onShare(entry)}>分享</Menu.Item>
        <Menu.Item leftSection={<Link2 size={15} />} onClick={() => void onCopy(entry)}>复制链接</Menu.Item>
        {canManage ? <Menu.Item leftSection={<Copy size={15} />} onClick={() => void onDuplicate(entry)}>创建副本</Menu.Item> : null}
        {canManage ? <Menu.Divider /> : null}
        {canManage ? <Menu.Item color="red" leftSection={<Trash2 size={15} />} onClick={() => onDelete(entry)}>删除</Menu.Item> : null}
      </Menu.Dropdown>
    </Menu>
  );
}

function EntryName({ entry, pathname, onOpenFolder }: { entry: WorkspaceEntry; pathname: string; onOpenFolder: (folderId: string | null) => void }) {
  if (entry.kind === "folder") {
    return (
      <Anchor
        component={Link}
        href={internalFolderUrl(pathname, entry.folder.id)}
        fw={600}
        c="dark"
        onClick={(event) => {
          if (!event.metaKey && !event.ctrlKey && event.button === 0) {
            event.preventDefault();
            onOpenFolder(entry.folder.id);
          }
        }}
      >{entry.folder.name}</Anchor>
    );
  }
  const href = currentVersionUrl(entry.document);
  return href ? <Anchor component={Link} href={href} fw={600} c="dark">{entry.document.displayName}</Anchor> : <Text fw={600}>{entry.document.displayName}</Text>;
}

function EntryRow(props: {
  entry: WorkspaceEntry;
  selected: boolean;
  busy: boolean;
  pathname: string;
  onOpenFolder: (folderId: string | null) => void;
  onSelect: (entry: WorkspaceEntry) => void;
  onShare: (entry: WorkspaceEntry) => void;
  onCopy: (entry: WorkspaceEntry) => Promise<void>;
  onDuplicate: (entry: WorkspaceEntry) => Promise<void>;
  onDelete: (entry: WorkspaceEntry) => void;
}) {
  const { entry } = props;
  return (
    <Table.Tr bg={props.selected ? "var(--mantine-color-projectBlue-0)" : undefined} onClick={() => props.onSelect(entry)} style={{ cursor: "pointer" }}>
      <Table.Td>
        <Group gap="sm" wrap="nowrap">
          {entry.kind === "folder" ? (
            <ActionIcon
              variant="light"
              size="lg"
              color="projectBlue"
              aria-label={`打开${entryName(entry)}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onOpenFolder(entry.folder.id);
              }}
            ><EntryIcon entry={entry} size={19} /></ActionIcon>
          ) : (
            <ActionIcon
              component={Link}
              href={currentVersionUrl(entry.document) ?? "#"}
              variant="light"
              size="lg"
              color="gray"
              aria-label={`打开${entryName(entry)}`}
              onClick={(event) => event.stopPropagation()}
            ><EntryIcon entry={entry} size={19} /></ActionIcon>
          )}
          <Box miw={0}>
            <EntryName entry={entry} pathname={props.pathname} onOpenFolder={props.onOpenFolder} />
            {entry.kind === "file" ? <Group gap={6} mt={2}><Text size="xs" c="dimmed" truncate>{entry.document.currentVersion?.originalFilename}</Text><Badge size="xs" variant="dot" color={fileProcessingStatus(entry.document).color}>{fileProcessingStatus(entry.document).label}</Badge></Group> : null}
          </Box>
        </Group>
      </Table.Td>
      <Table.Td><Badge variant="light" color={entry.kind === "folder" ? "projectBlue" : "gray"}>{entryType(entry)}</Badge></Table.Td>
      <Table.Td>{entry.kind === "file" && entry.document.currentVersion ? <Anchor component={Link} href={currentVersionUrl(entry.document)!} onClick={(event) => event.stopPropagation()}>v{entry.document.currentVersion.versionNumber}</Anchor> : "—"}</Table.Td>
      <Table.Td><Text size="sm">{entryOwner(entry)}</Text></Table.Td>
      <Table.Td><Text size="sm" c="dimmed">{formatDate(entryUpdatedAt(entry))}</Text></Table.Td>
      <Table.Td onClick={(event) => event.stopPropagation()}><EntryActions entry={entry} disabled={props.busy} onShare={props.onShare} onCopy={props.onCopy} onDuplicate={props.onDuplicate} onDelete={props.onDelete} /></Table.Td>
    </Table.Tr>
  );
}

function EntryCard(props: Parameters<typeof EntryRow>[0]) {
  const { entry } = props;
  return (
    <Paper withBorder p="md" radius="md" bg={props.selected ? "var(--mantine-color-projectBlue-0)" : "white"} onClick={() => props.onSelect(entry)} style={{ cursor: "pointer" }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <ActionIcon variant="light" size="xl" color={entry.kind === "folder" ? "projectBlue" : "gray"} aria-label={`打开${entryName(entry)}`} onClick={(event) => { event.stopPropagation(); if (entry.kind === "folder") props.onOpenFolder(entry.folder.id); else { const href = currentVersionUrl(entry.document); if (href) window.location.assign(href); } }}><EntryIcon entry={entry} size={22} /></ActionIcon>
        <Box onClick={(event) => event.stopPropagation()}><EntryActions entry={entry} disabled={props.busy} onShare={props.onShare} onCopy={props.onCopy} onDuplicate={props.onDuplicate} onDelete={props.onDelete} /></Box>
      </Group>
      <Box mt="md"><EntryName entry={entry} pathname={props.pathname} onOpenFolder={props.onOpenFolder} /><Text size="xs" c="dimmed" mt={4}>{entryType(entry)} · {formatDate(entryUpdatedAt(entry))}</Text></Box>
    </Paper>
  );
}

function EntryDetails({
  entry,
  editName,
  moveFolderId,
  moveOptions,
  busy,
  editable,
  onEditName,
  onMove,
  onSave,
  onShare,
  onCopy,
}: {
  entry: WorkspaceEntry;
  editName: string;
  moveFolderId: string | null;
  moveOptions: { value: string; label: string }[];
  busy: boolean;
  editable: boolean;
  onEditName: (value: string) => void;
  onMove: (value: string | null) => void;
  onSave: () => void;
  onShare: () => void;
  onCopy: () => void;
}) {
  return (
    <Stack p="lg" gap="md">
      <Group wrap="nowrap"><ActionIcon variant="light" size="xl"><EntryIcon entry={entry} size={22} /></ActionIcon><Box miw={0}><Text fw={700} truncate>{entryName(entry)}</Text><Text size="xs" c="dimmed">{entryType(entry)}</Text></Box></Group>
      <Divider />
      <TextInput label="名称" value={editName} onChange={(event) => onEditName(event.currentTarget.value)} leftSection={<Pencil size={14} />} disabled={!editable} />
      <Select label="位置" value={moveFolderId ?? "root"} onChange={(value) => onMove(value === "root" ? null : value)} data={[{ value: "root", label: "全部资料" }, ...moveOptions]} searchable disabled={!editable} />
      {editable ? <Button onClick={onSave} loading={busy} disabled={!editName.trim()}>保存名称与位置</Button> : <Text size="xs" c="dimmed">你拥有查看权限；重命名和移动由项目成员或项目经理操作。</Text>}
      <Group grow><Button variant="light" leftSection={<Share2 size={14} />} onClick={onShare}>分享</Button><Button variant="light" leftSection={<Link2 size={14} />} onClick={onCopy}>复制链接</Button></Group>
      {entry.kind === "file" && currentVersionUrl(entry.document) ? <Button component={Link} href={currentVersionUrl(entry.document)!} variant="default" rightSection={<ExternalLink size={14} />}>打开文件</Button> : null}
      <Divider />
      <Stack gap={6}>
        <Text size="xs" c="dimmed">所有者</Text><Text size="sm">{entryOwner(entry)}</Text>
        <Text size="xs" c="dimmed">创建时间</Text><Text size="sm">{formatDate(entryCreatedAt(entry))}</Text>
        <Text size="xs" c="dimmed">更新时间</Text><Text size="sm">{formatDate(entryUpdatedAt(entry))}</Text>
      </Stack>
    </Stack>
  );
}

export default ProjectFileWorkspace;
