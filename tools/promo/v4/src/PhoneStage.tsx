import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import { Video } from '@remotion/media';
import { AbsoluteFill, Easing, Freeze, interpolate, staticFile, useCurrentFrame, useRemotionEnvironment, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPhone } from './hardware';
import type { Footage } from './assets';

export type CameraMode = 'reveal' | 'overview' | 'read' | 'close';
const ease = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(.22, 1, .36, 1) } as const;

function SoftContactShadow({ portrait }: { portrait: boolean }) {
  const texture = useMemo(() => {
    const canvas = new OffscreenCanvas(256, 256), context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 126);
    gradient.addColorStop(0, 'rgba(0,0,0,.6)'); gradient.addColorStop(.4, 'rgba(0,0,0,.23)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(canvas);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[portrait ? 0 : 2.65, portrait ? -4.9 : -3.6, 0]}>
    <planeGeometry args={[6, 4]} /><meshBasicMaterial map={texture} transparent depthWrite={false} />
  </mesh>;
}

function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl), room = new RoomEnvironment();
    const target = generator.fromScene(room, .04);
    scene.environment = target.texture; scene.environmentIntensity = .75;
    room.dispose(); generator.dispose();
    return () => { scene.environment = null; target.dispose(); };
  }, [gl, scene]);
  return null;
}

function Phone({ clip, mode, approachFrames, focusY, stillFrame }: { clip: Footage; mode: CameraMode; approachFrames: number; focusY: number; stillFrame?: number }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  const { camera, invalidate, advance } = useThree();
  const { isRendering } = useRemotionEnvironment();
  const media = useMemo(() => {
    const canvas = new OffscreenCanvas(1080, 2404), context = canvas.getContext('2d');
    if (!context) throw new Error('A 2D media canvas is required');
    context.fillStyle = '#101117'; context.fillRect(0, 0, 1080, 2404);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return { context, texture };
  }, []);
  const phone = useMemo(() => createPhone(media.texture), [media.texture]);
  useEffect(() => () => { phone.dispose(); media.texture.dispose(); }, [phone, media]);
  const onVideoFrame = useCallback((image: CanvasImageSource) => {
    media.context.drawImage(image, 0, 0, 1080, 2404); media.texture.needsUpdate = true;
    // Remotion renders with frameloop="never". Async decode must explicitly
    // draw this texture so the export cannot retain a previous app frame.
    if (isRendering) advance(performance.now()); else invalidate();
  }, [media, advance, invalidate, isRendering]);

  useLayoutEffect(() => {
    // Zero starts a reading shot already settled, without a one-frame reset.
    const t = approachFrames === 0 ? 1 : interpolate(frame, [0, approachFrames], [0, 1], ease);
    const reading = mode === 'read', closing = mode === 'close', reveal = mode === 'reveal';
    const x = portrait ? 0 : reading ? THREE.MathUtils.lerp(2.2, 0, t) : 2.65;
    phone.group.position.set(x, portrait && !reading ? -1.3 : 0, 0);
    phone.group.rotation.set(
      reading ? THREE.MathUtils.lerp(.045, 0, t) : -.025,
      reading ? THREE.MathUtils.lerp(-.24, .012, t) : closing ? THREE.MathUtils.lerp(-.10, -.30, t) : THREE.MathUtils.lerp(reveal ? -.72 : -.27, -.13, t),
      reading ? 0 : THREE.MathUtils.lerp(reveal ? -.065 : -.012, -.012, t),
    );
    const startZ = portrait ? 17.8 : 15.0;
    const endZ = reading ? (portrait ? 10.9 : 7.8) : (portrait ? 17.2 : 14.2);
    camera.position.set(0, 0, THREE.MathUtils.lerp(startZ, endZ, t));
    camera.lookAt(0, reading ? THREE.MathUtils.lerp(0, focusY, t) : 0, 0);
    camera.updateProjectionMatrix();
    phone.glass.material.opacity = reading ? .035 * (1 - t) : .025;
    invalidate();
  }, [frame, approachFrames, camera, phone, mode, portrait, focusY, invalidate]);

  return <>
    <Freeze frame={stillFrame ?? clip.lastFrame} active={stillFrame !== undefined || frame > clip.lastFrame}>
      <Video src={staticFile(clip.file)} muted headless onVideoFrame={onVideoFrame} />
    </Freeze>
    <primitive object={phone.group} />
  </>;
}

export function PhoneStage({ clip, mode = 'overview', approachFrames = 140, focusY = .75, stillFrame, phoneScale = 1, phoneOffsetY = 0 }: {
  clip: Footage; mode?: CameraMode; approachFrames?: number; focusY?: number; stillFrame?: number; phoneScale?: number; phoneOffsetY?: number;
}) {
  const { width, height } = useVideoConfig();
  return <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 70% 44%, #1a2033 0%, #0c0f19 43%, #07090f 76%)' }}>
    <ThreeCanvas width={width} height={height} shadows camera={{ fov: 34, near: .1, far: 80, position: [0, 0, 15] }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}>
      <StudioEnvironment />
      <ambientLight intensity={.2} />
      <spotLight position={[-5, 8, 8]} intensity={95} angle={.55} penumbra={1} color="#f1f3ff" />
      <pointLight position={[5, 2, 1]} intensity={28} color="#aaaefa" />
      <pointLight position={[-4, -1, -2]} intensity={18} color="#90b7a4" />
      <group scale={phoneScale} position={[0, phoneOffsetY, 0]}>
        <Phone clip={clip} mode={mode} approachFrames={approachFrames} focusY={focusY} stillFrame={stillFrame} />
        <SoftContactShadow portrait={height > width} />
      </group>
    </ThreeCanvas>
  </AbsoluteFill>;
}
