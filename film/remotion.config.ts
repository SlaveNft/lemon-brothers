// The film imports the page's own drawings (apps/web/src/town/critters.tsx) and the bank's own arithmetic
// (packages/sim). Both live outside this folder, so they are told where React and the simulation are.
import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.overrideWebpackConfig((c) => ({
  ...c,
  resolve: {
    ...c.resolve,
    alias: {
      ...(c.resolve?.alias ?? {}),
      react: path.resolve(process.cwd(), "node_modules/react"),
      "react-dom": path.resolve(process.cwd(), "node_modules/react-dom"),
      "@chair/sim": path.resolve(process.cwd(), "../packages/sim/src/index.ts"),
    },
  },
}));
