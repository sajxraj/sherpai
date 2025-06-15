<p align="center">
  <img src="assets/sherpai-full.png" alt="Sherpai Logo" width="200"/>
</p>

# Sherpai

Inspired by the **Sherpa** people of the Himalayas, known for their expertise and guidance in navigating difficult paths. Our bot is designed to bring that same thoughtful support to your code.

## Description

Sherpai is a GitHub App built with [Probot](https://github.com/probot/probot) that helps developers to review their code and provide constructive feedback.

## Custom Rules

You can create a sherpai.yml file inside the .github directory and provide it custom rules for you codebase.
For example;

```yml
rules:
  - All variable must be camelCase
  - Do not throw error without message
```

## Setup

### Local Development

1. Clone this repository

```sh
git clone https://github.com/sajxraj/sherpai.git
cd sherpai
```

2. Install dependencies

```sh
npm install
```

3. Create a GitHub App

   - Go to [GitHub Apps settings](https://github.com/settings/apps)
   - Click "New GitHub App"
   - Fill in the following details:
     - GitHub App name: `sherpai`
     - Homepage URL: `http://localhost:3000`
     - Webhook URL: `https://<ngrok-site>.app/api/github/webhooks`
     - Webhook secret: Generate a random string
     - Permissions:
       - Repository permissions:
         - `Pull requests`: Read & Write
         - `Contents`: Read
         - `Metadata`: Read
       - Subscribe to events: `Pull request`, `Pull request review`, `Pull request review comment`

4. Generate a private key

   - In your GitHub App settings, click "Generate a private key"
   - Save the downloaded `.pem` file securely

5. Configure environment variables

   - Create a `.env` file in the root directory
   - Add the following variables:

   ```
   APP_ID=<your-app-id>
   PRIVATE_KEY=<private-key-from-pem-file>
   WEBHOOK_SECRET=<your-webhook-secret>
   OPENAI_API_KEY=<your-openai-api-key>
   ```

6. Run the bot

```sh
yarn start
```

### Docker Setup

```sh
# 1. Build container
docker build -t sherpai .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> sherpai
```

## Contributing

If you have suggestions for how `sherpai` could be improved, or want to report a bug, open an issue! We'd love all and any contributions.
