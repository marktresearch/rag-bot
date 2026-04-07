import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  content: string;
};

export default function MarkdownContent({ content }: Props) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => (
            <a
              {...props}
              className="text-cyan-300 underline decoration-cyan-700 underline-offset-4 hover:text-cyan-200"
              target="_blank"
              rel="noreferrer"
            />
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(className);
            if (!isBlock) {
              return (
                <code
                  {...props}
                  className="rounded-xl bg-black/30 px-1.5 py-0.5 text-inherit"
                >
                  {children}
                </code>
              );
            }

            return (
              <code {...props} className={className}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-3xl border border-white/10 bg-black/25 p-4 text-[14px] text-slate-100">
              {children}
            </pre>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
