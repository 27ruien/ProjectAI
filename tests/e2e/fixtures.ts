import { expect, test as base, type ConsoleMessage, type Request, type TestInfo } from "@playwright/test";
import { loginByApi, type TestActor } from "./support/auth";

type RuntimeIssue = {
  kind: "console.error" | "pageerror" | "requestfailed" | "http500";
  message: string;
  url?: string;
};

type RuntimeLog = {
  type: string;
  text: string;
  url?: string;
};

type ConsoleErrorAllowance = {
  message: string;
  pathname: string;
};

type RuntimeMonitor = {
  allowConsoleErrorOnce: (allowance: ConsoleErrorAllowance) => void;
  allowHttpStatusOnce: (allowance: {
    status: number;
    pathname: string;
  }) => void;
};

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, {
    body: Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
    contentType: "application/json",
  });
}

function consoleLocation(message: ConsoleMessage) {
  const location = message.location();
  return location.url || undefined;
}

function isSupersededVinextRscRequest(request: Request) {
  const failure = request.failure()?.errorText;
  const pathname = new URL(request.url()).pathname;
  // vinext/Next client navigation can cancel a redundant RSC fetch after the
  // destination URL and DOM have already committed. Keep this exception narrow:
  // first-party fetch, .rsc endpoint, and Chromium's explicit abort signal only.
  return failure === "net::ERR_ABORTED" && request.resourceType() === "fetch" && pathname.endsWith(".rsc");
}

function matchesConsoleErrorAllowance(
  allowance: ConsoleErrorAllowance,
  entry: RuntimeLog,
  pageUrl: string,
) {
  if (entry.text !== allowance.message || !entry.url) return false;
  try {
    const source = new URL(entry.url);
    const current = new URL(pageUrl);
    return source.origin === current.origin && source.pathname === allowance.pathname;
  } catch {
    return false;
  }
}

type ProjectAIFixtures = {
  authenticatedAs: TestActor | null;
  authentication: void;
  runtimeMonitor: RuntimeMonitor;
};

export const test = base.extend<ProjectAIFixtures>({
  authenticatedAs: ["managerA", { option: true }],
  authentication: [
    async ({ authenticatedAs, page }, use) => {
      if (authenticatedAs) await loginByApi(page, authenticatedAs);
      await use();
    },
    { auto: true },
  ],
  runtimeMonitor: [
    async ({ page }, use, testInfo) => {
      const issues: RuntimeIssue[] = [];
      const consoleLogs: RuntimeLog[] = [];
      const networkFailures: RuntimeIssue[] = [];
      const consoleErrorAllowances: ConsoleErrorAllowance[] = [];
      const httpStatusAllowances: Array<{
        status: number;
        pathname: string;
      }> = [];

      const runtimeMonitor: RuntimeMonitor = {
        allowConsoleErrorOnce: (allowance) => {
          consoleErrorAllowances.push(allowance);
        },
        allowHttpStatusOnce: (allowance) => {
          httpStatusAllowances.push(allowance);
        },
      };

      page.on("console", (message) => {
        const entry = { type: message.type(), text: message.text(), url: consoleLocation(message) };
        consoleLogs.push(entry);
        if (message.type() === "error") {
          const allowanceIndex = consoleErrorAllowances.findIndex((allowance) =>
            matchesConsoleErrorAllowance(allowance, entry, page.url()),
          );
          if (allowanceIndex >= 0) {
            consoleErrorAllowances.splice(allowanceIndex, 1);
            return;
          }
          issues.push({ kind: "console.error", message: message.text(), url: entry.url });
        }
      });

      page.on("pageerror", (error) => {
        issues.push({ kind: "pageerror", message: error.stack ?? error.message });
      });

      page.on("requestfailed", (request) => {
        if (isSupersededVinextRscRequest(request)) return;
        const issue: RuntimeIssue = {
          kind: "requestfailed",
          message: request.failure()?.errorText ?? "Request failed without an error message",
          url: request.url(),
        };
        issues.push(issue);
        networkFailures.push(issue);
      });

      page.on("response", (response) => {
        if (response.status() < 500) return;
        const pathname = new URL(response.url()).pathname;
        const allowanceIndex = httpStatusAllowances.findIndex(
          (allowance) =>
            allowance.status === response.status() &&
            allowance.pathname === pathname,
        );
        if (allowanceIndex >= 0) {
          httpStatusAllowances.splice(allowanceIndex, 1);
          return;
        }
        const issue: RuntimeIssue = {
          kind: "http500",
          message: `HTTP ${response.status()} ${response.statusText()}`,
          url: response.url(),
        };
        issues.push(issue);
        networkFailures.push(issue);
      });

      await use(runtimeMonitor);

      const failed = testInfo.status !== testInfo.expectedStatus;
      if (failed || issues.length > 0) {
        await attachJson(testInfo, "runtime-issues.json", issues);
        await attachJson(testInfo, "console-log.json", consoleLogs);
        await attachJson(testInfo, "network-failures.json", networkFailures);
      }

      expect(issues, "页面运行期间不应出现 console.error、pageerror、失败请求或 HTTP 500").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
