import { execFile } from "child_process";
import { promisify } from "util";

// Thin module wrapping execFile so tests can mock this module cleanly
// rather than mocking the built-in child_process module directly.
export const execFileAsync = promisify(execFile);
