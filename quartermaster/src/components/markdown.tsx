/**
 * A small markdown renderer for agent replies: paragraphs, bold, italic, code,
 * bullet and numbered lists, headings and links. Everything becomes React text,
 * never HTML, so model output cannot inject markup or scripts.
 */
import type { ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((tok, i) => {
    const k = `${key}-${i}`;
    if (!tok) return null;
    if ((tok.startsWith("**") && tok.endsWith("**")) || (tok.startsWith("__") && tok.endsWith("__")))
      return <strong key={k}>{inline(tok.slice(2, -2), k)}</strong>;
    if (tok.startsWith("`") && tok.endsWith("`"))
      return (
        <code key={k} className="rounded bg-black/5 px-1 font-mono text-[0.9em]">
          {tok.slice(1, -1)}
        </code>
      );
    const link = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const href = /^(https?:\/\/|\/)/.test(link[2]) ? link[2] : undefined;
      return href ? (
        <a key={k} href={href} className="underline" target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer">
          {link[1]}
        </a>
      ) : (
        link[1]
      );
    }
    if ((tok.startsWith("*") && tok.endsWith("*")) || (tok.startsWith("_") && tok.endsWith("_")))
      return <em key={k}>{inline(tok.slice(1, -1), k)}</em>;
    return tok;
  });
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[]; start?: number };

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let cur = null as Block | null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  // A blank line inside a list doesn't end it ("loose" lists), so numbering continues across it.
  let blankAfterList = false;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    const listKind = bullet ? "ul" : numbered ? "ol" : null;
    if (!line.trim()) {
      if (cur?.kind === "ul" || cur?.kind === "ol") blankAfterList = true;
      else flush();
      continue;
    }
    if (blankAfterList && cur?.kind !== listKind) flush();
    blankAfterList = false;
    if (heading) {
      flush();
      blocks.push({ kind: "h", level: heading[1].length, text: heading[2] });
    } else if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = bullet ? bullet[1] : numbered![2];
      if (cur?.kind !== kind) {
        flush();
        cur = { kind, items: [], start: numbered ? Number(numbered[1]) : undefined };
      }
      (cur as { items: string[] }).items.push(item);
    } else if (cur && (cur.kind === "ul" || cur.kind === "ol") && /^\s+/.test(raw)) {
      cur.items[cur.items.length - 1] += " " + line.trim();
    } else {
      if (cur?.kind !== "p") {
        flush();
        cur = { kind: "p", lines: [] };
      }
      (cur as { lines: string[] }).lines.push(line);
    }
  }
  flush();
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parse(text).map((b, i) => {
        const k = `b${i}`;
        if (b.kind === "h")
          return (
            <p key={k} className={b.level <= 2 ? "text-lg font-semibold" : "font-semibold"}>
              {inline(b.text, k)}
            </p>
          );
        if (b.kind === "ul" || b.kind === "ol") {
          const List = b.kind;
          return (
            <List key={k} start={b.kind === "ol" && b.start !== 1 ? b.start : undefined} className={`space-y-1 pl-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"}`}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it, `${k}-${j}`)}</li>
              ))}
            </List>
          );
        }
        if (b.kind !== "p") return null;
        return (
          <p key={k}>
            {b.lines.flatMap((l, j) => (j ? [<br key={`br${j}`} />, ...inline(l, `${k}-${j}`)] : inline(l, `${k}-${j}`)))}
          </p>
        );
      })}
    </div>
  );
}
