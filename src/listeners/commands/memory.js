import { answerFromMemory } from "../../services/rag.service.js";
import { getDecisions } from "../../repositories/message.repository.js";
import { summarizeChannel } from "../../services/summary.service.js";
import { logInteraction } from "../../services/context.service.js";
import { searchMemory } from "../../services/search.service.js";
import { saveThread, saveChannel } from "../../services/save.service.js";

export function registerMemoryCommand(app) {
  app.command("/memory", async ({ command, ack, respond, client }) => {
    await ack();

    const [subcommand, ...rest] = command.text.trim().split(" ");
    const query = rest.join(" ");

    if (subcommand === "ask") {
      if (!query) {
        await respond("Usage: `/memory ask <your question>`");
        return;
      }

      await respond({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Searching workspace memory...*` },
          },
        ],
      });

      try {
        const answer = await answerFromMemory(
          command.team_id,
          command.user_id,
          command.channel_id,
          query,
          client,
        );
        await respond({
          replace_original: true,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: `*${query}*` },
            },
            { type: "divider" },
            {
              type: "section",
              text: { type: "mrkdwn", text: answer },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `MemGo · <@${command.user_id}> · <!date^${Math.floor(Date.now() / 1000)}^{time}|now> · Results reflect messages up to 5 min ago`,
                },
              ],
            },
          ],
        });
      } catch (err) {
        console.error("❌ /memory ask error:", err);
        await respond({
          replace_original: true,
          text: err.message,
        });
      }
      return;
    }

    if (subcommand === "decisions") {
      await respond({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Fetching workspace decisions...*` },
          },
        ],
      });

      try {
        const decisions = await getDecisions(
          command.team_id,
          command.channel_id,
          10,
        );

        if (decisions.length === 0) {
          await respond({
            replace_original: true,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `No decisions recorded yet. Decisions are automatically detected from your conversations.`,
                },
              },
            ],
          });
          return;
        }

        const decisionBlocks = decisions.flatMap((d) => {
          const name = d.display_name || d.user_id;
          const ts = d.slack_timestamp
            ? new Date(parseFloat(d.slack_timestamp) * 1000).toLocaleString(
                "en-US",
                {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                },
              )
            : "";
          const tags = d.topic_tags?.length ? d.topic_tags.join(", ") : null;

          return [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${d.text}`,
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `${name} · ${ts}${tags ? ` · ${tags}` : ""}`,
                },
              ],
            },
            { type: "divider" },
          ];
        });

        await respond({
          replace_original: true,
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: "Workspace Decisions" },
            },
            ...decisionBlocks,
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `MemGo · ${decisions.length} decision(s) found`,
                },
              ],
            },
          ],
        });

        // Non-blocking log
        logInteraction(
          command.team_id,
          command.user_id,
          command.channel_id,
          "decisions",
          null,
          decisions.map((d) => d.text).join("\n"),
          { decisionCount: decisions.length },
        );
      } catch (err) {
        console.error("❌ /memory decisions error:", err);
        await respond({
          replace_original: true,
          text: err.message,
        });
      }
      return;
    }

    if (subcommand === "summarize") {
      await respond({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Summarizing workspace memory...*` },
          },
        ],
      });

      try {
        const summary = await summarizeChannel(
          command.team_id,
          command.user_id,
          command.channel_id,
          client,
        );

        const wasTruncated = summary.length > 2900;
        const displaySummary = truncateForSlack(summary);

        await respond({
          replace_original: true,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: `*Channel Summary (last 7 days)*` },
            },
            { type: "divider" },
            {
              type: "section",
              text: { type: "mrkdwn", text: displaySummary },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `MemGo · <@${command.user_id}> · <!date^${Math.floor(Date.now() / 1000)}^{time}|now>`,
                },
              ],
            },
          ],
        });
        if (wasTruncated) {
          await client.chat.postEphemeral({
            channel: command.channel_id,
            user: command.user_id,
            blocks: [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: "Full Channel Summary (last 7 days)",
                },
              },
              { type: "divider" },
              {
                type: "section",
                text: { type: "mrkdwn", text: truncateForSlack(summary, 2900) },
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `MemGo · Only visible to you · <@${command.user_id}>`,
                  },
                ],
              },
            ],
          });
        }
      } catch (err) {
        console.error("❌ /memory summarize error:", err);
        await respond({
          replace_original: true,
          text: err.message,
        });
      }
    }

    if (subcommand === "search") {
      if (!query) {
        await respond("Usage: `/memory search <your query>`");
        return;
      }

      await respond({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Searching workspace memory...*` },
          },
        ],
      });

      try {
        const { results } = await searchMemory(
          command.team_id,
          command.user_id,
          command.channel_id,
          query,
          client,
        );

        if (results.length === 0) {
          await respond({
            replace_original: true,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `No matching threads found for *"${query}"*.`,
                },
              },
            ],
          });
          return;
        }

        const resultBlocks = results.flatMap((r) => [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                r.content.length > 300
                  ? r.content.slice(0, 300) + "..."
                  : r.content,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `<#${r.channel_id}> · ${r.message_count} message(s) · Last activity: ${r.last_message_at} · ${r.similarity}% match · <https://slack.com/archives/${r.channel_id}/p${r.thread_ts.replace(".", "")}|View thread>`,
              },
            ],
          },
          { type: "divider" },
        ]);

        await respond({
          replace_original: true,
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: "Search Results" },
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: `Results for *"${query}"*` },
            },
            ...resultBlocks,
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `MemGo · ${results.length} result(s) · <@${command.user_id}> · <!date^${Math.floor(Date.now() / 1000)}^{time}|now> · Results reflect messages up to 5 min ago`,
                },
              ],
            },
          ],
        });
      } catch (err) {
        console.error("❌ /memory search error:", err);
        await respond({
          replace_original: true,
          text: err.message,
        });
      }
      return;
    }

    if (subcommand === "help") {
      await respond(
        "Available commands: `ask`, `summarize`, `search`, `save`, `decisions`",
      );
      return;
    }

    if (subcommand === "save") {
      const isLink = query.startsWith("http");

      await respond({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: isLink
                ? "*Force-embedding thread...*"
                : "*Saving last 30 minutes of this channel...*",
            },
          },
        ],
      });

      try {
        const result = isLink
          ? await saveThread(command.team_id, command.user_id, query, client)
          : await saveChannel(
              command.team_id,
              command.user_id,
              command.channel_id,
              client,
            );

        await respond({
          replace_original: true,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: isLink
                  ? `✅ Thread saved — *${result.messageCount}* message(s) embedded.`
                  : `✅ Saved — *${result.threadCount}* thread(s), *${result.messageCount}* message(s) embedded.`,
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `MemGo · <@${command.user_id}> · <!date^${Math.floor(Date.now() / 1000)}^{time}|now>`,
                },
              ],
            },
          ],
        });
      } catch (err) {
        console.error("❌ /memory save error:", err);
        await respond({ replace_original: true, text: err.message });
      }
      return;
    }

    await respond(
      "Available commands: `ask`, `summarize`, `search`, `save`, `decisions`",
    );
  });
}
