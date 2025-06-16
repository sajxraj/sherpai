import "dotenv/config";
import { Probot } from "probot";
import { Redis } from "@upstash/redis";
import crypto from "crypto";
import { getAIComments } from "./services/ai.service.js";

if (!process.env.APP_ID) {
  throw new Error("APP_ID environment variable is not set");
}
if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY environment variable is not set");
}
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables must be set");
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function hashPatch(patch: string): string {
  return crypto.createHash("sha256").update(patch).digest("hex");
}

export default (app: Probot) => {
  app.on(
    ["pull_request.opened", "pull_request.synchronize"],
    async (context) => {
      const config = await context.config("sherpai.yml");
      const pr = context.payload.pull_request;
      const owner = context.payload.repository.owner.login;
      const repo = context.payload.repository.name;
      const prNumber = pr.number;
      const headSha = pr.head.sha;

      const { data: appInfo } = await context.octokit.apps.getAuthenticated();
      
      if (!appInfo?.slug) {
        context.log.error('Could not get app slug');
        return;
      }

      await context.octokit.pulls.requestReviewers({
        owner,
        repo,
        pull_number: prNumber,
        reviewers: [appInfo.slug],
      });

      const files = await context.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      for (const file of files.data) {
        if (!file.patch) continue;

        const patchHash = hashPatch(file.patch);
        const cacheKey = `${repo}#${prNumber}:${file.filename}:${headSha}:${patchHash}`;

        const cachedComments = await redis.get(cacheKey);
        if (cachedComments) {
          context.log.info(`Using cached result for ${file.filename} - skipping comment posting`);
          continue;
        }

        const comments = await getAIComments(
          file.filename,
          file.patch,
          config ? JSON.stringify(config) : null
        );

        // Cache the comments with a 4-day expiration
        await redis.set(cacheKey, JSON.stringify(comments), { ex: 345600 });

        for (const c of comments) {
          if (c.line) {
            await context.octokit.pulls.createReviewComment({
              owner,
              repo,
              pull_number: prNumber,
              body: c.text,
              commit_id: headSha,
              path: file.filename,
              line: c.line,
              side: "RIGHT",
              position: c.line,
              subject_type: "line",
            });
          } else {
            await context.octokit.pulls.createReview({
              owner,
              repo,
              pull_number: prNumber,
              body: c.text,
              event: "COMMENT",
            });
          }
        }
      }
    }
  );
};
