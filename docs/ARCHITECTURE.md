# Slim architecture

Project AI 只保留确定性的 Project、Membership、Knowledge、Skill Asset 与受控 AI 问答流程。没有 Agent Loop、Tool Calling、Workflow Runtime、Conversation Memory 或自研检索链路。Skill Execution Package 由外部 Agent 消费，Project AI 不执行 Skill。

```text
                    Browser
                       |
                       v
                  Project AI
              Auth / API / Guard
                       |
        +--------------+--------------+
        |                             |
        v                             v
   PostgreSQL                     RAGFlow
 User / Session                  Dataset
 Project                         Document
 ProjectMember                   Parse / Search
 Document mapping               Hybrid / Rerank
 Audit                               |
        |                             |
        +--------------+--------------+
                       v
                   AI Gateway
                       |
                       v
                      LLM
```

## Fixed flows

- Create project: commit Project + owner membership, provision deterministic RAGFlow Dataset, save mapping as `pending/ready/failed`, allow retry.
- Upload: authorize project role, upload directly to its backend-resolved Dataset, persist document mapping, start parse, poll status.
- Single query: authorize Project, retrieve only its Dataset, reject foreign Dataset/Document evidence, bound context, synthesize, validate citations once.
- Cross-project query: derive authorized Projects in backend, validate explicit selection, retrieve independently with bounded concurrency and per-project Top K, isolate failures, guard every result, globally bound context, synthesize.
- Weekly Report package: parse CSV/XLSX, match only within authorized Projects using deterministic name/alias/fuzzy scoring, load a provider-neutral structured Timeline first, fall back to a bounded Timeline document only when absent, calculate current/next plan windows and milestones, retrieve non-Timeline Knowledge, attach the current versioned Skill, and return JSON. This path never calls the AI Gateway.

RAGFlow is an infrastructure service, never an authorization authority. Its internal databases and object storage are not Project AI dependencies.
