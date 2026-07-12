"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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
import { citations, documents } from "@/data/mock";
import { SourceCitation } from "@/components/common/source-citation";
import { useToast } from "@/components/common/toast";
import { ProjectContextHeader, getProjectRecord } from "./ProjectContextHeader";
import {
  asRecords,
  dateLabel,
  numberValue,
  statusClasses,
  statusLabel,
  textValue,
  type DataRecord,
} from "./mock-view";

interface DocumentsPageProps {
  projectId?: string;
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

const fallbackNames = [
  "北美互动活动 Scope v2.2.pdf",
  "客户需求确认纪要 0708.docx",
  "项目总排期 v5.xlsx",
  "AI 图像服务技术方案.pdf",
  "北美支付接口联调说明.docx",
  "素材授权范围确认邮件.eml",
  "UAT 第一轮测试报告.pdf",
  "项目启动会会议纪要.docx",
];

function normalizeDocuments(source: unknown, projectId: string): DocumentView[] {
  const records = asRecords(source);
  const projectMatched = records.filter((record) => textValue(record, "projectId", "") === projectId);
  return (projectMatched.length ? projectMatched : records).map((document, index) => {
    const category = textValue(document, ["category", "documentType", "type"], ["scope", "meeting", "schedule", "technical", "requirement", "email", "test", "meeting"][index % 8]);
    return {
      id: textValue(document, "id", `doc-${index + 1}`),
      name: textValue(document, ["name", "title", "fileName"], fallbackNames[index] ?? `项目文档 ${index + 1}.pdf`),
      type: textValue(document, ["mimeType", "fileType"], "application/pdf"),
      category,
      status: textValue(document, "status", index === 1 ? "pendingReview" : index === 6 ? "superseded" : "confirmed"),
      parseStatus: textValue(document, ["parseStatus", "parsingStatus"], index === 4 ? "processing" : index === 7 ? "failed" : "parsed"),
      version: textValue(document, "version", `v${index % 3 + 1}.${index % 2}`),
      isCurrent: Boolean(document.isCurrent ?? document.isEffectiveVersion ?? index < 6),
      size: textValue(document, ["size", "fileSize"], `${(1.2 + index * 0.6).toFixed(1)} MB`),
      updatedAt: textValue(document, "updatedAt", `2026-07-${String(12 - Math.min(index, 8)).padStart(2, "0")}`),
      owner: textValue(document, ["owner", "createdBy", "uploadedBy"], ["林可", "周霖", "陈舟"][index % 3]),
      permission: textValue(document, ["permissionScope", "permission"], index === 0 ? "项目核心成员" : "项目成员"),
      pageCount: numberValue(document, ["pageCount", "pages"], 8 + index * 3),
      summary: textValue(document, ["summary", "aiSummary"], "该文档定义了项目当前交付边界、关键功能和客户确认事项，是 AI 回答与需求提取的重要依据。"),
      raw: document,
    };
  });
}

export function DocumentsPage({ projectId }: DocumentsPageProps) {
  const { toast } = useToast();
  const project = getProjectRecord(projectId);
  const id = textValue(project, "id", projectId ?? "p1");
  const baseDocuments = useMemo(() => normalizeDocuments(documents, id), [id]);
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
  const documentCitations = asRecords(citations).filter((citation) => textValue(citation, ["documentId", "sourceId"], "") === selected?.id).slice(0, 2);
  const visibleCitations = documentCitations.length ? documentCitations : asRecords(citations).slice(0, 2);

  const uploadFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const uploaded = Array.from(files).map<DocumentView>((file, index) => ({
      id: `upload-${Date.now()}-${index}`,
      name: file.name,
      type: file.type,
      category: "attachment",
      status: "original",
      parseStatus: "processing",
      version: "v1.0",
      isCurrent: true,
      size: `${Math.max(0.1, file.size / 1024 / 1024).toFixed(1)} MB`,
      updatedAt: new Date().toISOString(),
      owner: "林可",
      permission: "项目成员",
      pageCount: 0,
      summary: "文件已进入 Mock 解析队列，完成后将生成摘要、事实和可检索引用。",
      raw: {},
    }));
    setLocalDocuments((current) => [...uploaded, ...current]);
    setSelectedId(uploaded[0].id);
  };

