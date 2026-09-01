/**
 * Tiny dependency-free markdown renderer for drill cards.
 * Supports: ### h3, **bold**, > blockquote, ordered lists, paragraphs.
 */

import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(<strong key={`b${key++}`}>{match[1]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(md: string): ReactNode {
  const lines = md.split("\n");
  const blocks: ReactNode[] = [];
  let key = 0;
  let i = 0;

  while (i < lines.length) {
    const line = (lines[i] ?? "").trimEnd();
    if (line === "") {
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      blocks.push(<h3 key={key++}>{inline(line.slice(4))}</h3>);
      i++;
    } else if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
        quote.push((lines[i] ?? "").slice(2));
        i++;
      }
      blocks.push(
        <blockquote key={key++}>
          <p>{inline(quote.join(" "))}</p>
        </blockquote>,
      );
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\d+\.\s/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ol>,
      );
    } else {
      blocks.push(<p key={key++}>{inline(line)}</p>);
      i++;
    }
  }
  return <div className="md">{blocks}</div>;
}
