export interface FsLike {
  existsSync: (p: string) => boolean;
  readdirSync: (p: string) => string[];
  readFileSync: (p: string, enc: "utf8") => string;
}
export function parseEnvText(text: string): Record<string, string>;
export function loadEnvFileViewsSync(root: string, fs?: FsLike): Record<string, string>[];
export function loadEnvFilesSync(root: string, fs?: FsLike): Record<string, string>;
