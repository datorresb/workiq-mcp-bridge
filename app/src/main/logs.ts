import * as fs from "fs";
import * as path from "path";

/**
 * Appends log lines to a file with simple size-based rotation. The file path
 * is injected so this stays free of Electron and is unit-testable.
 */
export class RollingLog {
  private dirReady = false;
  private size = -1; // lazily initialized from the file on first append

  constructor(
    private readonly filePath: string,
    private readonly maxBytes = 5 * 1024 * 1024
  ) {}

  append(line: string): void {
    try {
      if (!this.dirReady) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        this.dirReady = true;
      }
      if (this.size < 0) {
        try {
          this.size = fs.statSync(this.filePath).size;
        } catch {
          this.size = 0;
        }
      }
      if (this.size >= this.maxBytes) {
        fs.renameSync(this.filePath, this.filePath + ".1");
        this.size = 0;
      }
      const data = line.endsWith("\n") ? line : line + "\n";
      fs.appendFileSync(this.filePath, data);
      this.size += Buffer.byteLength(data);
    } catch {
      // best-effort logging must never crash the app
    }
  }
}
