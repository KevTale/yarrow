import { Composition, Folder } from "remotion";
import { LAUNCH_FRAMES, Launch, SCENES } from "./Launch";
import { End } from "./scenes/End";
import { Intro } from "./scenes/Intro";
import { PullRequest } from "./scenes/PullRequest";
import { Sponsors } from "./scenes/Sponsors";
import { Work } from "./scenes/Work";
import "./theme";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Launch"
      component={Launch}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={LAUNCH_FRAMES}
    />
    <Folder name="Scenes">
      <Composition
        id="Intro"
        component={Intro}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={SCENES.intro}
      />
      <Composition
        id="Work"
        component={Work}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={SCENES.work}
      />
      <Composition
        id="PullRequest"
        component={PullRequest}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={SCENES.pullRequest}
      />
      <Composition
        id="Sponsors"
        component={Sponsors}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={SCENES.sponsors}
      />
      <Composition
        id="End"
        component={End}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={SCENES.end}
      />
    </Folder>
  </>
);
