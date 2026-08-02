"use client";

import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

type AssistantMarkdownProps = {
  children: string;
};

const renderers: ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => <h1 className="mt-6 text-xl font-semibold tracking-tight first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-5 text-lg font-semibold tracking-tight first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 text-base font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 text-sm font-semibold first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-7 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-6">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-primary/30 pl-3 text-muted-foreground">{children}</blockquote>,
  table: ({ children }) => <div className="my-3 overflow-x-auto rounded-lg border"><table className="w-full min-w-[480px] text-left text-xs">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-muted/60 text-foreground">{children}</thead>,
  th: ({ children }) => <th className="border-b px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-3 py-2 align-top last:border-b-0">{children}</td>,
  hr: () => <hr className="my-5 border-border" />,
  code: ({ className, children, ...props }) => {
    const block = typeof className === "string" && className.startsWith("language-");
    return block
      ? <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-6" {...props}>{children}</code>
      : <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.82em]" {...props}>{children}</code>;
  },
  pre: ({ children }) => <pre className="my-3 overflow-x-auto">{children}</pre>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">{children}</a>,
};

/** Safe, readable Markdown for assistant replies. HTML remains sanitized. */
export function AssistantMarkdown({ children }: AssistantMarkdownProps) {
  return (
    <div className="max-w-none break-words text-inherit">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={renderers}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
