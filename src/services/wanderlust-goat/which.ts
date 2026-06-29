import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Returns true if `name` resolves to an executable on PATH.
export async function which(name: string): Promise<boolean> {
  try {
    await execFileAsync("which", [name]);
    return true;
  } catch {
    return false;
  }
}
