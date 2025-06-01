import 'dotenv/config';
import { Probot } from "probot";
import { getAIComments } from "./services/ai.service.js";

if (!process.env.APP_ID) {
  throw new Error('APP_ID environment variable is not set');
}
if (!process.env.PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY environment variable is not set');
}

export default (app: Probot) => {
  app.on(['pull_request.opened', 'pull_request.synchronize'], async context => {
    const pr = context.payload.pull_request;
    const files = await context.octokit.pulls.listFiles({
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      pull_number: pr.number,
    });

    for (const file of files.data) {
      if (file.patch) {
        const comments = await getAIComments(file.filename, file.patch);
        for (const c of comments) {
          await context.octokit.pulls.createReviewComment({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            pull_number: pr.number,
            body: c.text,
            commit_id: pr.head.sha,
            path: file.filename,
            line: c.line,
            side: 'RIGHT',
          });
        }
      }
    }
  });
};
