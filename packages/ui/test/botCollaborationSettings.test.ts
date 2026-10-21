// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { IServiceAccessor } from "@zcode/services";
import type { CollaborationSave, CollaborationSnapshot } from "@zcode/shared";
import { ServiceProvider } from "@/hooks/useServices.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { BotCollaborationSettings } from "@/bot-collaboration-settings/index.js";
beforeEach(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => {} },
    scrollIntoView: { configurable: true, value: () => {} },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("通过群设置选择身份、职责和项目并显示服务确认的持久版本", async () => {
  const choose = async (label: string, option: string) => {
    fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: option, exact: true }));
  };
  let snapshot: CollaborationSnapshot = {
    groups: [
      {
        provider: "feishu",
        chatId: "oc_test",
        name: "测试项目群",
        config: null,
        busy: false,
        bots: [
          { id: "pm", name: "PM", verified: true, connected: true },
          { id: "app", name: "APP", verified: true, connected: true },
        ],
        users: [{ id: '["tenant","on_owner"]', name: "测试用户" }],
        workspaces: [
          {
            id: "project-choice",
            label: "测试项目",
            projectId: "p1",
            hostId: "local",
            workspacePath: "/test",
          },
        ],
      },
    ],
  };
  const save = vi.fn(async (input: CollaborationSave) => {
    snapshot = {
      groups: [
        {
          ...snapshot.groups[0]!,
          config: {
            provider: input.provider,
            chatId: input.chatId,
            revision: input.expectedRevision + 1,
            enabled: input.enabled,
            pm: { botId: "pm", appId: "cli_pm", openId: "ou_pm", ownerOpenId: "ou_owner" },
            executors: [
              {
                botId: "app",
                appId: "cli_app",
                openId: "ou_app",
                ownerOpenId: "ou_owner_app",
                duty: input.executors[0]!.duty,
              },
            ],
            authorizedUser: { tenantKey: "tenant", unionId: "on_owner" },
            workspace: snapshot.groups[0]!.config?.workspace ?? snapshot.groups[0]!.workspaces[0]!,
          },
        },
      ],
    };
    return snapshot;
  });
  const services = {
    botsService: {
      getCollaborationSettings: async () => snapshot,
      saveCollaborationSettings: save,
    },
    broadcastService: { onMessage: () => ({ dispose() {} }) },
  } as unknown as IServiceAccessor;
  const show = () =>
    render(
      createElement(
        ServiceProvider,
        { services },
        createElement(
          ZCodeIntlProvider,
          { initialLocale: "zh-CN" },
          createElement(BotCollaborationSettings, { provider: "feishu" }),
        ),
      ),
    );
  const view = show();
  await screen.findByRole("combobox", { name: "协作群" });
  await choose("PM 机器人", "PM");
  fireEvent.click(screen.getByRole("checkbox", { name: "执行者：APP" }));
  fireEvent.change(screen.getByRole("textbox", { name: "职责：APP" }), {
    target: { value: "负责 APP 开发" },
  });
  await choose("授权用户", "测试用户");
  await choose("绑定项目", "测试项目");
  fireEvent.click(screen.getByRole("switch", { name: "启用 PM 协作" }));
  fireEvent.click(screen.getByRole("button", { name: "保存协作设置" }));
  await screen.findByText("配置版本：1");
  expect(save.mock.calls[0]?.[0]).toEqual({
    provider: "feishu",
    chatId: "oc_test",
    expectedRevision: 0,
    enabled: true,
    pmBotId: "pm",
    executors: [{ botId: "app", duty: "负责 APP 开发" }],
    authorizedUserId: '["tenant","on_owner"]',
    workspaceId: "project-choice",
  });
  view.unmount();
  show();
  await screen.findByText("配置版本：1");
  expect((screen.getByRole("textbox", { name: "职责：APP" }) as HTMLInputElement).value).toBe(
    "负责 APP 开发",
  );
  snapshot = { groups: [{ ...snapshot.groups[0]!, bots: [], users: [], workspaces: [] }] };
  fireEvent.click(screen.getByRole("button", { name: "刷新", exact: true }));
  await act(async () => {});
  expect((screen.getByRole("button", { name: "保存协作设置" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("switch", { name: "启用 PM 协作" }));
  fireEvent.click(screen.getByRole("button", { name: "保存协作设置" }));
  await screen.findByText("配置版本：2");
  expect(save.mock.calls[1]?.[0]).toMatchObject({
    expectedRevision: 1,
    enabled: false,
    pmBotId: "pm",
    workspaceId: "project-choice",
  });
});
