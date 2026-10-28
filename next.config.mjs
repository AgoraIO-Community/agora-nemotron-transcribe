import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const config = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};
export default config;
