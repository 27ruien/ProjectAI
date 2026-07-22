# Chrome Permission Justification

| Permission | Purpose | Why narrower alternatives are insufficient |
| --- | --- | --- |
| `storage` | Persist exact payload identity, `sync_batch_id:task.id` idempotency state, pause/recovery state, reviewed Selector Config and redacted local errors | MV3 service workers are ephemeral; memory alone would cause duplicate creation after restart |
| `tabs` | Find an already-open exact WeCom Origin, open the configured board when absent, and return progress to matching ProjectAI tabs | The worker must coordinate one queue across pages and avoid opening duplicate board tabs |
| `scripting` | Inject the packaged, local `wecom-content.js` only after the user grants the exact optional WeCom Origin | The true WeCom Origin is not known at source-review time; no remotely hosted code is used |
| ProjectAI host permissions | Run the bridge only at `https://gridworks.cn/tool/projectai/*` and Staging equivalent | Required for the page-to-extension protocol; paths are narrow and `all_frames=false` |
| Exact optional WeCom host permission | Execute the typed Adapter at the single build-approved WeCom Origin after explicit user grant | No `<all_urls>` or arbitrary HTTPS wildcard is requested; a build without the real Origin cannot operate on WeCom |

The extension does not request cookies, history, webRequest, identity, downloads, clipboard, debugger, native messaging or broad host access. File download of a user-requested redacted log uses an object URL and normal browser download behavior without the `downloads` permission.

`itemSaveButton` is the only save control in the Adapter contract. It must resolve inside `taskForm`; controls whose visible text or `aria-label` has final-submit semantics are rejected. A final-submit selector is not defined, and configs containing final-submit-like keys are rejected.
