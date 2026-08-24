"use client";

import { type FormEvent, useMemo, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import type { ViewerContext } from "@/lib/auth/ui-types";
import { withBasePath } from "@/lib/base-path";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { KnowledgeAnswerView, type KnowledgeAnswerPayload } from "./KnowledgeAnswerView";

export function CrossProjectKnowledgePanel({ viewer }: { viewer: ViewerContext }) {
  const initialIds = useMemo(
    () => viewer.projects.filter((item) => ["planning", "active"].includes(item.status)).map((item) => item.id),
    [viewer.projects],
  );
  const [selected, setSelected] = useState<string[]>(initialIds);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<KnowledgeAnswerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (selected.length === 0) {
      setError("请至少选择一个项目");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(withBasePath("/api/projects/knowledge/ask"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, projectIds: selected }),
      });
      const body = (await response.json()) as KnowledgeAnswerPayload & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "跨项目查询失败");
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "跨项目查询失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="space-y-4 p-5" data-testid="cross-project-knowledge">
      <div>
        <h2 className="text-base font-semibold">跨项目 AI</h2>
        <p className="mt-1 text-sm text-muted-foreground">只查询你已加入并明确选择的项目。</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {viewer.projects.map((project) => {
          const checked = selected.includes(project.id);
          return (
            <label key={project.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <Checkbox
                checked={checked}
                onCheckedChange={(value) => setSelected((current) =>
                  value ? [...new Set([...current, project.id])] : current.filter((id) => id !== project.id),
                )}
              />
              {project.name}
            </label>
          );
        })}
      </div>
      <form onSubmit={ask} className="space-y-3">
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.currentTarget.value)}
          placeholder="例如：综合这些项目，哪些变化最值得关注？"
          minLength={2}
          maxLength={2000}
          required
        />
        <Button type="submit" disabled={loading || selected.length === 0}>
          {loading ? <LoaderCircle className="animate-spin" /> : <Search />}
          {loading ? "正在查询" : "查询所选项目"}
        </Button>
      </form>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {result ? <KnowledgeAnswerView result={result} /> : null}
    </Card>
  );
}
