import { StringDecoder } from "node:string_decoder";
import { ProtocolError } from "./validation.js";

export class JsonlDecoder {
  readonly #decoder = new StringDecoder("utf8");
  #pending = "";
  readonly maxRecordBytes: number;
  constructor(maxRecordBytes = 256 * 1024) { this.maxRecordBytes = maxRecordBytes; }

  push(chunk: Uint8Array): unknown[] {
    this.#pending += this.#decoder.write(Buffer.from(chunk));
    const records: unknown[] = [];
    let newline: number;
    while ((newline = this.#pending.indexOf("\n")) >= 0) {
      let line = this.#pending.slice(0, newline);
      this.#pending = this.#pending.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (Buffer.byteLength(line) > this.maxRecordBytes) throw new ProtocolError("jsonl_record_too_large", undefined, "JSONL record exceeds limit");
      if (!line) throw new ProtocolError("invalid_jsonl", undefined, "Empty JSONL records are not permitted");
      let value: unknown;
      try { value = JSON.parse(line); }
      catch { throw new ProtocolError("invalid_jsonl", undefined, "JSONL record is invalid JSON"); }
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProtocolError("invalid_jsonl", undefined, "JSONL record must be an object");
      records.push(value);
    }
    if (Buffer.byteLength(this.#pending) > this.maxRecordBytes) throw new ProtocolError("jsonl_record_too_large", undefined, "Unterminated JSONL record exceeds limit");
    return records;
  }

  end(): unknown[] {
    this.#pending += this.#decoder.end();
    if (this.#pending.length) throw new ProtocolError("unterminated_jsonl", undefined, "Final JSONL record is not LF terminated");
    return [];
  }
}

export function encodeJsonl(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`;
}
