import SceneRoot from "./canvas/SceneRoot";

export default function Page() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold mb-4">Sticky Notes 3D — MVP Boot</h1>
      <p className="mb-6 text-sm opacity-80">
        If you can see a lit 3D cube below, R3F is working.
      </p>
      <SceneRoot />
    </main>
  );
}
