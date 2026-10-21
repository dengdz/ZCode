import { createRoot } from "react-dom/client";
import type { IServiceAccessor } from "@zcode/services";
import { ChannelClient, Emitter, ProxyChannel, VSBuffer } from "@zcode/rpc";
import { ServiceProvider } from "@/hooks/useServices.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { BotCollaborationSettings } from "@/bot-collaboration-settings/index.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
document.documentElement.className =
  params.get("theme") === "dark" ? "dark theme-zai-dark" : "light theme-zai-light";
declare global {
  interface Window {
    collaborationRpcSend(bytes: number[]): Promise<void>;
    collaborationRpcReady(): Promise<void>;
  }
}
// 仅传输由测试端口提供；使用生产 RPC 的序列化、服务代理与错误传播。
const inbox = new Emitter<VSBuffer>();
window.addEventListener("collaboration-rpc", (event) =>
  inbox.fire(VSBuffer.wrap(Uint8Array.from((event as CustomEvent<number[]>).detail))),
);
const client = new ChannelClient({
  onMessage: inbox.event,
  send: (buffer) => {
    void window.collaborationRpcSend(Array.from(buffer.buffer));
  },
});
void window.collaborationRpcReady();
const services = {
  botsService: ProxyChannel.toService<IServiceAccessor["botsService"]>(client.getChannel("bots")),
  broadcastService: { onMessage: () => ({ dispose() {} }) },
} as unknown as IServiceAccessor;
createRoot(document.getElementById("root")!).render(
  <ServiceProvider services={services}>
    <ZCodeIntlProvider initialLocale={params.get("locale") === "en-US" ? "en-US" : "zh-CN"}>
      <main className="min-h-screen bg-background p-3 text-foreground">
        <BotCollaborationSettings provider="feishu" />
      </main>
    </ZCodeIntlProvider>
  </ServiceProvider>,
);
