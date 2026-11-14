/** The picture above the game and the town: the drawn bank (Town2D). */
import type { WorldView } from "@chair/sim";
import { Town2D } from "./Town2D";

export function Scene({ s, idle }: { s: WorldView; idle?: string }) {
  return <Town2D s={s} idle={idle} />;
}
