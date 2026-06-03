import KinectStudio from "./components/KinectStudio";

export default function Home() {
  return (
    <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <KinectStudio />
    </main>
  );
}
