# Requirement Classification Examples

These synthetic examples demonstrate classification only. They are not default
requirements.

## Sparse request

Source: “做一个会员活动页，下个月上线。”

- `[FACT]` A membership campaign page is requested.
- `[FACT]` The stated timing is “next month”; no exact date is supplied.
- `[GAP]` The campaign goal and success metric are absent.
- `[GAP]` Eligibility, activity rules, channel, identity, data fields, UAT, and
  an exact release date are absent.
- `[ASSUMPTION]` A review discussion may initially treat the deliverable as a
  responsive Web page, but this cannot become confirmed scope without an answer.
- `[P0]` What is the exact launch date and what campaign rules must the page
  enforce?

This sparse request still needs usable artifacts. A compliant Chinese draft may
abstract “会员活动” as a business concept while explicitly stating that member
eligibility and activity rules are undefined. A concrete candidate function is
allowed only as unresolved scope, for example:

| 序号 | 端 | 功能模块 | 功能说明 | 范围状态 | 依据 | 备注 |
|---|---|---|---|---|---|---|
| 1 | 待确认端 | 活动信息展示 | 展示活动主题和规则 | 待确认 | `[ASSUMPTION:A-01]` | 核心链路待确认，不作为已确认范围；材料未提供页面内容和活动规则，需业务方确认。 |

Do not add login, coupon issuance, payment, sharing, analytics, or an admin
console merely because campaign pages often have them. Add a candidate only
when it is necessary to make a stated core flow discussable, and link it to a
visible Gap and confirmation question.

## Conflict

Source A: “No login is needed.” Source B: “Members must view their reward
history.”

Do not choose one statement. Record both as Facts, create a Gap describing the
identity conflict, keep identity-dependent scope unresolved, and ask a P0/P1
question according to its impact on architecture and delivery.

## Explicit exclusion

Source: “Phase 1 is Chinese Web only; native apps and English are out of scope.”

Record Chinese Web, native-app exclusion, and English exclusion as Facts. They
may support `IN_SCOPE` and `OUT_OF_SCOPE` rows. Do not infer that every other
platform or locale is included.

## Information Architecture

If confirmed scope contains “Web member activity page” and “activity rules
display”, a minimal text hierarchy may be:

- 会员活动页（Web）
  - 活动信息
    - 活动规则

If the node is only a candidate, append “待确认” and reference its Assumption.
Do not generate an image or Mermaid diagram.
