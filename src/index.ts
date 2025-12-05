import { Redis } from "@upstash/redis";
import crypto from "crypto";
import "dotenv/config";
import { Probot } from "probot";
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

async function runReview(context: any, prNumber: number, headSha: string) {
  const config = await context.config("sherpai.yml");
  const repo = context.payload.repository;

  const files = await context.octokit.pulls.listFiles({
    owner: repo.owner.login,
    repo: repo.name,
    pull_number: prNumber,
  });

  let commentsCount = 0;

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

    const aiComments = await getAIComments(
        file.filename,
        file.patch,
        config ? JSON.stringify(config) : null
    );

    for (const comment of aiComments) {
      if (typeof comment.line !== "number") continue;

      const index = comment.line - 1;
      const target = addedLines[index];
      if (!target) continue;

      const lineHash = crypto.createHash("sha256").update(target.line).digest("hex");
      const cacheKey = `commented:${repo.name}#${prNumber}:${file.filename}:${headSha}:line-${lineHash}`;

      const alreadyCommented = await redis.get(cacheKey);
      if (alreadyCommented) {
        context.log.info(`Already commented on line ${comment.line} in ${file.filename}`);
        continue;
      }

      try {
        await context.octokit.pulls.createReviewComment({
          owner: repo.owner.login,
          repo: repo.name,
          pull_number: prNumber,
          body: comment.text,
          commit_id: headSha,
          path: file.filename,
          position: target.position,
          side: "RIGHT",
        });

        commentsCount++;

        await redis.set(cacheKey, true, { ex: 345600 }); // cache per line per commit
      } catch (err) {
        context.log.error("Failed to post review comment", err);
      }
    }
  }

  return { commentsCount };
}

export default (app: Probot) => {
  app.on("issue_comment.created", async (context) => {
    const { comment, issue } = context.payload;

    if (!issue.pull_request || comment.body.trim() !== "/review") return;

    const repo = context.payload.repository;
    const prNumber = issue.number;
    const reviewFlagKey = `review-requested:${repo.name}#${prNumber}`;

    await redis.set(reviewFlagKey, true, { ex: 86400 }); // expires after 24h

    const pr = await context.octokit.pulls.get({
      owner: repo.owner.login,
      repo: repo.name,
      pull_number: prNumber,
    });


    const { commentsCount } = await runReview(context, prNumber, pr.data.head.sha);

    await context.octokit.issues.createComment({
      owner: repo.owner.login,
      repo: repo.name,
      issue_number: prNumber,
      body: commentsCount ? `Hope you find the comments helpful. Total comments: ${commentsCount}` : `I have not found any issues in this PR.`,
    });
  });

  app.on("pull_request.synchronize", async (context) => {
    const pr = context.payload.pull_request;
    const prNumber = pr.number;
    const repo = context.payload.repository;
    const reviewFlagKey = `review-requested:${repo.name}#${prNumber}`;

    const reviewRequested = await redis.get(reviewFlagKey);
    if (!reviewRequested) {
      context.log.info("No review requested by user, skipping.");
      return;
    }

    await runReview(context, prNumber, pr.head.sha);
  });
};
