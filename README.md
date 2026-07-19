# Employee MCP Server (Mongo + AI Pipeline)

Architecture is now:

1. AI Planner
2. Mongo Executor
3. AI Analysis Result

No SQL path is used.

## MongoDB

Default URI:

`mongodb://admin:password@localhost:27017`

On startup, the server seeds large dummy administration-style data (1500 employees) into:

- DB: `employee_admin`
- Collection: `employees`

## Common model environment

Create `.env` (or set environment variables):

```powershell
AI_PROVIDER=nvidia
AI_TIMEOUT_MS=30000

MONGO_URI=mongodb://admin:password@localhost:27017
MONGO_DB_NAME=employee_admin
MONGO_COLLECTION=employees

OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_CHAT_PATH=/api/chat

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com

CLAUDE_API_KEY=
CLAUDE_MODEL=claude-3-5-sonnet-20241022
CLAUDE_BASE_URL=https://api.anthropic.com
CLAUDE_MAX_TOKENS=2048

NVIDIA_API_KEY=
NVIDIA_MODEL=google/gemma-4-31b-it
NVIDIA_BASE_URL=https://integrate.api.nvidia.com
NVIDIA_MAX_TOKENS=16384
NVIDIA_TOP_P=0.95
NVIDIA_ENABLE_THINKING=true
```

Supported providers:

- `ollama`
- `openai`
- `claude`
- `nvidia`

## Run

```powershell
npm install
node test-client.mjs --tests
```

Interactive:

```powershell
node test-client.mjs
```

## Example queries

- `Who has the highest salary?`
- `Who earns the least?`
- `What is the difference between highest and lowest salary?`
- `What is the average salary?`
- `How many employees are there?`
- `List employees in Administration`
