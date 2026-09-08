import "./index.css";
import { Composition, Folder } from "remotion";
import { ProductFilm, Treatment } from "./Composition";
import { MusicClosing } from "./scenes/MusicClosing";
import { PrivacyClosing } from "./scenes/PrivacyClosing";
import { FoodRefreshScene } from "./scenes/FoodRefreshScene";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Approval-sample">
        <Composition id="T1Arc-Treatment-Landscape" component={Treatment} width={3840} height={2160} fps={60} durationInFrames={720} />
        <Composition id="T1Arc-Treatment-Portrait" component={Treatment} width={2160} height={3840} fps={60} durationInFrames={720} />
      </Folder>
      <Folder name="Music-edition-ending">
        <Composition id="T1Arc-Music-Closing-Landscape" component={MusicClosing} width={3840} height={2160} fps={60} durationInFrames={600} />
        <Composition id="T1Arc-Music-Closing-Portrait" component={MusicClosing} width={2160} height={3840} fps={60} durationInFrames={600} />
      </Folder>
      <Folder name="Privacy-edition-ending">
        <Composition id="T1Arc-Privacy-Closing-Landscape" component={PrivacyClosing} width={3840} height={2160} fps={60} durationInFrames={600} />
        <Composition id="T1Arc-Privacy-Closing-Portrait" component={PrivacyClosing} width={2160} height={3840} fps={60} durationInFrames={600} />
      </Folder>
      <Folder name="Full-film">
        <Composition id="T1Arc-Film-Landscape" component={ProductFilm} width={3840} height={2160} fps={60} durationInFrames={5400} />
        <Composition id="T1Arc-Film-Portrait" component={ProductFilm} width={2160} height={3840} fps={60} durationInFrames={5400} />
      </Folder>
      <Folder name="Food-refresh-edition">
        <Composition id="T1Arc-Food-Refresh-Landscape" component={FoodRefreshScene} width={3840} height={2160} fps={60} durationInFrames={840} />
        <Composition id="T1Arc-Food-Refresh-Portrait" component={FoodRefreshScene} width={2160} height={3840} fps={60} durationInFrames={840} />
      </Folder>
    </>
  );
};
