"use client";

import { AlertTriangle, Check, Circle, Loader2 } from "lucide-react";

export type WorkflowStepStatus = "pending" | "running" | "completed" | "failed";

export interface WorkflowStepItem {
  id: string;
  title: string;
  description?: string;
  status: WorkflowStepStatus;
}

interface WorkflowStepperProps {
  steps: WorkflowStepItem[];
  compact?: boolean;
}

const statusStyles: Record<WorkflowStepStatus, string> = {
  pending: "border-border bg-card text-muted-foreground",
  running: "border-primary bg-primary/10 text-primary shadow-sm shadow-primary/10",
  completed: "border-emerald-600 bg-emerald-600 text-white",
  failed: "border-destructive bg-destructive text-white",
};

function StepIcon({ status }: { status: WorkflowStepStatus }) {
  if (status === "completed") return <Check className="size-3.5" strokeWidth={2.5} />;
  if (status === "running") return <Loader2 className="size-3.5 animate-spin" />;
  if (status === "failed") return <AlertTriangle className="size-3.5" />;
  return <Circle className="size-2.5 fill-current opacity-35" />;
}

export function WorkflowStepper({ steps, compact = false }: WorkflowStepperProps) {
  return (
    <ol className={compact ? "space-y-1" : "space-y-0"} aria-label="工作流执行步骤">
      {steps.map((step, index) => (
        <li key={step.id} className="relative flex gap-3">
          {index < steps.length - 1 ? (
            <span
              aria-hidden="true"
              className={`absolute left-[15px] top-8 w-px ${compact ? "h-5" : "h-8"} ${
                step.status === "completed" ? "bg-emerald-500" : "bg-border"
              }`}
            />
          ) : null}
          <span
            className={`relative z-10 mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border ${statusStyles[step.status]}`}
          >
            <StepIcon status={step.status} />
          </span>
          <div className={compact ? "pb-2" : "pb-5"}>
            <div className="flex min-h-8 items-center gap-2">
              <p className={`text-sm font-medium ${step.status === "pending" ? "text-muted-foreground" : "text-foreground"}`}>
                {step.title}
              </p>
              {step.status === "running" ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">执行中</span>
              ) : null}
              {step.status === "failed" ? (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">需要重试</span>
              ) : null}
            </div>
            {!compact && step.description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{step.description}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

