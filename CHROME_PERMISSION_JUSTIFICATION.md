# Chrome Permission Justification

| Permission | Purpose | Why narrower alternatives are insufficient |
| --- | --- | --- |
| `storage` | Persist exact payload identity, `sync_batch_id:task.id` idempotency state, pause/recovery state, reviewed Selector Config and redacted local errors | MV3 service workers are ephemeral; memory alone would cause duplicate creation after restart |
| `tabs` | Find an already-open exact WeCom URL, open the configured board when absent, return progress to matching ProjectAI tabs, and recover a persisted queue after a Service Worker restart | Active-tab-only access cannot coordinate or recover one queue across the two exact, declaratively approved Origins |
| ProjectAI host permissions | Run the bridge only at `https://gridworks.cn/tool/projectai/*` and Staging equivalent | Required for the page-to-extension protocol; paths are narrow and `all_frames=false` |
| Exact WeCom host permission | Load the packaged typed Adapter only at `https://doc.weixin.qq.com/*` | No `<all_urls>` or arbitrary HTTPS wildcard is requested; runtime additionally requires the complete user-approved board URL and a reviewed local Selector |

The extension does not request `scripting`, cookies, history, webRequest, identity, downloads, clipboard, debugger, native messaging or broad host access. Both content scripts are packaged and declaratively restricted to their exact Origins; no code is downloaded or dynamically injected. File download of a user-requested redacted log uses an object URL and normal browser download behavior without the `downloads` permission.

The default Review ZIP has the exact WeCom Origin permission but contains no private board path/access parameter and no real Selector, so actual real-page sync is disabled. The local UAT builder enables actual sync only when an ignored, strictly validated private Selector exists.

`itemSaveButton` is the only save control in the Adapter contract. It must resolve inside `taskForm`; controls whose visible text or `aria-label` has final-submit semantics are rejected. A final-submit selector is not defined, and configs containing final-submit-like keys are rejected.
