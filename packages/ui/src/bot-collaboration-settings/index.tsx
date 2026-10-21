import { useEffect, useId, useState, type ReactNode } from "react";
import {
  collaborationUserId,
  type CollaborationSave,
  type CollaborationSnapshot,
} from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import { Button } from "@/components/ui/button.js";
import { Input, inputVariants } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { useCollaborationSettings } from "@/hooks/bot-collaboration/useCollaborationSettings.js";
import type { BotCollaborationSettingsProps } from "./contract.js";

type Group = CollaborationSnapshot["groups"][number];
function Choice({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="grid min-w-0 gap-1 text-ui-base text-foreground">
      <span>{label}</span>
      <select
        id={id}
        className={inputVariants()}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function GroupForm({
  group,
  pending,
  save,
  verify,
}: {
  group: Group;
  pending: boolean;
  save(input: CollaborationSave): Promise<void>;
  verify(botId: string, name: string): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (name: string) => intl.formatMessage({ id: `bots.collaboration.${name}` });
  const [enabled, setEnabled] = useState(group.config?.enabled ?? false);
  const [pm, setPm] = useState(group.config?.pm.botId ?? "");
  const [executors, setExecutors] = useState(
    group.config?.executors.map(({ botId, duty }) => ({ botId, duty })) ?? [],
  );
  const [user, setUser] = useState(
    group.config ? collaborationUserId(group.config.authorizedUser) : "",
  );
  const [workspace, setWorkspace] = useState(group.config?.workspace.id ?? "");
  const selected = [pm, ...executors.map((item) => item.botId)];
  const ready =
    pm &&
    executors.length &&
    executors.every((item) => item.duty.trim()) &&
    user &&
    workspace &&
    selected.every((id) =>
      group.bots.some((bot) => bot.id === id && bot.verified && bot.connected),
    );
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save({
          provider: group.provider,
          chatId: group.chatId,
          expectedRevision: group.config?.revision ?? 0,
          enabled,
          pmBotId: pm,
          executors,
          authorizedUserId: user,
          workspaceId: workspace,
        });
      }}
    >
      <p className="text-ui-sm text-foreground-subtle">
        {intl.formatMessage(
          { id: "bots.collaboration.revision" },
          { revision: group.config?.revision ?? 0 },
        )}
      </p>
      {group.busy && (
        <p role="status" className="text-ui-base text-warning">
          {t("busy")}
        </p>
      )}
      <fieldset disabled={pending || group.busy} className="grid min-w-0 gap-3">
        <label className="flex items-center justify-between gap-3 text-ui-base text-foreground">
          <span>{t("enable")}</span>
          <Switch aria-label={t("enable")} checked={enabled} onCheckedChange={setEnabled} />
        </label>
        <Choice
          label={t("pm")}
          value={pm}
          onChange={(value) => {
            setPm(value);
            setExecutors((items) => items.filter((item) => item.botId !== value));
          }}
        >
          <option value="">{t("choose")}</option>
          {group.bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </Choice>
        <div className="grid gap-2">
          <p className="text-ui-base font-medium text-foreground">{t("executors")}</p>
          {group.bots
            .filter((bot) => bot.id !== pm)
            .map((bot) => {
              const selected = executors.find((item) => item.botId === bot.id);
              const label = intl.formatMessage(
                { id: "bots.collaboration.executor" },
                { name: bot.name },
              );
              const duty = intl.formatMessage(
                { id: "bots.collaboration.duty" },
                { name: bot.name },
              );
              return (
                <div key={bot.id} className="grid min-w-0 gap-2">
                  <label className="flex items-center gap-2 text-ui-base text-foreground">
                    <Checkbox
                      aria-label={label}
                      checked={Boolean(selected)}
                      onCheckedChange={(checked) =>
                        setExecutors((items) =>
                          checked
                            ? [...items, { botId: bot.id, duty: "" }]
                            : items.filter((item) => item.botId !== bot.id),
                        )
                      }
                    />
                    {bot.name}
                  </label>
                  {selected && (
                    <Input
                      aria-label={duty}
                      placeholder={t("dutyHint")}
                      value={selected.duty}
                      maxLength={500}
                      onChange={(event) =>
                        setExecutors((items) =>
                          items.map((item) =>
                            item.botId === bot.id ? { ...item, duty: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  )}
                </div>
              );
            })}
        </div>
        <Choice label={t("user")} value={user} onChange={setUser}>
          <option value="">{t("choose")}</option>
          {group.users.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Choice>
        <Choice label={t("workspace")} value={workspace} onChange={setWorkspace}>
          <option value="">{t("choose")}</option>
          {group.workspaces.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Choice>
        <div className="grid gap-2">
          <p className="text-ui-sm text-foreground-subtle">{t("identityHint")}</p>
          {group.bots.map((bot) => (
            <div
              key={bot.id}
              className="flex min-w-0 items-center justify-between gap-2 text-ui-base"
            >
              <span className="min-w-0 truncate text-foreground">{bot.name}</span>
              {bot.verified && bot.connected ? (
                <span className="text-ui-sm text-foreground-subtle">{t("verified")}</span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => verify(bot.id, bot.name)}
                >
                  {intl.formatMessage({ id: "bots.collaboration.verify" }, { name: bot.name })}
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button type="submit" disabled={!ready || pending || group.busy}>
          {pending ? t("saving") : t("save")}
        </Button>
      </fieldset>
    </form>
  );
}

export function BotCollaborationSettings({ provider }: BotCollaborationSettingsProps) {
  const state = useCollaborationSettings();
  const { intl } = useZCodeIntl();
  const t = (name: string) => intl.formatMessage({ id: `bots.collaboration.${name}` });
  const groups = state.snapshot?.groups.filter((group) => group.provider === provider) ?? [];
  const [selected, setSelected] = useState("");
  const group = groups.find((group) => group.chatId === selected) ?? groups[0];
  useEffect(() => {
    state.clearChallenge();
  }, [selected, state.clearChallenge]);
  if (!state.snapshot && !state.error) return null;
  return (
    <SettingsGroupCard>
      <section
        data-testid="bot-collaboration-settings"
        aria-label={t("title")}
        className="grid min-w-0 gap-3 p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-ui-base font-medium text-foreground">{t("title")}</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={state.pending}
            onClick={() => void state.reload()}
          >
            {t("refresh")}
          </Button>
        </div>
        <p className="text-ui-sm text-foreground-subtle">{t("description")}</p>
        {state.error && (
          <p role="alert" className="text-ui-base text-destructive">
            {t(state.error)}
          </p>
        )}
        {group ? (
          <>
            <Choice label={t("group")} value={group.chatId} onChange={setSelected}>
              {groups.map((item) => (
                <option key={item.chatId} value={item.chatId}>
                  {item.name}
                </option>
              ))}
            </Choice>
            <GroupForm
              key={`${group.chatId}:${group.config?.revision ?? 0}`}
              group={group}
              pending={state.pending}
              save={state.save}
              verify={(botId, name) =>
                void state.verify({ provider: group.provider, chatId: group.chatId, botId }, name)
              }
            />
          </>
        ) : (
          <p className="text-ui-base text-foreground-subtle">{t("empty")}</p>
        )}
        {state.challenge &&
          state.challenge.provider === group?.provider &&
          state.challenge.chatId === group.chatId &&
          !group.bots.some(
            (bot) => bot.id === state.challenge?.botId && bot.verified && bot.connected,
          ) && (
            <div className="grid gap-2 border-t border-border pt-3">
              <p className="text-ui-base text-foreground">
                {intl.formatMessage(
                  { id: "bots.collaboration.challenge" },
                  { name: state.challenge.name },
                )}
              </p>
              <Input
                aria-label={t("command")}
                readOnly
                value={state.challenge.command}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          )}
      </section>
    </SettingsGroupCard>
  );
}
