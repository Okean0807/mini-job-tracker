export const CLOUD_FLAG_TRUE: "true";
export type CloudFlagClass = "on" | "off" | "ambiguous";
export function classifyCloudFlag(raw: unknown): CloudFlagClass;
export function parseCloudFlag(raw: unknown): boolean;
export function combineCloudFlags(clientRaw: unknown, serverRaw: unknown): boolean;
