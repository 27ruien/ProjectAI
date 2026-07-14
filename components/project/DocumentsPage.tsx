"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CircleEllipsis,
  Clock3,
  Download,
  ExternalLink,
  FileArchive,
  FileCheck2,
  FileClock,
  FileSearch,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { SourceCitation } from "@/components/common/source-citation";
import { useToast } from "@/components/common/toast";
import { ProjectContextHeader } from "./ProjectContextHeader";
import type { AuthorizedProjectSummary, ProjectMockPayload } from "@/lib/auth/ui-types";
import {
  asRecords,
  dateLabel,
  numberValue,
  statusClasses,
  statusLabel,
  stringList,
  textValue,
  type DataRecord,
} from "./mock-view";

interface DocumentsPageProps {
  project: AuthorizedProjectSummary;
  data: ProjectMockPayload;
}

interface DocumentView {
  id: string;
  name: string;
  type: string;
  category: string;
  status: string;
  parseStatus: string;
  version: string;
  isCurrent: boolean;
  size: string;
  updatedAt: string;
  owner: string;
  permission: string;
  pageCount: number;
  summary: string;
  raw: DataRecord;
}

const categoryLabels: Record<string, string> = {
  contract: "合同",
  scope: "Scope",
  requirement: "客户需求",
  meeting: "会议纪要",
  schedule: "项目排期",
  technical: "技术方案",
  test: "测试报告",
  feedback: "客户反馈",
  email: "邮件",
  attachment: "普通附件",
};

function normalizeDocuments(source: unknown): DocumentView[] {
  const records = asRecords(source);
  return records.map((document, index) => {
    const category = textValue(document, ["category", "documentType", "type"], "attachment");
    const fileSize = numberValue(document, "fileSize", 0);
    return {
      id: textValue(document, "id", `doc-${index + 1}`),
      name: textValue(document, ["name", "title", "fileName"], "未命名文档"),
      type: textValue(document, ["mimeType", "fileType"], "未提供"),
      category,
      status: textValue(document, "status", "original"),
      parseStatus: textValue(document, ["parseStatus", "parsingStatus"], "waiting"),
      version: textValue(document, ["versionLabel", "version"], "未标记"),
      isCurrent: Boolean(document.isCurrent ?? document.isEffectiveVersion ?? document.isEffective ?? false),
      size: textValue(document, "size", fileSize > 0 ? `${(fileSize / 1024 / 1024).toFixed(1)} MB` : "—"),
      updatedAt: textValue(document, "updatedAt", ""),
      owner: textValue(document, ["owner", "createdBy", "uploadedBy"], "未提供"),
      permission: textValue(document, ["permissionScope", "permission"], "未提供"),
      pageCount: numberValue(document, ["pageCount", "pages"], 0),
      summary: textValue(document, ["summary", "aiSummary"], "暂无文档摘要。"),
      raw: document,
    };
  });
}

