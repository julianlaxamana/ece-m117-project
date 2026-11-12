import { LiveChat } from "@/components/LiveChat";

export const metadata = { title: "Live · Injection Viewer" };

export default function LivePage() {
  // The chat fills the space under the nav; the composer stays pinned at the bottom.
  return (
    <main className="flex h-[calc(100dvh-49px)] flex-col">
      <LiveChat />
    </main>
  );
}