  return (
    <div className="min-h-full bg-background">
      <ProjectContextHeader projectId={id} activeTab="documents" />
      <main className="px-5 py-5 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-foreground">项目资料</h2><p className="mt-1 text-xs text-muted-foreground">{allDocuments.length} 份资料 · {allDocuments.filter((item) => item.parseStatus === "parsed").length} 份已完成 AI 解析</p></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"><Upload className="size-4" />上传文件</button>
            <input ref={fileInput} type="file" multiple className="sr-only" onChange={(event) => uploadFiles(event.target.files)} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.eml" />
          </div>
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
                {filtered.length ? filtered.map((document) => <button key={document.id} type="button" onClick={() => setSelectedId(document.id)} className={`group w-full border-b border-border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${selected?.id === document.id ? "bg-primary/5" : "hover:bg-muted/40"}`}><div className="flex items-start gap-3"><span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${document.parseStatus === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}><DocumentIcon name={document.name} /></span><div className="min-w-0 flex-1"><div className="flex items-start gap-2"><p className={`line-clamp-2 flex-1 text-xs font-medium leading-5 ${selected?.id === document.id ? "text-primary" : "text-foreground"}`}>{document.name}</p>{document.isCurrent && <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />}</div><div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground"><span>{categoryLabels[document.category] ?? document.category}</span><span>·</span><span>{document.version}</span><span>·</span><span>{document.size}</span></div><div className="mt-2 flex items-center justify-between"><ParseStatus status={document.parseStatus} /><span className="text-[10px] text-muted-foreground">{dateLabel(document.updatedAt)}</span></div></div></div></button>) : <div className="grid min-h-72 place-items-center px-6 text-center"><div><FileSearch className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium text-foreground">暂无匹配文件</p><p className="mt-1 text-xs text-muted-foreground">更换筛选条件或上传新资料。</p><button type="button" onClick={() => { setSearch(""); setCategory("all"); setStatusFilter("all"); setFolder("all"); }} className="mt-3 text-xs font-medium text-primary hover:underline">清除筛选</button></div></div>}
              </div>

              {selected ? <div className="min-w-0 overflow-y-auto">
                <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-foreground">{selected.name}</h3><div className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClasses(selected.status)}`}>{selected.status === "original" ? "原始资料" : statusLabel(selected.status)}</span>{selected.isCurrent && <span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">当前有效版本</span>}</div></div><button type="button" onClick={() => toast("文件操作菜单为 MVP 只读占位", "info")} aria-label="文件更多操作" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="size-4" /></button></div>
                <div className="p-4">
                  <div className="relative grid aspect-[4/3] max-h-[360px] place-items-center overflow-hidden rounded-lg border border-border bg-muted/25">
                    <div className="absolute inset-x-0 top-0 flex h-9 items-center justify-between border-b border-border bg-card/90 px-3 text-[10px] text-muted-foreground"><span>文档预览 · 第 1 / {selected.pageCount || "—"} 页</span><div className="flex items-center gap-1"><button type="button" onClick={() => toast(`已准备下载「${selected.name}」`, "info")} aria-label="下载文件" className="grid size-6 place-items-center rounded hover:bg-muted"><Download className="size-3.5" /></button><button type="button" onClick={() => toast("文档全屏预览将在真实文件服务接入后开放", "info")} aria-label="全屏打开" className="grid size-6 place-items-center rounded hover:bg-muted"><ExternalLink className="size-3.5" /></button></div></div>
                    <div className="w-[72%] rounded border border-border bg-card p-5 shadow-sm"><div className="h-2 w-2/3 rounded bg-foreground/15" /><div className="mt-5 space-y-2">{[100, 94, 98, 72, 88, 96, 62].map((width, index) => <div key={index} className="h-1.5 rounded bg-muted-foreground/10" style={{ width: `${width}%` }} />)}</div><div className="mt-5 rounded bg-primary/5 p-3"><div className="h-1.5 w-1/2 rounded bg-primary/20" /><div className="mt-2 h-1.5 w-full rounded bg-primary/10" /><div className="mt-1.5 h-1.5 w-4/5 rounded bg-primary/10" /></div></div>
                    {selected.parseStatus === "processing" && <div className="absolute inset-0 grid place-items-center bg-card/85 backdrop-blur-sm"><div className="text-center"><LoaderCircle className="mx-auto size-6 animate-spin text-primary" /><p className="mt-2 text-xs font-medium text-foreground">AI 正在解析文档</p><p className="mt-1 text-[10px] text-muted-foreground">正在识别章节与事实</p></div></div>}
                  </div>
                  <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2"><Meta label="文件类型" value={categoryLabels[selected.category] ?? selected.category} /><Meta label="版本" value={selected.version} /><Meta label="上传人" value={selected.owner} /><Meta label="更新时间" value={dateLabel(selected.updatedAt)} /><Meta label="权限范围" value={selected.permission} /><Meta label="关联对象" value="6 项" /></div>
                  <div className="mt-4"><p className="mb-2 text-[11px] font-medium text-muted-foreground">关联对象</p><div className="flex flex-wrap gap-1.5">{["需求 REQ-018", "Scope v2.2", "Action A-032", "客户周会 0708", "风险 R-006"].map((item) => <button key={item} type="button" onClick={() => toast(`已定位关联对象：${item}`, "info")} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground hover:border-primary/30 hover:text-primary"><Link2 className="size-3" />{item}</button>)}</div></div>
                </div>
              </div> : <div className="grid place-items-center text-sm text-muted-foreground">请选择文件查看详情</div>}
            </div>
          </div>

          <aside className="min-w-0 bg-muted/10">
            {selected ? <>
              <div className="flex border-b border-border px-3 pt-2">{([{ id: "summary", label: "AI 摘要" }, { id: "facts", label: "提取事实" }, { id: "links", label: "引用与版本" }] as const).map((tab) => <button key={tab.id} type="button" onClick={() => setActivePanel(tab.id)} className={`relative flex-1 px-2 py-2.5 text-xs font-medium ${activePanel === tab.id ? "text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary" : "text-muted-foreground hover:text-foreground"}`}>{tab.label}</button>)}</div>
              <div className="max-h-[680px] overflow-y-auto p-4">
                {activePanel === "summary" && <div className="space-y-4"><div className="rounded-lg border border-primary/15 bg-primary/5 p-3"><div className="mb-2 flex items-center gap-2"><Sparkles className="size-3.5 text-primary" /><p className="text-xs font-semibold text-foreground">文档摘要</p><span className="ml-auto text-[10px] text-muted-foreground">置信度 94%</span></div><p className="text-xs leading-5 text-muted-foreground">{selected.summary}</p></div><div><p className="mb-2 text-xs font-semibold text-foreground">关键内容</p><ul className="space-y-2">{["首发范围包含移动端 AI 图片生成与分享链路", "客户确认生成内容需保留 30 天", "上线目标为 2026 年 9 月 15 日", "桌面端高级编辑能力不在当前 Scope"].map((item) => <li key={item} className="flex gap-2 text-xs leading-5 text-muted-foreground"><Check className="mt-1 size-3 shrink-0 text-success" />{item}</li>)}</ul></div><div className="rounded-lg border border-warning/20 bg-warning/5 p-3"><div className="flex items-center gap-2 text-xs font-medium text-warning"><AlertCircle className="size-3.5" />待确认内容</div><p className="mt-2 text-xs leading-5 text-muted-foreground">素材授权是否覆盖用户二次创作，当前文档中没有明确说明。</p></div></div>}
                {activePanel === "facts" && <div className="space-y-3">{[{ label: "项目上线日期", value: "2026-09-15", status: "已确认" }, { label: "首发区域", value: "美国、加拿大", status: "已确认" }, { label: "内容保留周期", value: "30 天", status: "已确认" }, { label: "日峰值生成量", value: "50,000 次", status: "待确认" }, { label: "当前有效 Scope", value: "v2.2", status: "已确认" }].map((fact) => <div key={fact.label} className="rounded-lg border border-border bg-card p-3"><div className="flex items-center justify-between gap-2"><p className="text-[11px] text-muted-foreground">{fact.label}</p><span className={`rounded-full px-1.5 py-0.5 text-[9px] ${fact.status === "已确认" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{fact.status}</span></div><p className="mt-1.5 text-sm font-medium text-foreground">{fact.value}</p><button type="button" onClick={() => toast(`已定位「${fact.label}」的原文引用`, "info")} className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline">查看原文 <ChevronRight className="size-3" /></button></div>)}</div>}
                {activePanel === "links" && <div className="space-y-4"><div className="rounded-lg border border-success/20 bg-success/5 p-3"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-success" /><div><p className="text-xs font-medium text-foreground">当前有效版本</p><p className="mt-0.5 text-[10px] text-muted-foreground">{selected.version} · 自 2026/06/28 生效</p></div></div></div><div><p className="mb-2 text-xs font-semibold text-foreground">版本记录</p><div className="space-y-2">{[selected.version, "v2.1", "v1.0"].map((version, index) => <button key={version} type="button" onClick={() => toast(`正在查看文档版本 ${version}`, "info")} className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left ${index === 0 ? "border-primary/20 bg-primary/5" : "border-border bg-card hover:bg-muted"}`}><FileText className={`size-3.5 ${index === 0 ? "text-primary" : "text-muted-foreground"}`} /><span className="flex-1 text-xs font-medium text-foreground">{version}</span>{index === 0 ? <span className="text-[9px] text-success">当前有效</span> : <span className="text-[9px] text-muted-foreground">历史版本</span>}</button>)}</div></div><div><p className="mb-2 text-xs font-semibold text-foreground">来源引用</p><div className="space-y-2">{visibleCitations.map((citation, index) => <SourceCitation key={textValue(citation, "id", `citation-${index}`)} citation={{ id: textValue(citation, "id", `citation-${index}`), documentId: textValue(citation, "documentId", selected.id), documentName: textValue(citation, ["documentName", "sourceName"], selected.name), section: textValue(citation, "section", "项目范围"), pageNumber: numberValue(citation, "pageNumber", index + 3), sourceDate: textValue(citation, "sourceDate", selected.updatedAt), status: textValue(citation, "status", "confirmed"), isEffectiveVersion: Boolean(citation.isEffectiveVersion ?? true), citationText: textValue(citation, ["citationText", "text"], "首发版本覆盖移动端核心生成与分享流程。"), trustLevel: textValue(citation, "trustLevel", "high") }} compact />)}</div></div></div>}
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
