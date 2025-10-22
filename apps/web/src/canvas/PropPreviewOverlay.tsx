"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import type { PropCatalogEntry } from "@/data/propCatalog";

type PropPreviewOverlayProps = {
  entry: PropCatalogEntry | null;
  rect: DOMRectReadOnly | null;
};

type PreparedPreview = {
  group: THREE.Group;
  empty: boolean;
};

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; preview: PreparedPreview }
  | { status: "error"; reason: "load-error" | "context-lost" };

const PREVIEW_WIDTH = 220;
const PREVIEW_HEIGHT = 180;
const PREVIEW_OFFSET = 20;

const previewResultCache = new Map<string, PreparedPreview>();
const previewPromiseCache = new Map<string, Promise<PreparedPreview>>();

let sharedLoader: GLTFLoader | null = null;
let sharedDraco: DRACOLoader | null = null;
let loaderConfigured = false;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function ensureLoader(): GLTFLoader {
  if (!sharedLoader) {
    sharedLoader = new GLTFLoader();
  }

  if (!loaderConfigured) {
    sharedDraco = new DRACOLoader();
    sharedDraco.setDecoderConfig({ type: "wasm" });
    sharedDraco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
    sharedLoader.setDRACOLoader(sharedDraco);
    sharedLoader.setMeshoptDecoder(MeshoptDecoder);
    loaderConfigured = true;
  }

  return sharedLoader;
}

function prepareScene(source: THREE.Object3D): PreparedPreview {
  const container = new THREE.Group();
  const clone = source.clone(true);
  container.add(clone);

  container.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(container);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const empty = !isFinite(maxDim) || maxDim < 1e-5;

  if (!empty) {
    const targetSize = 1.4;
    const scale = targetSize / (maxDim || 1);
    container.scale.setScalar(scale);
  }

  container.updateMatrixWorld(true);

  const normalizedBox = new THREE.Box3().setFromObject(container);
  const center = new THREE.Vector3();
  normalizedBox.getCenter(center);
  container.position.sub(center);

  container.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((mat) => {
          if (mat instanceof THREE.Material) {
            const cloneMat = mat.clone();
            cloneMat.needsUpdate = true;
            return cloneMat;
          }
          return mat;
        });
      } else if (mesh.material && (mesh.material as THREE.Material).isMaterial) {
        const mat = mesh.material as THREE.Material;
        const cloneMat = mat.clone();
        cloneMat.needsUpdate = true;
        mesh.material = cloneMat;
      }
    }
  });

  return { group: container, empty };
}

async function loadPreview(entry: PropCatalogEntry): Promise<PreparedPreview> {
  const cached = previewResultCache.get(entry.id);
  if (cached) {
    return cached;
  }

  const pending = previewPromiseCache.get(entry.id);
  if (pending) {
    return pending;
  }

  const loader = ensureLoader();
  const promise = loader.loadAsync(entry.url).then((gltf) => {
    const prepared = prepareScene(gltf.scene);
    previewResultCache.set(entry.id, prepared);
    previewPromiseCache.delete(entry.id);
    return prepared;
  });

  previewPromiseCache.set(entry.id, promise);
  return promise;
}

