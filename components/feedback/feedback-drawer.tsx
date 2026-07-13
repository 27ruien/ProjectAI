"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Clipboard, MessageSquareText, ShieldAlert } from "lucide-react";
import { APP_RUNTIME } from "@/config/app-runtime";
import { Button } from "@/components/common/button";
import { Drawer } from "@/components/common/drawer";
import { useToast } from "@/components/common/toast";
import { storageKey } from "@/lib/storage-key";

const feedbackTypes = [
  "功能问题",
  "内容问题",
  "交互问题",
  "视觉问题",
  "AI 结果问题",
  "数据问题",
  "其他",
] as const;

const severityLevels = ["P0", "P1", "P2", "建议"] as const;

type FeedbackType = (typeof feedbackTypes)[number];
type SeverityLevel = (typeof severityLevels)[number];

interface FeedbackRecord {
  id: string;
  page: string;
  type: FeedbackType;
  description: string;
  severity: SeverityLevel;
  version: string;
  commitSha: string;
  environment: string;
  userAgent: string;
  createdAt: string;
}

const fieldClasses =
  "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";

function formatIssue(record: FeedbackRecord): string {
  return [
    "## 产品反馈",
    "",
    `- 当前页面：\`${record.page}\``,
    `- 反馈类型：${record.type}`,
    `- 严重级别：${record.severity}`,
    `- 当前版本：${record.version}`,
    `- Commit：\`${record.commitSha}\``,
    `- 当前环境：${record.environment}`,
    `- 创建时间：${record.createdAt}`,
    `- User Agent：\`${record.userAgent}\``,
    "",
    "## 问题描述",
    "",
    record.description,
    "",
    "> 此反馈未自动附加页面内容、项目资料、文件或网络数据。",
  ].join("\n");
}

function storedRecords(): FeedbackRecord[] {
  try {
    const value = window.localStorage.getItem(storageKey("feedback"));
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as FeedbackRecord[]) : [];
  } catch {
    return [];
  }
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard is unavailable");
}

export function FeedbackDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { toast } = useToast();
  const [type, setType] = useState<FeedbackType>("功能问题");
  const [severity, setSeverity] = useState<SeverityLevel>("P1");
  const [description, setDescription] = useState("");
  const [issueText, setIssueText] = useState("");

  const save = async (copyAfterSave: boolean) => {
    const normalizedDescription = description.trim();
    if (normalizedDescription.length < 5) {
      toast("请至少用 5 个字符描述问题", "info");
      return;
    }

    const createdAt = new Date().toISOString();
    const record: FeedbackRecord = {
      id: globalThis.crypto?.randomUUID?.() ?? `feedback-${Date.now()}`,
      page: pathname,
      type,
      description: normalizedDescription,
      severity,
      version: APP_RUNTIME.version,
      commitSha: APP_RUNTIME.commitSha,
      environment: APP_RUNTIME.environment,
      userAgent: navigator.userAgent,
      createdAt,
    };
    const formatted = formatIssue(record);

    try {
      const records = [...storedRecords(), record].slice(-50);
      window.localStorage.setItem(storageKey("feedback"), JSON.stringify(records));
    } catch {
      toast("浏览器未能保存反馈，请复制文本后手动留存", "info");
      setIssueText(formatted);
      return;
    }

    setIssueText(formatted);
    if (!copyAfterSave) {
      toast("反馈已保存在当前浏览器", "success");
      return;
    }

    try {
      await copyToClipboard(formatted);
      toast("反馈已保存并复制为 GitHub Issue 格式", "success");
    } catch {
      toast("反馈已保存，但浏览器拒绝了剪贴板访问", "info");
    }
  };

  const copyGenerated = async () => {
    try {
      await copyToClipboard(issueText);
      toast("GitHub Issue 文本已复制", "success");
    } catch {
      toast("浏览器拒绝了剪贴板访问，请手动复制", "info");
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="提交试用反馈"
      description="反馈仅保存在当前环境的浏览器中，不会自动发送。"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="outline" onClick={() => void save(false)}>仅保存</Button>
          <Button onClick={() => void save(true)}>
            <Clipboard aria-hidden="true" className="size-4" />
            保存并复制
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-warning/25 bg-warning/5 p-3 text-xs leading-5 text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <ShieldAlert aria-hidden="true" className="size-4 text-warning" />
            不要在反馈中填写客户资料或其他敏感业务数据
          </div>
          <p className="mt-1">系统只自动记录当前路径和浏览器信息，不读取页面内容、文件、控制台、网络请求或项目数据。</p>
        </div>

        <label className="block text-xs font-medium text-foreground">
          当前页面
          <input className={`${fieldClasses} text-muted-foreground`} value={pathname} readOnly />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-medium text-foreground">
            反馈类型
            <select className={fieldClasses} value={type} onChange={(event) => setType(event.target.value as FeedbackType)}>
              {feedbackTypes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-foreground">
            严重级别
            <select className={fieldClasses} value={severity} onChange={(event) => setSeverity(event.target.value as SeverityLevel)}>
              {severityLevels.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>

        <label className="block text-xs font-medium text-foreground">
          问题描述
          <textarea
            className={fieldClasses}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={7}
            maxLength={3000}
            placeholder="说明发生了什么、你期望看到什么，以及可复现步骤。请勿粘贴项目资料。"
          />
          <span className="mt-1 block text-right text-[10px] font-normal text-muted-foreground">{description.length} / 3000</span>
        </label>

        <dl className="grid gap-2 rounded-xl border bg-surface p-3 text-xs sm:grid-cols-2">
          <div><dt className="text-muted-foreground">环境</dt><dd className="mt-0.5 font-medium">{APP_RUNTIME.environment}</dd></div>
          <div><dt className="text-muted-foreground">版本</dt><dd className="mt-0.5 font-medium">{APP_RUNTIME.version}</dd></div>
          <div><dt className="text-muted-foreground">Commit</dt><dd className="mt-0.5 font-mono" title={APP_RUNTIME.commitSha}>{APP_RUNTIME.shortCommitSha}</dd></div>
          <div><dt className="text-muted-foreground">构建时间</dt><dd className="mt-0.5 font-medium">{APP_RUNTIME.buildTime}</dd></div>
        </dl>

        {issueText ? (
          <section className="rounded-xl border border-success/20 bg-success/5 p-3" aria-live="polite">
            <div className="flex items-center gap-2 text-xs font-medium text-success">
              <Check aria-hidden="true" className="size-4" />
              已生成 GitHub Issue 格式
              <button type="button" className="ml-auto inline-flex items-center gap-1 hover:underline" onClick={() => void copyGenerated()}>
                <Clipboard aria-hidden="true" className="size-3.5" />再次复制
              </button>
            </div>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-card p-3 text-[10px] leading-5 text-muted-foreground">{issueText}</pre>
          </section>
        ) : null}

        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <MessageSquareText aria-hidden="true" className="size-3.5" />
          最多保留最近 50 条反馈；Production 与 Staging 数据相互隔离。
        </p>
      </div>
    </Drawer>
  );
}
