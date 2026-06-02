import React from 'react';
import {registerRoot, Composition} from 'remotion';
import {Video1RememberWhen} from './videos/Video1RememberWhen';
import {Video2SayItDifferent} from './videos/Video2SayItDifferent';
import {Video3ThatSummer} from './videos/Video3ThatSummer';
import {IntroVideo} from './videos/IntroVideo';
import {Video1RememberWhenV2} from './videos/Video1RememberWhenV2';
import {Video2SayItDifferentV2} from './videos/Video2SayItDifferentV2';
import {Video3ThatSummerV2} from './videos/Video3ThatSummerV2';
import {Video1RememberWhenV3} from './videos/Video1RememberWhenV3';
import {Video2SayItDifferentV3} from './videos/Video2SayItDifferentV3';
import {Video3ThatSummerV3} from './videos/Video3ThatSummerV3';
import {AdCounselingYoung} from './videos/AdCounselingYoung';
import {AdCounselingEstablished} from './videos/AdCounselingEstablished';
import {AdDriveHome} from './videos/AdDriveHome';
import {AdDriveHomeV2} from './videos/AdDriveHomeV2';
import {AdDriveHomeV3} from './videos/AdDriveHomeV3';
import {AdDriveHomeV4} from './videos/AdDriveHomeV4';
import {AdDriveHomeV5} from './videos/AdDriveHomeV5';
import {ProductDemo} from './videos/ProductDemo';
import {ProductDemoProof} from './videos/ProductDemoProof';
import {CompleteWalkthrough} from './videos/CompleteWalkthrough';
import {CompleteWalkthroughSlideshow} from './videos/CompleteWalkthroughSlideshow';
import {AdFathersDayProduct} from './videos/AdFathersDayProduct';
import {dimensions, FPS} from './tokens';