export default function PropPreviewOverlay({ entry, rect }: PropPreviewOverlayProps) {
  const [state, setState] = useState<PreviewState>({ status: "idle" });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const objectRef = useRef<THREE.Group | null>(null);
  const animationRef = useRef<number | null>(null);
  const clockRef = useRef(new THREE.Clock());
  const orbitCenterRef = useRef(new THREE.Vector3());
  const orbitParamsRef = useRef<{ distance: number; height: number } | null>(null);
  const orbitAngleRef = useRef(0);

  const [hasContext, setHasContext] = useState(true);

  const basicShouldRender = !!entry && !!rect;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!basicShouldRender || !canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    rendererRef.current = renderer;

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setHasContext(false);
      setState({ status: "error", reason: "context-lost" });
    };

    canvas.addEventListener("webglcontextlost", handleContextLost, { passive: false });

    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      if (rendererRef.current) {
        rendererRef.current.forceContextLoss();
        rendererRef.current.dispose();
      } else {
        renderer.forceContextLoss();
        renderer.dispose();
      }
      rendererRef.current = null;
    };
  }, [basicShouldRender]);

  useEffect(() => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101217);
    sceneRef.current = scene;

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(2.7, 2.3, 1.5);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.55);
    rimLight.position.set(-2.0, 1.5, -2.5);
    const fillLight = new THREE.HemisphereLight(0xe0f0ff, 0x1a1c26, 0.45);

    scene.add(ambient);
    scene.add(keyLight);
    scene.add(rimLight);
    scene.add(fillLight);

    return () => {
      scene.clear();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const camera = new THREE.PerspectiveCamera(34, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.02, 50);
    cameraRef.current = camera;
  }, []);

  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!entry) {
      stopAnimation();
      if (objectRef.current && sceneRef.current) {
        sceneRef.current.remove(objectRef.current);
        objectRef.current = null;
      }
      setState({ status: "idle" });
      return () => {
        cancelled = true;
      };
    }

    setState({ status: "loading" });
    setHasContext(true);

    loadPreview(entry)
      .then((preview) => {
        if (cancelled) return;
        setState({ status: "ready", preview });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({ status: "error", reason: "load-error" });
      });

    return () => {
      cancelled = true;
    };
  }, [entry, stopAnimation]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;

    if (!renderer || !scene || !camera) return;

    if (state.status !== "ready") {
      stopAnimation();
      renderer.clear();
      if (objectRef.current) {
        scene.remove(objectRef.current);
        objectRef.current = null;
      }
      return;
    }

    if (objectRef.current) {
      scene.remove(objectRef.current);
    }

    const instance = state.preview.group.clone(true);
    instance.rotation.set(0, 0, 0);
    instance.updateMatrixWorld(true);
    instance.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    objectRef.current = instance;
    scene.add(instance);

    const bbox = new THREE.Box3().setFromObject(instance);
    const center = bbox.getCenter(new THREE.Vector3());
    const sphere = bbox.getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius || 1;

    const currentCamera = cameraRef.current;
    if (currentCamera) {
      const distance = radius * 2.4;
      const height = radius * 0.9;
      orbitCenterRef.current.copy(center);
      orbitParamsRef.current = { distance, height };
      orbitAngleRef.current = 0;
      currentCamera.near = Math.max(0.01, radius * 0.2);
      currentCamera.far = Math.max(10, radius * 6);
      const initialX = center.x + distance;
      const initialY = center.y + height;
      const initialZ = center.z;
      currentCamera.position.set(initialX, initialY, initialZ);
      currentCamera.lookAt(center);
      currentCamera.updateProjectionMatrix();
    }

    clockRef.current.stop();
    clockRef.current.start();
    if (currentCamera) {
      renderer.render(scene, currentCamera);
    }

    const animate = () => {
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !objectRef.current) {
        return;
      }

      const delta = clockRef.current.getDelta();
      const orbitParams = orbitParamsRef.current;
      if (orbitParams) {
        orbitAngleRef.current += delta * 0.6;
        const angle = orbitAngleRef.current;
        const { distance, height } = orbitParams;
        const centerVec = orbitCenterRef.current;
        const cam = cameraRef.current;
        if (cam) {
          const x = centerVec.x + Math.cos(angle) * distance;
          const z = centerVec.z + Math.sin(angle) * distance;
          const y = centerVec.y + height;
          cam.position.set(x, y, z);
          cam.lookAt(centerVec);
        }
      }

      rendererRef.current.render(sceneRef.current, cameraRef.current);
      animationRef.current = requestAnimationFrame(animate);
    };

    stopAnimation();
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      stopAnimation();
      if (objectRef.current && sceneRef.current) {
        sceneRef.current.remove(objectRef.current);
        objectRef.current = null;
      }
    };
  }, [state, stopAnimation]);

  useEffect(() => () => stopAnimation(), [stopAnimation]);

  const hasPosition = entry && rect;
  const position = useMemo(() => {
    if (!hasPosition || !rect) return null;

    if (typeof window === "undefined") {
      return { top: 0, left: 0 };
    }

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const idealTop = rect.top + rect.height / 2 - PREVIEW_HEIGHT / 2;
    const safeTop = clamp(idealTop, 12, Math.max(12, viewportHeight - PREVIEW_HEIGHT - 12));

    let left = rect.left - PREVIEW_WIDTH - PREVIEW_OFFSET;
    const minLeft = 12;
    const fitsOnLeft = left >= minLeft;
    if (!fitsOnLeft) {
      const rightCandidate = rect.right + PREVIEW_OFFSET;
      if (rightCandidate + PREVIEW_WIDTH < viewportWidth - minLeft) {
        left = rightCandidate;
      } else {
        left = Math.max(minLeft, left);
      }
    }

    return { top: safeTop, left };
  }, [hasPosition, rect]);

  const shouldRender = !!entry && !!rect && !!position;

  const renderStatusMessage = () => {
    if (!shouldRender) return null;

    if (state.status === "loading") {
      return (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60">
          Loading preview...
          <span className="ml-2 text-[10px] uppercase tracking-wide text-white/30">
            {entry?.id}
          </span>
        </div>
      );
    }

    if (state.status === "error") {
      const message =
        state.reason === "context-lost"
          ? "Preview unavailable (WebGL context lost)"
          : "Preview unavailable";
      return (
        <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-red-300/80">
          <div>
            {message}
            <span className="mt-1 block text-[9px] uppercase tracking-wide text-white/20">
              {entry?.id}
            </span>
          </div>
        </div>
      );
    }

    if (state.status === "ready" && state.preview.empty) {
      return (
        <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-yellow-200/80">
          <div>
            No preview geometry
            <span className="mt-1 block text-[9px] uppercase tracking-wide text-white/20">
              {entry?.id}
            </span>
          </div>
        </div>
      );
    }

    if (!hasContext) {
      return (
        <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-red-300/80">
          <div>
            WebGL context lost
            <span className="mt-1 block text-[9px] uppercase tracking-wide text-white/20">
              {entry?.id}
            </span>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <AnimatePresence>
      {shouldRender && (
        <motion.div
          key={entry!.id}
          className="pointer-events-none fixed z-30"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          style={{
            width: PREVIEW_WIDTH,
            height: PREVIEW_HEIGHT,
            top: position!.top,
            left: position!.left,
          }}
        >
          <div className="pointer-events-none flex h-full w-full flex-col rounded-lg border border-white/15 bg-black/80 p-2 shadow-xl backdrop-blur-md">
            <div
              className="relative flex-1 overflow-hidden rounded-md bg-black/60"
              style={{ minHeight: PREVIEW_HEIGHT - 60 }}
            >
              <canvas
                ref={canvasRef}
                width={PREVIEW_WIDTH}
                height={PREVIEW_HEIGHT}
                className="h-full w-full bg-black/30"
              />
              {renderStatusMessage()}
              <div className="pointer-events-none absolute bottom-1 right-1 text-[9px] uppercase tracking-wide text-white/30">
                {state.status}
              </div>
            </div>
            {entry && (
              <div className="mt-2 text-center text-[11px] font-medium uppercase tracking-wide text-white/70">
                {entry.label}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
