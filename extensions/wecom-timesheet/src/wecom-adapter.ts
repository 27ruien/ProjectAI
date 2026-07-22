import type { SyncTask } from "./shared/protocol";
import type { SelectorConfig } from "./shared/selector-config";

export type AdapterResult = {
  status: "saved" | "validated" | "waiting_for_login" | "failed" | "unknown";
  code: string;
  message: string;
  externalReference: string | null;
  fieldResults: Record<string, "matched" | "filled">;
};

const TIMEOUT_MS = __WECOM_ADAPTER_TIMEOUT_MS__;

function visible(element: Element): boolean {
  const html = element as HTMLElement;
  const style = element.ownerDocument.defaultView?.getComputedStyle(html);
  if (!style) return false;
  return style.display !== "none" && style.visibility !== "hidden" && html.getClientRects().length > 0;
}

function isTextControl(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement {
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA";
}

function isSelectControl(element: Element): boolean {
  return element.tagName === "SELECT";
}

function assertSafeItemSaveControl(root: Document, config: SelectorConfig, element: Element): void {
  const form = root.querySelector(config.taskForm);
  if (!form || !form.contains(element)) throw new Error("ITEM_SAVE_OUTSIDE_TASK_FORM");
  const label = `${element.textContent ?? ""} ${(element as HTMLElement).getAttribute("aria-label") ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
  if (/最终提交|提交日报|全部提交|final\s*submit|submit\s*(?:all|daily|timesheet)/iu.test(label)) {
    throw new Error("FINAL_SUBMIT_CONTROL_FORBIDDEN");
  }
}

function waitForElement<T extends Element>(
  root: ParentNode,
  selector: string,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const current = root.querySelector<T>(selector);
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const match = root.querySelector<T>(selector);
      if (!match) return;
      observer.disconnect();
      clearTimeout(timeout);
      resolve(match);
    });
    observer.observe(root instanceof Document ? root.documentElement : (root as Node), {
      childList: true,
      subtree: true,
      attributes: true,
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`ELEMENT_TIMEOUT:${selector.slice(0, 120)}`));
    }, timeoutMs);
  });
}

async function formRoot(documentRoot: Document, config: SelectorConfig): Promise<Document> {
  const iframe = await waitForElement<HTMLIFrameElement>(documentRoot, config.formIframe);
  if (!iframe.contentDocument) throw new Error("IFRAME_UNAVAILABLE");
  await waitForElement(iframe.contentDocument, config.taskForm);
  return iframe.contentDocument;
}

function setInput(element: Element, value: string): void {
  // Elements inside the task iframe belong to a different Window realm, so
  // parent-realm instanceof checks reject valid controls.
  if (!isTextControl(element)) {
    throw new Error("FIELD_NOT_INPUT");
  }
  element.focus();
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  if (element.value !== value) throw new Error("FIELD_VALUE_MISMATCH");
}

async function selectExact(input: {
  root: Document;
  controlSelector: string;
  optionsSelector: string;
  selectedSelector: string;
  expected: string;
}): Promise<void> {
  const control = await waitForElement<Element>(input.root, input.controlSelector);
  if (isSelectControl(control)) {
    const select = control as unknown as HTMLSelectElement;
    const matches = [...select.options].filter(
      (option) => option.textContent?.trim() === input.expected,
    );
    if (matches.length === 0) throw new Error("OPTION_NOT_FOUND");
    if (matches.length > 1) throw new Error("OPTION_AMBIGUOUS");
    select.value = matches[0].value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    if (select.selectedOptions[0]?.textContent?.trim() !== input.expected) {
      throw new Error("OPTION_VERIFICATION_FAILED");
    }
    return;
  }
  (control as HTMLElement).click();
  const options = [...input.root.querySelectorAll(input.optionsSelector)].filter(visible);
  const matches = options.filter((option) => option.textContent?.trim() === input.expected);
  if (matches.length === 0) throw new Error("OPTION_NOT_FOUND");
  if (matches.length > 1) throw new Error("OPTION_AMBIGUOUS");
  (matches[0] as HTMLElement).click();
  const selected = await waitForElement(input.root, input.selectedSelector);
  if (selected.textContent?.trim() !== input.expected) {
    throw new Error("OPTION_VERIFICATION_FAILED");
  }
}

function waitForSaveResult(
  root: Document,
  config: SelectorConfig,
  previousSuccessCount: number,
): Promise<{ kind: "success" | "failure"; text: string }> {
  return new Promise((resolve, reject) => {
    const inspect = () => {
      const failure = [...root.querySelectorAll(config.saveFailure)].find(visible);
      if (failure) return { kind: "failure" as const, text: failure.textContent?.trim() ?? "" };
      const successes = [...root.querySelectorAll(config.saveSuccess)].filter(visible);
      if (successes.length > previousSuccessCount) {
        const newest = successes[successes.length - 1];
        return { kind: "success" as const, text: newest.textContent?.trim() ?? "" };
      }
      return null;
    };
    const current = inspect();
    if (current) {
      resolve(current);
      return;
    }
    const observer = new MutationObserver(() => {
      const result = inspect();
      if (!result) return;
      observer.disconnect();
      clearTimeout(timeout);
      resolve(result);
    });
    observer.observe(root.documentElement, { childList: true, subtree: true, attributes: true });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error("SAVE_RESULT_UNKNOWN"));
    }, TIMEOUT_MS);
  });
}

function controlledFailure(error: unknown): AdapterResult {
  const raw = error instanceof Error ? error.message : "ADAPTER_FAILED";
  const code = raw.split(":", 1)[0].replace(/[^A-Z0-9_]/gi, "_").slice(0, 80);
  return {
    status: code === "SAVE_RESULT_UNKNOWN" ? "unknown" : "failed",
    code,
    message:
      code === "SAVE_RESULT_UNKNOWN"
        ? "无法确认任务是否保存，批次已暂停"
        : "页面字段无法被可靠定位或验证",
    externalReference: null,
    fieldResults: {},
  };
}

export async function executeTaskWithAdapter(input: {
  documentRoot: Document;
  task: SyncTask;
  dryRun: boolean;
  selectors: SelectorConfig;
}): Promise<AdapterResult> {
  const fieldResults: Record<string, "matched" | "filled"> = {};
  try {
    const loggedOut = input.documentRoot.querySelector(input.selectors.loggedOutIndicator);
    if (loggedOut && visible(loggedOut)) {
      return {
        status: "waiting_for_login",
        code: "LOGIN_REQUIRED",
        message: "请手动登录企业微信后继续",
        externalReference: null,
        fieldResults,
      };
    }
    await waitForElement(input.documentRoot, input.selectors.boardReady);
    const overlay = input.documentRoot.querySelector(input.selectors.overlay);
    if (overlay && visible(overlay)) throw new Error("PAGE_OVERLAY_BLOCKING");
    const create = await waitForElement<HTMLElement>(
      input.documentRoot,
      input.selectors.createTaskButton,
    );
    create.click();
    const root = await formRoot(input.documentRoot, input.selectors);
    setInput(await waitForElement(root, input.selectors.descriptionInput), input.task.description);
    fieldResults.description = "filled";
    await selectExact({
      root,
      controlSelector: input.selectors.projectControl,
      optionsSelector: input.selectors.projectOptions,
      selectedSelector: input.selectors.projectSelectedValue,
      expected: input.task.project.name,
    });
    fieldResults.project = "matched";
    setInput(await waitForElement(root, input.selectors.hoursInput), String(input.task.hours));
    fieldResults.hours = "filled";
    await selectExact({
      root,
      controlSelector: input.selectors.categoryControl,
      optionsSelector: input.selectors.categoryOptions,
      selectedSelector: input.selectors.categorySelectedValue,
      expected: input.task.category.name,
    });
    fieldResults.category = "matched";
    await selectExact({
      root,
      controlSelector: input.selectors.statusControl,
      optionsSelector: input.selectors.statusOptions,
      selectedSelector: input.selectors.statusSelectedValue,
      expected: input.task.status.name,
    });
    fieldResults.status = "matched";
    if (input.dryRun) {
      return {
        status: "validated",
        code: "DRY_RUN_VALIDATED",
        message: "字段定位与精确匹配成功；未点击单条保存",
        externalReference: null,
        fieldResults,
      };
    }
    const previousSuccessCount = root.querySelectorAll(input.selectors.saveSuccess).length;
    const save = await waitForElement<HTMLElement>(root, input.selectors.itemSaveButton);
    assertSafeItemSaveControl(root, input.selectors, save);
    save.click();
    const result = await waitForSaveResult(root, input.selectors, previousSuccessCount);
    if (result.kind === "failure") throw new Error("ITEM_SAVE_FAILED");
    return {
      status: "saved",
      code: "ITEM_SAVED",
      message: "单条任务已保存并通过页面反馈确认",
      externalReference: result.text.slice(0, 200) || null,
      fieldResults,
    };
  } catch (error) {
    return { ...controlledFailure(error), fieldResults };
  }
}
