// @vitest-environment jsdom
import { createElement } from "react";
import { expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { ServiceProvider } from "@/hooks/useServices.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { BotCollaborationSettings } from "./index.js";
it("宿主未提供Local能力时保持原界面", async () => {
  const services = {
    botsService: { getCollaborationSettings: async () => null },
    broadcastService: { onMessage: () => ({ dispose() {} }) },
  } as unknown as Parameters<typeof ServiceProvider>[0]["services"];
  const view = render(
    createElement(ServiceProvider, {
      services,
      children: createElement(ZCodeIntlProvider, {
        initialLocale: "zh-CN",
        children: createElement(BotCollaborationSettings, { provider: "feishu" }),
      }),
    }),
  );
  await act(async () => {});
  expect(view.container.textContent).toBe("");
  view.unmount();
});
