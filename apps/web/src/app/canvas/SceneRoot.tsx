"use client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

function SpinningBox() {
  return (
    <mesh rotation={[0.4, 0.6, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial />
    </mesh>
  );
}

export default function SceneRoot() {
  return (
    <div style={{ width: "100%", height: "70vh" }}>
      <Canvas camera={{ position: [2.5, 2, 2.5] }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <SpinningBox />
        <OrbitControls enablePan={false} />
      </Canvas>
    </div>
  );
}
