import { Composition } from "remotion";
import { DURATION, FPS, HEIGHT, LemonFilm, WIDTH } from "./LemonFilm";

export function Root() {
  return <Composition id="LemonFilm" component={LemonFilm} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />;
}
