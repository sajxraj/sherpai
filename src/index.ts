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
      
      if (!appInfo?.name) {
        context.log.error('Could not get app name');
        return;
      }

      context.log.info(`Requesting review from app: ${appInfo.name}`);

      // Request a review from the app
      try {
        await context.octokit.pulls.requestReviewers({
          owner,
          repo,
          pull_number: prNumber,
          reviewers: [appInfo.name],
        });
        context.log.info('Successfully requested review from app');
      } catch (error) {
        context.log.error('Failed to request review from app:', error);
      }

      const files = await context.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      for (const file of files.data) {
        if (!file.patch) continue;

        const patchHash = hashPatch(file.patch);
        const cacheKey = `${repo}#${prNumber}:${file.filename}:${patchHash}`;
        
        context.log.info(`Checking cache for ${file.filename} with key: ${cacheKey}`);

        const cachedComments = await redis.get(cacheKey);
        if (cachedComments) {
          context.log.info(`Using cached result for ${file.filename} - skipping comment posting`);
          continue;
        }

        context.log.info(`No cache found for ${file.filename} - generating new comments`);

        const comments = await getAIComments(
          file.filename,
          file.patch,
          config ? JSON.stringify(config) : null
        );

        // Cache the comments with a 4-day expiration
        await redis.set(cacheKey, JSON.stringify(comments), { ex: 345600 });

        // Parse the diff to get line numbers and hunks
        const diffLines = file.patch.split('\n');
        let currentHunk = '';
        let lineNumber = 0;
        let inHunk = false;

        for (const c of comments) {
          if (c.line) {
            // Find the hunk containing this line
            for (const line of diffLines) {
              if (line.startsWith('@@')) {
                currentHunk = line;
                inHunk = true;
                continue;
              }
              if (inHunk && line.startsWith('+')) {
                lineNumber++;
                if (lineNumber === c.line) {
                  await context.octokit.pulls.createReviewComment({
                    owner,
                    repo,
                    pull_number: prNumber,
                    body: c.text,
                    commit_id: headSha,
                    path: file.filename,
                    position: lineNumber,
                    diff_hunk: currentHunk,
                    side: "RIGHT",
                  });
                  break;
                }
              }
            }
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
