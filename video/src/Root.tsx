import { Composition, Folder } from "remotion";
import { Hackathon } from "./hackathon/Hackathon";
import { Film, FILM_FRAMES } from "./hackathon/Film";
import { Intro as HackathonIntro, INTRO_FRAMES } from "./hackathon/Intro";
import { Middle, MIDDLE_FRAMES } from "./hackathon/Middle";
import { Outro, OUTRO_FRAMES } from "./hackathon/Outro";
import { TOTAL as HACKATHON_TOTAL } from "./hackathon/timeline";
import { FILM_VOICE_FRAMES, FilmVoice } from "./hackathon/voice/FilmVoice";
import { MIDDLE_VOICE_FRAMES, MiddleVoice } from "./hackathon/voice/MiddleVoice";
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
    <Composition
      id="HackathonFilm"
      component={Film}
      {...size}
      durationInFrames={FILM_FRAMES}
    />
    <Composition
      id="HackathonMiddle"
      component={Middle}
      {...size}
      durationInFrames={MIDDLE_FRAMES}
    />
    <Composition
      id="HackathonOutro"
      component={Outro}
      {...size}
      durationInFrames={OUTRO_FRAMES}
    />
    <Composition
      id="HackathonIntro"
      component={HackathonIntro}
      {...size}
      durationInFrames={INTRO_FRAMES}
    />
    <Composition
      id="HackathonFilmVoice"
      component={FilmVoice}
      {...size}
      durationInFrames={FILM_VOICE_FRAMES}
    />
    <Composition
      id="HackathonMiddleVoice"
      component={MiddleVoice}
      {...size}
      durationInFrames={MIDDLE_VOICE_FRAMES}
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
