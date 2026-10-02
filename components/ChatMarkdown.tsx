import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-teal-700 underline underline-offset-2 hover:text-teal-900"
    />
  ),
  p: ({ node: _node, ...props }) => (
    <p {...props} className="my-2 first:mt-0 last:mb-0" />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul {...props} className="my-2 list-disc space-y-1 pl-5" />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol {...props} className="my-2 list-decimal space-y-1 pl-5" />
  ),
  h1: ({ node: _node, ...props }) => (
    <h3 {...props} className="mt-3 mb-1 text-base font-semibold" />
  ),
  h2: ({ node: _node, ...props }) => (
    <h3 {...props} className="mt-3 mb-1 text-base font-semibold" />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 {...props} className="mt-3 mb-1 font-semibold" />
  ),
  strong: ({ node: _node, ...props }) => (
    <strong {...props} className="font-semibold text-slate-900" />
  ),
  code: ({ node: _node, ...props }) => (
    <code
      {...props}
      className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em]"
    />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      {...props}
      className="my-2 border-l-4 border-slate-200 pl-3 text-slate-600"
    />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table {...props} className="min-w-full border-collapse text-sm" />
    </div>
  ),
  thead: ({ node: _node, ...props }) => (
    <thead {...props} className="bg-slate-50" />
  ),
  th: ({ node: _node, ...props }) => (
    <th
      {...props}
      className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700"
    />
  ),
  td: ({ node: _node, ...props }) => (
    <td
      {...props}
      className="border-b border-slate-100 px-3 py-2 align-top text-slate-700"
    />
  ),
};

export default function ChatMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
