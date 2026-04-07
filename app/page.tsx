import ChatBox from "./components/ChatBox";
import DriveFolderPicker from "./components/DriveFolderPicker";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center p-8 gap-8">
      <DriveFolderPicker />
      <ChatBox />
    </div>
  );
}
