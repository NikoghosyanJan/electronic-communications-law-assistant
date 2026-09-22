"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ArticleViewData = {
  articleNumber: number;
  articleTitle?: string;
  content: string;
};

type Props = {
  article: ArticleViewData | null;
  onClose: () => void;
};

export function ArticleViewer({ article, onClose }: Props) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!article) return;

    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) {
      document.body.style.paddingRight = `${scrollbar}px`;
    }

    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [article, onClose]);

  if (!article || !mounted) return null;

  return createPortal(
    <div
      className="article-viewer-root"
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        width: "100vw",
        height: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        boxSizing: "border-box",
      }}
    >
      <button
        type="button"
        aria-label="Close article"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          margin: 0,
          border: "none",
          padding: 0,
          cursor: "pointer",
          background: "rgba(18, 32, 47, 0.55)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="article-viewer-dialog"
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          width: "min(920px, calc(100vw - 2rem))",
          height: "min(88dvh, 860px)",
          maxHeight: "88dvh",
          overflow: "hidden",
          borderRadius: "18px",
          border: "1px solid var(--border)",
          background: "var(--panel)",
          boxShadow: "0 24px 64px rgb(18 32 47 / 28%)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
            flexShrink: 0,
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid var(--border)",
            background: "var(--panel)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: "0.75rem",
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--accent)",
              }}
            >
              Article
            </p>
            <h2
              id={titleId}
              className="font-display"
              style={{
                margin: "0.35rem 0 0",
                fontSize: "clamp(1.35rem, 2.5vw, 1.75rem)",
                fontWeight: 600,
                color: "var(--fg)",
                lineHeight: 1.25,
              }}
            >
              Հոդված {article.articleNumber}
              {article.articleTitle ? (
                <span
                  style={{
                    display: "block",
                    marginTop: "0.35rem",
                    fontSize: "1.05rem",
                    fontWeight: 400,
                    color: "var(--muted)",
                    lineHeight: 1.4,
                  }}
                >
                  {article.articleTitle}
                </span>
              ) : null}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-secondary"
            style={{ flexShrink: 0, padding: "0.65rem 1rem", fontSize: "0.9rem" }}
          >
            Close
          </button>
        </header>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "1.5rem",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: "1rem",
              lineHeight: 1.65,
              color: "var(--fg)",
            }}
          >
            {article.content}
          </pre>
        </div>
      </div>
    </div>,
    document.body,
  );
}
