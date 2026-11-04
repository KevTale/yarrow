import { Composition, Folder } from "remotion";
import { Hackathon } from "./hackathon/Hackathon";
import { TOTAL as HACKATHON_TOTAL } from "./hackathon/timeline";
import { Launch } from "./Launch";
import { Dashboard } from "./scenes/Dashboard";
import { End } from "./scenes/End";
import { Intro } from "./scenes/Intro";
import { PullRequest } from "./scenes/PullRequest";
import { Sponsors } from "./scenes/Sponsors";
import { Work } from "./scenes/Work";
import { FPS, SCENE, TOTAL } from "./timeline";
import "./theme";

const size = { width: 1920, height: 1080, fps: FPS };

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Launch"
      component={Launch}
      {...size}
      durationInFrames={TOTAL}
    />
    <Composition
      id="Hackathon"
      component={Hackathon}
      {...size}
      durationInFrames={HACKATHON_TOTAL}
    />
    <Folder name="Scenes">
      <Composition
        id="Intro"
        component={Intro}
        {...size}
        durationInFrames={SCENE.intro.duration}
      />
      <Composition
        id="Work"
        component={Work}
        {...size}
        durationInFrames={SCENE.work.duration}
      />
      <Composition
        id="Dashboard"
        component={Dashboard}
        {...size}
        durationInFrames={SCENE.dashboard.duration}
      />
      <Composition
        id="PullRequest"
        component={PullRequest}
        {...size}
        durationInFrames={SCENE.github.duration}
      />
      <Composition
        id="Sponsors"
        component={Sponsors}
        {...size}
        durationInFrames={SCENE.sponsors.duration}
      />
      <Composition
        id="End"
        component={End}
        {...size}
        durationInFrames={SCENE.end.duration}
      />
    </Folder>
  </>
);
