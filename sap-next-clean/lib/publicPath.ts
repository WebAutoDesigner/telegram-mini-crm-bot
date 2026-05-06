const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function publicPath(path?: string) {
  if (!path || !path.startsWith("/")) return path || "";
  return `${basePath}${path}`;
}