const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* ═══ INTRO: App Introduction Video ═══ */}
      <Composition
        id="Intro-Video"
        component={IntroVideo}
        durationInFrames={40 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />
      <Composition
        id="Intro-Video-Landscape"
        component={IntroVideo}
        durationInFrames={40 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />

      {/* Father's Day 2026 — motion version of winning static ad FD_v2_A_Product (Reels 9:16) */}
      <Composition
        id="Ad-FathersDay-Product-Vertical"
        component={AdFathersDayProduct}
        durationInFrames={13 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      {/* Product demo: app-store/social explainer */}
      <Composition
        id="Product-Demo-Vertical"
        component={ProductDemo}
        durationInFrames={32 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />
      <Composition
        id="Memory-Song-Walkthrough"
        component={ProductDemoProof}
        durationInFrames={29 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />
      <Composition
        id="Complete-App-Walkthrough"
        component={CompleteWalkthrough}
        durationInFrames={29 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />
      <Composition
        id="Complete-App-Walkthrough-Slideshow"
        component={CompleteWalkthroughSlideshow}
        durationInFrames={24 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      {/* Video 1: "Remember When" — Old Couples */}
      <Composition
        id="Video1-RememberWhen"
        component={Video1RememberWhen}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />
      <Composition
        id="Video1-RememberWhen-Landscape"
        component={Video1RememberWhen}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />

      {/* Video 2: "Say It Different" — Young Guy Dating */}
      <Composition
        id="Video2-SayItDifferent"
        component={Video2SayItDifferent}
        durationInFrames={50 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />
      <Composition
        id="Video2-SayItDifferent-Landscape"
        component={Video2SayItDifferent}
        durationInFrames={50 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />

      {/* Video 3: "That Summer" — Old Friends */}
      <Composition
        id="Video3-ThatSummer"
        component={Video3ThatSummer}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />
      <Composition
        id="Video3-ThatSummer-Landscape"
        component={Video3ThatSummer}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />
      {/* ═══ V2: Memory Recreation Focus ═══ */}

      {/* Video 1 V2: "Remember When" — Memory-forward */}
      <Composition
        id="Video1-RememberWhen-V2"
        component={Video1RememberWhenV2}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />
      <Composition
        id="Video1-RememberWhen-V2-Landscape"
        component={Video1RememberWhenV2}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />

      {/* Video 2 V2: "Say It Different" — Memory-forward */}
      <Composition
        id="Video2-SayItDifferent-V2"
        component={Video2SayItDifferentV2}
        durationInFrames={50 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />
      <Composition
        id="Video2-SayItDifferent-V2-Landscape"
        component={Video2SayItDifferentV2}
        durationInFrames={50 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />

      {/* Video 3 V2: "That Summer" — Memory-forward */}
      <Composition
        id="Video3-ThatSummer-V2"
        component={Video3ThatSummerV2}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />
      <Composition
        id="Video3-ThatSummer-V2-Landscape"
        component={Video3ThatSummerV2}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />

      {/* ═══ V3: Sunny / Bright Editions ═══ */}

      {/* Video 1 V3: "Remember When" — Sunny */}
      <Composition
        id="Video1-RememberWhen-V3"
        component={Video1RememberWhenV3}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      {/* Video 2 V3: "Say It Different" — Sunny */}
      <Composition
        id="Video2-SayItDifferent-V3"
        component={Video2SayItDifferentV3}
        durationInFrames={50 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      {/* Video 3 V3: "That Summer" — Sunny */}
      <Composition
        id="Video3-ThatSummer-V3"
        component={Video3ThatSummerV3}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      {/* ═══ ADS: Counseling Series ═══ */}

      {/* Ad: Counseling V2 — Young Couple Variant (42s) */}
      <Composition
        id="Ad-Counseling-Young"
        component={AdCounselingYoung}
        durationInFrames={45 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      {/* Ad: Counseling V2 — Established Couple Variant (42s) */}
      <Composition
        id="Ad-Counseling-Established"
        component={AdCounselingEstablished}
        durationInFrames={45 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      {/* ═══ ADS: "The Drive Home" — Long-term couple, stock footage ═══ */}

      {/* Ad: Drive Home — Vertical 9:16 (55s) */}
      <Composition
        id="Ad-DriveHome"
        component={AdDriveHome}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      {/* Ad: Drive Home — Landscape 16:9 (55s) */}
      <Composition
        id="Ad-DriveHome-Landscape"
        component={AdDriveHome}
        durationInFrames={55 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />

      {/* ═══ ADS: "The Drive Home" V2 — Song-first, surprise-focused ═══ */}

      {/* Ad: Drive Home V2 — Vertical 9:16 (50s) */}
      <Composition
        id="Ad-DriveHome-V2"
        component={AdDriveHomeV2}
        durationInFrames={50 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      {/* Ad: Drive Home V2 — Landscape 16:9 (50s) */}
      <Composition
        id="Ad-DriveHome-V2-Landscape"
        component={AdDriveHomeV2}
        durationInFrames={50 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />

      {/* ═══ ADS: "The Drive Home" V3 — Porizo phone screen + download CTAs ═══ */}

      {/* Ad: Drive Home V3 — Vertical 9:16 (50s) */}
      <Composition
        id="Ad-DriveHome-V3"
        component={AdDriveHomeV3}
        durationInFrames={50 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      {/* Ad: Drive Home V3 — Landscape 16:9 (50s) */}
      <Composition
        id="Ad-DriveHome-V3-Landscape"
        component={AdDriveHomeV3}
        durationInFrames={50 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />

      {/* ═══ ADS: "The Drive Home" V4 — HeyGen visuals + Porizo song + branding ═══ */}

      <Composition
        id="Ad-DriveHome-V4"
        component={AdDriveHomeV4}
        durationInFrames={50 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      <Composition
        id="Ad-DriveHome-V4-Landscape"
        component={AdDriveHomeV4}
        durationInFrames={50 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />

      {/* ═══ ADS: "The Drive Home" V5 — HeyGen v2 visuals + Porizo song + branding ═══ */}

      <Composition
        id="Ad-DriveHome-V5"
        component={AdDriveHomeV5}
        durationInFrames={60 * FPS}
        fps={FPS}
        width={dimensions.vertical.width}
        height={dimensions.vertical.height}
      />

      <Composition
        id="Ad-DriveHome-V5-Landscape"
        component={AdDriveHomeV5}
        durationInFrames={60 * FPS}
        fps={FPS}
        width={dimensions.landscape.width}
        height={dimensions.landscape.height}
      />
    </>
  );
};

registerRoot(RemotionRoot);
