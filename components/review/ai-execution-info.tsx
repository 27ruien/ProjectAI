"use client";

import { Activity, CheckCircle2, Clock3, Coins, Cpu, RotateCcw, Sparkles, Timer, Wrench } from "lucide-react";

export interface ExecutionInfoRecord {
  id: string;
  executionId?: string;
  skillId?: string;
  modelProfileId?: string;
  modelId?: string;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  retryCount?: number;
  cost?: number;
  currency?: string;
  logs?: string[];
  error?: string;
}

interface AIExecutionInfoProps {
  execution?: ExecutionInfoRecord;
  skillName?: string;
  modelProfile?: string;
  confidence?: number;
}

export function AIExecutionInfo({ execution, skillName, modelProfile, confidence }: AIExecutionInfoProps) {
  const duration = execution?.durationMs ? `${(execution.durationMs / 1000).toFixed(1)} 秒` : "18.4 秒";
  const cost = execution?.cost ?? 0.0412;
  const profile = modelProfile ?? execution?.modelProfileId ?? "requirement-analysis";
  const skill = skillName ?? execution?.skillId ?? "requirement-extraction";

  return (
    <section className="border-t border-border">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground"><Activity className="size-3.5 text-primary" /> AI 执行信息</h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium text-emerald-700"><CheckCircle2 className="size-2.5" /> 已完成</span>
      </div>
      <dl className="grid grid-cols-2 gap-px border-y border-border bg-border">
        <InfoCell icon={Wrench} label="Skill" value={skill} />
        <InfoCell icon={Cpu} label="Model Profile" value={profile} />
        <InfoCell icon={Timer} label="处理耗时" value={duration} />
        <InfoCell icon={Coins} label="Mock 成本" value={`${execution?.currency === "CNY" ? "¥" : "$"}${cost.toFixed(4)}`} />
        <InfoCell icon={Sparkles} label="置信度" value={`${Math.round((confidence ?? 0.92) * ((confidence ?? 0.92) <= 1 ? 100 : 1))}%`} />
        <InfoCell icon={RotateCcw} label="重试次数" value={String(execution?.retryCount ?? 0)} />
      </dl>
      <div className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground"><span>执行日志</span><span>{execution?.executionId ?? execution?.id ?? "EXEC-240712"}</span></div>
        <div className="space-y-2 rounded-lg bg-muted/45 p-3">
          {(execution?.logs?.length ? execution.logs : ["检索项目有效知识：12 个片段", "结构化输出校验通过", "来源引用有效性检查完成"]).slice(0, 4).map((log, index) => (
            <div key={`${log}-${index}`} className="flex gap-2 text-[10px] leading-4 text-muted-foreground">
              <Clock3 className="mt-0.5 size-2.5 shrink-0" />
              <span>{typeof log === "string" ? log : JSON.stringify(log)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InfoCell({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return (
    <div className="min-w-0 bg-card px-3 py-2.5">
      <dt className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-muted-foreground"><Icon className="size-2.5" /> {label}</dt>
      <dd className="mt-1 truncate text-[11px] font-medium text-foreground" title={value}>{value}</dd>
    </div>
  );
}

