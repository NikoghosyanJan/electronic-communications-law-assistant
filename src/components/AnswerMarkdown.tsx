"use client";

import ReactMarkdown from "react-markdown";

type Props = {
  text: string;
  className?: string;
};

/** Renders model answers that often include light Markdown (bold, lists). */
export function AnswerMarkdown({ text, className = "" }: Props) {
  return (
    <div className={`answer-md ${className}`.trim()}>
      <ReactMarkdown
        components={{
          p: ({ children }) => <p>{children}</p>,
          strong: ({ children }) => <strong>{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
          ul: ({ children }) => <ul>{children}</ul>,
          ol: ({ children }) => <ol>{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          h1: ({ children }) => <h4>{children}</h4>,
          h2: ({ children }) => <h4>{children}</h4>,
          h3: ({ children }) => <h4>{children}</h4>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          code: ({ children }) => <code>{children}</code>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
