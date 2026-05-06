import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const cssDir = join(process.cwd(), "out", "_next", "static", "css");

if (!basePath) {
  process.exit(0);
}

for (const file of await readdir(cssDir)) {
  if (!file.endsWith(".css")) continue;
  const path = join(cssDir, file);
  const css = await readFile(path, "utf8");
  await writeFile(path, css.replaceAll("url(/assets/", `url(${basePath}/assets/`));
}
