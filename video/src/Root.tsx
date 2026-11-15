import React from "react";
import { Composition } from "remotion";
import { Film } from "./Film";
import T from "./timeline.json";

export const Root = () => <Composition id="SpakDemo" component={Film} durationInFrames={T.duration * T.fps} fps={T.fps} width={1920} height={1080} />;
