// One place that writes to stdout, so production paths carry no stray
// console.log and Railway gets parseable lines.

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function emit(level: Level, message: string, fields: Fields = {}): void {
  const line = JSON.stringify({
    level,
    message,
    at: new Date().toISOString(),
    ...fields,
  });
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export const log = {
  info: (message: string, fields?: Fields) => emit("info", message, fields),
  warn: (message: string, fields?: Fields) => emit("warn", message, fields),
  error: (message: string, fields?: Fields) => emit("error", message, fields),
};
