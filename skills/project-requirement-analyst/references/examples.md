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
