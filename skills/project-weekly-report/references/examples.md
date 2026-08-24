# Weekly Report examples

## Continuous work becomes one outcome

Daily facts:

- GP 需求梳理
- GP 继续梳理需求
- GP 客户沟通，确认需求
- GP 更新需求方案
- GP 输出线框和排期

Preferred progress:

~~~text
- 完成核心需求梳理及客户澄清，并基于确认内容更新需求方案、线框及项目排期。
~~~

Do not list each day separately.

## Planned work is not completed work

Timeline Context:

~~~json
{
  "plannedThisWeek": [
    {
      "name": "UI Design",
      "startDate": "2026-08-17",
      "endDate": "2026-08-21"
    }
  ]
}
~~~

Daily Report facts contain only “完成需求确认”. The progress cell may say
“完成需求确认”, but must not say “完成 UI Design”. UI Design is still plan
context unless an actual fact confirms completion.

## Complete Markdown

~~~md
# 项目周报｜2026.08.17 - 2026.08.21

| 项目 / 事项 | 本周进展 | 下周安排 | 里程碑 | 需要支持 | 好 / 不好 |
|---|---|---|---|---|---|
| **Sowind [ GP & UN ] CRM**<br><br>**项目状态：方案** | - 完成核心需求梳理及客户澄清，并基于确认内容更新需求方案、线框及项目排期。 | - 根据已确认方案推进 UI 设计。<br>- 对齐开发需求并按排期启动开发准备。 | - 方案确认，8/25<br>- 设计稿确认，9/1<br>- UAT，9/14 | / | 好：需求、方案及排期本周完成对齐，项目已进入执行准备阶段。 |
| **临时售前咨询**<br><br>**项目状态：待确认** | - 完成客户初步需求沟通并整理待确认事项。 | - 继续跟进客户对范围的反馈。 | / | / | / |
~~~
