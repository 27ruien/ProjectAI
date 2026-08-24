# Execution package and output contract

Read this reference when validating a Project AI package or adapting it to an
Agent that needs an explicit schema.

## Package

~~~json
{
  "schemaVersion": "projectai-weekly-report-context-v1",
  "executionId": "weekly-report-uuid",
  "generatedAt": "ISO-8601 timestamp",
  "currentDate": "YYYY-MM-DD",
  "reportingPeriod": {
    "weekStart": "YYYY-MM-DD",
    "weekEnd": "YYYY-MM-DD"
  },
  "skill": {
    "id": "project-weekly-report",
    "version": "1.2.0",
    "sha256": "hex digest",
    "content": "complete SKILL.md",
    "files": {
      "SKILL.md": "complete SKILL.md",
      "agents/openai.yaml": "agent presentation metadata",
      "references/schema.md": "this contract",
      "references/examples.md": "worked examples"
    }
  },
  "source": {
    "filename": "daily-report.xlsx",
    "parsedFactCount": 4,
    "skippedOutsideWeek": 0,
    "warnings": []
  },
  "projects": [
    {
      "project": {
        "id": "project id",
        "name": "official name",
        "clientName": "client name",
        "status": "raw status",
        "stage": "raw stage",
        "statusLabel": "display status",
        "health": "raw health",
        "targetLaunchDate": "YYYY-MM-DD or null"
      },
      "dailyReport": {
        "facts": [
          {
            "sourceRow": 2,
            "sourceSheet": "日报",
            "projectName": "source label",
            "task": "actual fact text",
            "status": "optional or null",
            "progress": "optional or null",
            "date": "YYYY-MM-DD or null",
            "owner": "optional or null"
          }
        ]
      },
      "timeline": {
        "projectId": "project id",
        "source": "structured | document_fallback | none",
        "currentPhase": "Design or null",
        "phases": [
          {
            "name": "Design",
            "startsOn": "2026-08-17",
            "endsOn": "2026-08-28",
            "taskCount": 2
          }
        ],
        "tasks": [
          {
            "id": "optional task id",
            "stage": "Design",
            "name": "UI Design",
            "owners": ["Kivisense"],
            "startDate": "2026-08-17",
            "endDate": "2026-08-26",
            "status": "in_progress"
          }
        ],
        "plannedThisWeek": [],
        "plannedNextWeek": [],
        "currentMilestones": [],
        "futureMilestones": [
          {
            "name": "UAT",
            "date": "2026-09-14",
            "stage": "UAT",
            "status": "incomplete",
            "basis": "name_rule"
          }
        ],
        "milestones": [
          {
            "name": "UAT",
            "date": "2026-09-14",
            "stage": "UAT",
            "status": "incomplete",
            "basis": "name_rule"
          }
        ],
        "documentEvidence": []
      },
      "knowledge": {
        "evidence": [
          {
            "id": "K1",
            "kind": "knowledge",
            "documentId": "authorized document id",
            "documentName": "business document name",
            "excerpt": "bounded evidence",
            "similarity": 0.85
          }
        ]
      },
      "dailyReportFacts": [],
      "timelineEvidence": [],
      "knowledgeEvidence": [],
      "contextAvailability": "available | partial | unavailable",
      "contextWarnings": []
    }
  ],
  "matches": [
    {
      "sourceProjectName": "label",
      "status": "matched | needs_confirmation | unmatched",
      "method": "official_exact | alias_exact | override | fuzzy | none",
      "projectId": "project id or null",
      "projectName": "official name or null",
      "candidates": [
        {
          "projectId": "project id",
          "projectName": "official name",
          "score": 92,
          "nameScore": 52,
          "reasons": ["名称相似度 87%", "当前用户具备项目访问关系"]
        }
      ]
    }
  ],
  "unmatchedItems": [
    {
      "sourceRow": 7,
      "sourceSheet": "日报",
      "projectName": "临时售前咨询",
      "task": "沟通初步需求",
      "date": "YYYY-MM-DD or null",
      "status": null,
      "progress": null,
      "owner": null
    }
  ],
  "output": {
    "filename": "weekly-report-YYYY-MM-DD.md",
    "format": "markdown"
  }
}
~~~

## Input invariants

`dailyReportFacts`, `timelineEvidence`, and `knowledgeEvidence` are retained as
backward-compatible aliases. New consumers should use `dailyReport`,
`timeline`, and `knowledge`.

- Every `projects[].project.id` was resolved from the current user's
  server-authorized Project set.
- Project Timeline and evidence were loaded only after Project authorization.
- `unmatchedItems` have no Project context.
- `dailyReport.facts` are ACTUAL evidence; `timeline.plannedThisWeek` and
  `timeline.plannedNextWeek` are PLAN evidence.
- Planned tasks never prove completion.
- Dates in daily facts may be absent; do not derive a milestone from them.
- Use `timeline.milestones` first for milestone dates. If it is empty and
  `timeline.documentEvidence` contains an explicit named/date milestone, that
  bounded Timeline Context evidence may be used. Copy every date exactly.
- Knowledge text can support explicit next steps but cannot override Timeline
  dates or Project facts.
- `timeline.source` is an internal boundary and should not be displayed in the
  final report.
- `needs_confirmation` and `unmatched` entries are never silently attached to a
  Project.

## Output

The file must be UTF-8 Markdown with one heading and one six-column table:

~~~md
# 项目周报｜YYYY.MM.DD - YYYY.MM.DD

| 项目 / 事项 | 本周进展 | 下周安排 | 里程碑 | 需要支持 | 好 / 不好 |
|---|---|---|---|---|---|
~~~

Use `<br>` inside cells. Never emit a second row for the same Project ID.
