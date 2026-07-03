type ContentBlock =
  | { type: "text"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };

function parseRow(line: string): string[] {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter((_, index, cells) => index > 0 && index < cells.length - 1);
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s\-:|]+\|?$/.test(line.trim());
}

function parseContent(content: string): ContentBlock[] {
  const lines = content.split("\n");
  const blocks: ContentBlock[] = [];
  const textBuffer: string[] = [];
  let index = 0;

  const flushText = () => {
    const text = textBuffer.join("\n").trim();
    if (text) {
      blocks.push({ type: "text", text });
    }
    textBuffer.length = 0;
  };

  while (index < lines.length) {
    const line = lines[index];
    const nextLine = lines[index + 1];

    if (
      line.trim().startsWith("|") &&
      nextLine &&
      isTableSeparator(nextLine)
    ) {
      flushText();
      const headers = parseRow(line);
      index += 2;

      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(parseRow(lines[index]));
        index += 1;
      }

      blocks.push({ type: "table", headers, rows });
      continue;
    }

    textBuffer.push(line);
    index += 1;
  }

  flushText();
  return blocks;
}

function TableBlock({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="my-2 overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full min-w-[280px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--bg)]">
            {headers.map((header) => (
              <th
                key={header}
                className="px-3 py-2 font-medium whitespace-nowrap text-[var(--text-h)]"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b border-[var(--border)] last:border-b-0"
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={`${rowIndex}-${cellIndex}`}
                  className="px-3 py-2 whitespace-nowrap text-[var(--text)]"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface MessageContentProps {
  content: string;
}

export function MessageContent({ content }: MessageContentProps) {
  const blocks = parseContent(content);
  const hasTable = blocks.some((block) => block.type === "table");

  if (!hasTable) {
    return <>{content}</>;
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.type === "text") {
          return (
            <p key={index} className="m-0">
              {block.text}
            </p>
          );
        }
        return (
          <TableBlock
            key={index}
            headers={block.headers}
            rows={block.rows}
          />
        );
      })}
    </div>
  );
}
