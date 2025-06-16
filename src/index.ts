import "dotenv/config";
import { Probot } from "probot";
import { Redis } from "@upstash/redis";
import crypto from "crypto";
import { getAIComments } from "./services/ai.service.js";

if (!process.env.APP_ID || !process.env.PRIVATE_KEY) {
  throw new Error("Missing GitHub App credentials");
}

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error("Missing Upstash Redis credentials");
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default (app: Probot) => {
  app.on(["pull_request.opened", "pull_request.synchronize"], async (context) => {
    const config = await context.config("sherpai.yml");
    const pr = context.payload.pull_request;
    const { owner, name: repo } = context.payload.repository;
    const prNumber = pr.number;
    const headSha = pr.head.sha;

    const files = await context.octokit.pulls.listFiles({
      owner: owner.login,
      repo,
      pull_number: prNumber,
    });

    for (const file of files.data) {
      if (!file.patch) continue;

      const patchLines = file.patch.split("\n");
      const addedLines: { line: string; position: number }[] = [];

      let position = 0;
      for (const line of patchLines) {
        position++;
        if (line.startsWith("+") && !line.startsWith("+++")) {
          addedLines.push({ line: line.slice(1), position });
        }
      }

      if (addedLines.length === 0) continue;

      const patchForAI = addedLines.map(l => l.line).join("\n");

      const aiComments = await getAIComments(
          file.filename,
          patchForAI,
          config ? JSON.stringify(config) : null
      );

      for (const comment of aiComments) {
        if (typeof comment.line !== "number") continue;

        const index = comment.line - 1;
        const target = addedLines[index];
        if (!target) continue;

        const lineHash = crypto.createHash("sha256").update(target.line).digest("hex");
        const cacheKey = `commented:${repo}#${prNumber}:${file.filename}:line-${lineHash}`;

        const alreadyCommented = await redis.get(cacheKey);
        if (alreadyCommented) {
          context.log.info(`Already commented on line ${comment.line} in ${file.filename}`);
          continue;
        }

        try {
          await context.octokit.pulls.createReviewComment({
            owner: owner.login,
            repo,
            pull_number: prNumber,
            body: comment.text,
            commit_id: headSha,
            path: file.filename,
            position: target.position,
            side: "RIGHT",
          });

          await redis.set(cacheKey, true, { ex: 345600 }); // Cache this comment for 4 days
        } catch (err) {
          context.log.error("Failed to post review comment", err);
        }
      }
    }
  });
};