export function DocumentsPage({ project, data }: DocumentsPageProps) {
  const { toast } = useToast();
  const baseDocuments = useMemo(() => normalizeDocuments(data.documents), [data.documents]);
  const [localDocuments, setLocalDocuments] = useState<DocumentView[]>([]);
  const [selectedId, setSelectedId] = useState(baseDocuments[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [folder, setFolder] = useState("all");
  const [activePanel, setActivePanel] = useState<"summary" | "facts" | "links">("summary");
  const fileInput = useRef<HTMLInputElement>(null);
  const allDocuments = [...localDocuments, ...baseDocuments];
  const filtered = allDocuments.filter((document) => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    const matchesFolder = folder === "all" || (folder === "current" && document.isCurrent) || (folder === "pending" && document.status === "pendingReview") || (folder === "failed" && document.parseStatus === "failed");
    return (!keyword || document.name.toLocaleLowerCase("zh-CN").includes(keyword)) && (category === "all" || document.category === category) && (statusFilter === "all" || document.parseStatus === statusFilter) && matchesFolder;
  });
  const selected = allDocuments.find((document) => document.id === selectedId) ?? filtered[0];
  const categories = Object.entries(categoryLabels).map(([key, label]) => ({ key, label, count: allDocuments.filter((document) => document.category === key).length }));
  const documentCitations = asRecords(data.citations).filter((citation) => textValue(citation, ["documentId", "sourceId"], "") === selected?.id).slice(0, 2);
  const visibleCitations = documentCitations;
  const selectedRelations = selected
    ? [
        ["需求", stringList(selected.raw, ["relatedRequirementIds", "requirementIds"])],
        ["Scope", stringList(selected.raw, ["relatedScopeIds", "scopeIds"])],
        ["Action", stringList(selected.raw, ["relatedActionIds", "actionIds"])],
        ["会议", stringList(selected.raw, ["relatedMeetingIds", "meetingIds"])],
        ["风险", stringList(selected.raw, ["relatedRiskIds", "riskIds"])],
      ].flatMap(([label, ids]) => (ids as string[]).map((id) => `${label} · ${id}`))
    : [];
  const extractedFacts = selected
    ? stringList(selected.raw, ["aiExtractedFacts", "facts", "keyPoints"])
    : [];
  const pendingQuestions = selected
    ? stringList(selected.raw, ["pendingQuestions", "openQuestions"])
    : [];
  const summaryConfidence = selected
    ? numberValue(selected.raw, ["summaryConfidence", "confidence"], 0)
    : 0;
  const rawVersions = selected ? asRecords(selected.raw.versions) : [];
  const versionRows = selected
    ? rawVersions.length > 0
      ? rawVersions.map((version, index) => ({
          id: textValue(version, "id", `${selected.id}-version-${index}`),
          label: textValue(version, ["versionLabel", "version", "name"], "未标记"),
          current: Boolean(version.isCurrent ?? false),
          effectiveFrom: textValue(version, "effectiveFrom", ""),
        }))
      : [{ id: `${selected.id}-current`, label: selected.version, current: selected.isCurrent, effectiveFrom: textValue(selected.raw, "effectiveFrom", "") }]
    : [];

  const uploadFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const uploaded = Array.from(files).map<DocumentView>((file, index) => ({
      id: `upload-${Date.now()}-${index}`,
      name: file.name,
      type: file.type,
      category: "attachment",
      status: "original",
      parseStatus: "waiting",
      version: "v1.0",
      isCurrent: true,
      size: `${Math.max(0.1, file.size / 1024 / 1024).toFixed(1)} MB`,
      updatedAt: new Date().toISOString(),
      owner: "当前用户（演示）",
      permission: "当前浏览器会话（演示）",
      pageCount: 0,
      summary: "这是仅保存在当前浏览器内存中的演示条目，文件未上传、未解析，刷新页面后会消失。",
      raw: {},
    }));
    setLocalDocuments((current) => [...uploaded, ...current]);
    setSelectedId(uploaded[0].id);
    toast("已添加浏览器演示条目；未上传文件，也未写入对象存储", "info");
  };

  return (
    <div className="min-h-full bg-background">
      <ProjectContextHeader project={project} activeTab="documents" />
      <main className="px-5 py-5 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-foreground">项目资料</h2><p className="mt-1 text-xs text-muted-foreground">{allDocuments.length} 份资料 · {allDocuments.filter((item) => item.parseStatus === "parsed").length} 份已完成 AI 解析</p></div>
          {project.permissions.canEditProject ? <div className="flex items-center gap-2">
            <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"><Upload className="size-4" />演示上传</button>
            <input ref={fileInput} type="file" multiple className="sr-only" onChange={(event) => uploadFiles(event.target.files)} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.eml" />
          </div> : null}
        </div>

        <section className="grid min-h-[720px] overflow-hidden rounded-xl border border-border bg-card xl:grid-cols-[220px_minmax(500px,1fr)_340px]">
          <aside className="border-b border-border bg-muted/20 xl:border-b-0 xl:border-r">
            <div className="p-3">
              <label className="relative block"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">搜索文件</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索文件" className="h-8 w-full rounded-lg border border-input bg-card pl-8 pr-8 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" />{search && <button type="button" onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"><X className="size-3" /></button>}</label>
            </div>
            <div className="border-y border-border px-2 py-3">
              <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">文件目录</p>
              {[{ key: "all", label: "全部资料", icon: FolderOpen, count: allDocuments.length }, { key: "current", label: "当前有效版本", icon: FileCheck2, count: allDocuments.filter((item) => item.isCurrent).length }, { key: "pending", label: "待确认", icon: FileClock, count: allDocuments.filter((item) => item.status === "pendingReview").length }, { key: "failed", label: "解析异常", icon: AlertCircle, count: allDocuments.filter((item) => item.parseStatus === "failed").length }].map((item) => <button key={item.key} type="button" onClick={() => setFolder(item.key)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors ${folder === item.key ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><item.icon className="size-3.5" /><span className="flex-1">{item.label}</span><span className="tabular-nums">{item.count}</span></button>)}
            </div>
            <div className="px-2 py-3">
              <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">文件分类</p>
              <button type="button" onClick={() => setCategory("all")} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${category === "all" ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Folder className="size-3.5" /><span className="flex-1">全部分类</span><span>{allDocuments.length}</span></button>
              {categories.filter((item) => item.count > 0).map((item) => <button key={item.key} type="button" onClick={() => setCategory(item.key)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${category === item.key ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><FileText className="size-3.5" /><span className="flex-1">{item.label}</span><span>{item.count}</span></button>)}
            </div>
          </aside>

          <div className="min-w-0 border-b border-border xl:border-b-0 xl:border-r">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><span>文件列表</span><span className="rounded-md bg-muted px-1.5 py-0.5 tabular-nums">{filtered.length}</span></div>
              <label className="relative"><span className="sr-only">解析状态筛选</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-8 appearance-none rounded-lg border border-input bg-background pl-2.5 pr-7 text-xs text-foreground outline-none focus:border-primary"><option value="all">全部解析状态</option><option value="parsed">解析完成</option><option value="processing">解析中</option><option value="waiting">等待解析</option><option value="failed">解析失败</option></select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /></label>
            </div>
            <div className="grid min-h-[660px] md:grid-cols-[minmax(250px,0.72fr)_minmax(300px,1fr)]">
              <div className="max-h-[660px] overflow-y-auto border-b border-border md:border-b-0 md:border-r">
                {filtered.length ? filtered.map((document) => <button key={document.id} type="button" onClick={() => setSelectedId(document.id)} className={`group w-full border-b border-border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${selected?.id === document.id ? "bg-primary/5" : "hover:bg-muted/40"}`}><div className="flex items-start gap-3"><span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${document.parseStatus === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}><DocumentIcon name={document.name} /></span><div className="min-w-0 flex-1"><div className="flex items-start gap-2"><p className={`line-clamp-2 flex-1 text-xs font-medium leading-5 ${selected?.id === document.id ? "text-primary" : "text-foreground"}`}>{document.name}</p>{document.isCurrent && <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />}</div><div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground"><span>{categoryLabels[document.category] ?? document.category}</span><span>·</span><span>{document.version}</span><span>·</span><span>{document.size}</span></div><div className="mt-2 flex items-center justify-between"><ParseStatus status={document.parseStatus} /><span className="text-[10px] text-muted-foreground">{document.updatedAt ? dateLabel(document.updatedAt) : "未提供日期"}</span></div></div></div></button>) : <div className="grid min-h-72 place-items-center px-6 text-center"><div><FileSearch className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium text-foreground">{allDocuments.length ? "暂无匹配文件" : "暂无项目资料"}</p><p className="mt-1 text-xs text-muted-foreground">{allDocuments.length ? "请调整搜索或筛选条件。" : "父级尚未提供当前项目可访问的资料。"}</p>{allDocuments.length ? <button type="button" onClick={() => { setSearch(""); setCategory("all"); setStatusFilter("all"); setFolder("all"); }} className="mt-3 text-xs font-medium text-primary hover:underline">清除筛选</button> : null}</div></div>}
              </div>

              {selected ? <div className="min-w-0 overflow-y-auto">
                <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-foreground">{selected.name}</h3><div className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClasses(selected.status)}`}>{selected.status === "original" ? "原始资料" : statusLabel(selected.status)}</span>{selected.isCurrent && <span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">当前有效版本</span>}</div></div><button type="button" onClick={() => toast("文件操作菜单为 MVP 只读占位", "info")} aria-label="文件更多操作" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="size-4" /></button></div>
                <div className="p-4">
                  <div className="relative grid aspect-[4/3] max-h-[360px] place-items-center overflow-hidden rounded-lg border border-border bg-muted/25">
                    <div className="absolute inset-x-0 top-0 flex h-9 items-center justify-between border-b border-border bg-card/90 px-3 text-[10px] text-muted-foreground"><span>文档预览 · 第 1 / {selected.pageCount || "—"} 页</span><div className="flex items-center gap-1"><button type="button" onClick={() => toast(`已准备下载「${selected.name}」`, "info")} aria-label="下载文件" className="grid size-6 place-items-center rounded hover:bg-muted"><Download className="size-3.5" /></button><button type="button" onClick={() => toast("文档全屏预览将在真实文件服务接入后开放", "info")} aria-label="全屏打开" className="grid size-6 place-items-center rounded hover:bg-muted"><ExternalLink className="size-3.5" /></button></div></div>
                    <div className="w-[72%] rounded border border-border bg-card p-5 shadow-sm"><div className="h-2 w-2/3 rounded bg-foreground/15" /><div className="mt-5 space-y-2">{[100, 94, 98, 72, 88, 96, 62].map((width, index) => <div key={index} className="h-1.5 rounded bg-muted-foreground/10" style={{ width: `${width}%` }} />)}</div><div className="mt-5 rounded bg-primary/5 p-3"><div className="h-1.5 w-1/2 rounded bg-primary/20" /><div className="mt-2 h-1.5 w-full rounded bg-primary/10" /><div className="mt-1.5 h-1.5 w-4/5 rounded bg-primary/10" /></div></div>
                    {selected.parseStatus === "processing" && <div className="absolute inset-0 grid place-items-center bg-card/85 backdrop-blur-sm"><div className="text-center"><LoaderCircle className="mx-auto size-6 animate-spin text-primary" /><p className="mt-2 text-xs font-medium text-foreground">AI 正在解析文档</p><p className="mt-1 text-[10px] text-muted-foreground">正在识别章节与事实</p></div></div>}
                  </div>
                  <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2"><Meta label="文件类型" value={categoryLabels[selected.category] ?? selected.category} /><Meta label="版本" value={selected.version} /><Meta label="上传人" value={selected.owner} /><Meta label="更新时间" value={selected.updatedAt ? dateLabel(selected.updatedAt) : "未提供"} /><Meta label="权限范围" value={selected.permission} /><Meta label="关联对象" value={`${selectedRelations.length} 项`} /></div>
                  <div className="mt-4"><p className="mb-2 text-[11px] font-medium text-muted-foreground">关联对象</p>{selectedRelations.length ? <div className="flex flex-wrap gap-1.5">{selectedRelations.map((item) => <button key={item} type="button" onClick={() => toast(`已定位关联对象：${item}`, "info")} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground hover:border-primary/30 hover:text-primary"><Link2 className="size-3" />{item}</button>)}</div> : <p className="text-xs text-muted-foreground">父级 payload 未提供关联对象。</p>}</div>
                </div>
              </div> : <div className="grid place-items-center text-sm text-muted-foreground">请选择文件查看详情</div>}
            </div>
          </div>

          <aside className="min-w-0 bg-muted/10">
            {selected ? <>
              <div className="flex border-b border-border px-3 pt-2">{([{ id: "summary", label: "AI 摘要" }, { id: "facts", label: "提取事实" }, { id: "links", label: "引用与版本" }] as const).map((tab) => <button key={tab.id} type="button" onClick={() => setActivePanel(tab.id)} className={`relative flex-1 px-2 py-2.5 text-xs font-medium ${activePanel === tab.id ? "text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary" : "text-muted-foreground hover:text-foreground"}`}>{tab.label}</button>)}</div>
              <div className="max-h-[680px] overflow-y-auto p-4">
                {activePanel === "summary" && <div className="space-y-4"><div className="rounded-lg border border-primary/15 bg-primary/5 p-3"><div className="mb-2 flex items-center gap-2"><Sparkles className="size-3.5 text-primary" /><p className="text-xs font-semibold text-foreground">文档摘要</p>{summaryConfidence > 0 ? <span className="ml-auto text-[10px] text-muted-foreground">置信度 {summaryConfidence > 1 ? summaryConfidence : Math.round(summaryConfidence * 100)}%</span> : null}</div><p className="text-xs leading-5 text-muted-foreground">{selected.summary}</p></div>{pendingQuestions.length ? <div className="rounded-lg border border-warning/20 bg-warning/5 p-3"><div className="flex items-center gap-2 text-xs font-medium text-warning"><AlertCircle className="size-3.5" />待确认内容</div><ul className="mt-2 space-y-1.5">{pendingQuestions.map((item) => <li key={item} className="text-xs leading-5 text-muted-foreground">{item}</li>)}</ul></div> : <p className="text-xs text-muted-foreground">父级 payload 未提供待确认内容。</p>}</div>}
                {activePanel === "facts" && <div className="space-y-3">{extractedFacts.length ? extractedFacts.map((fact, index) => <div key={`${fact}-${index}`} className="rounded-lg border border-border bg-card p-3"><div className="flex items-center justify-between gap-2"><p className="text-[11px] text-muted-foreground">提取事实 {index + 1}</p><span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">AI 草稿</span></div><p className="mt-1.5 text-sm font-medium text-foreground">{fact}</p></div>) : <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">父级 payload 未提供文档事实。</p>}</div>}
                {activePanel === "links" && <div className="space-y-4">{selected.isCurrent ? <div className="rounded-lg border border-success/20 bg-success/5 p-3"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-success" /><div><p className="text-xs font-medium text-foreground">当前有效版本</p><p className="mt-0.5 text-[10px] text-muted-foreground">{selected.version}{versionRows.find((version) => version.current)?.effectiveFrom ? ` · 自 ${dateLabel(versionRows.find((version) => version.current)?.effectiveFrom)} 生效` : ""}</p></div></div></div> : <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">父级 payload 未将该文档标记为当前有效版本。</div>}<div><p className="mb-2 text-xs font-semibold text-foreground">版本记录</p>{versionRows.length ? <div className="space-y-2">{versionRows.map((version) => <button key={version.id} type="button" onClick={() => toast(`正在查看文档版本 ${version.label}`, "info")} className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left ${version.current ? "border-primary/20 bg-primary/5" : "border-border bg-card hover:bg-muted"}`}><FileText className={`size-3.5 ${version.current ? "text-primary" : "text-muted-foreground"}`} /><span className="flex-1 text-xs font-medium text-foreground">{version.label}</span><span className={`text-[9px] ${version.current ? "text-success" : "text-muted-foreground"}`}>{version.current ? "当前有效" : "历史版本"}</span></button>)}</div> : <p className="text-xs text-muted-foreground">暂无版本记录。</p>}</div><div><p className="mb-2 text-xs font-semibold text-foreground">来源引用</p>{visibleCitations.length ? <div className="space-y-2">{visibleCitations.map((citation, index) => <SourceCitation key={textValue(citation, "id", `citation-${index}`)} citation={{ id: textValue(citation, "id", `citation-${index}`), documentId: textValue(citation, "documentId", selected.id), documentName: textValue(citation, ["documentName", "sourceName"], selected.name), section: textValue(citation, "section", "未提供章节"), pageNumber: numberValue(citation, "pageNumber", 0) || undefined, sourceDate: textValue(citation, "sourceDate", ""), status: textValue(citation, ["status", "sourceStatus"], "未提供"), isEffectiveVersion: Boolean(citation.isEffectiveVersion ?? citation.isEffective ?? false), citationText: textValue(citation, ["citationText", "text"], "引用内容未提供。"), trustLevel: textValue(citation, "trustLevel", "未提供") }} compact />)}</div> : <p className="text-xs text-muted-foreground">父级 payload 未提供该文档的来源引用。</p>}</div></div>}
              </div>
            </> : null}
          </aside>
        </section>
      </main>
    </div>
  );
}

function DocumentIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip")) return <FileArchive className="size-4" />;
  if (lower.endsWith(".eml")) return <Paperclip className="size-4" />;
  return <FileText className="size-4" />;
}

function ParseStatus({ status }: { status: string }) {
  const config = {
    parsed: { label: "AI 已解析", icon: CheckCircle2, classes: "text-success" },
    processing: { label: "解析中", icon: LoaderCircle, classes: "text-primary" },
    waiting: { label: "等待解析", icon: Clock3, classes: "text-muted-foreground" },
    failed: { label: "解析失败", icon: AlertCircle, classes: "text-destructive" },
  }[status] ?? { label: status, icon: CircleEllipsis, classes: "text-muted-foreground" };
  const Icon = config.icon;
  return <span className={`inline-flex items-center gap-1 text-[10px] ${config.classes}`}><Icon className={`size-3 ${status === "processing" ? "animate-spin" : ""}`} />{config.label}</span>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="bg-card px-3 py-2.5"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 truncate text-xs font-medium text-foreground">{value}</p></div>;
}

export default DocumentsPage;
