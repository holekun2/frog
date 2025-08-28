# Frog 🐸

<div>
  <a href="https://github.com/johnjames9007/frog">
    <img src="https://img.shields.io/badge/Forked%20from-Cyrus-green?style=for-the-badge&logoColor=black&labelColor=333333" alt="Forked from Cyrus">
  </a><br />
  <a href="https://github.com/johnjames9007/frog/actions">
    <img src="https://github.com/johnjames9007/frog/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
</div>

AI development agent for Linear powered by Claude Code. Frog monitors Linear issues assigned to it, creates isolated Git worktrees for each issue, runs Claude Code sessions to process them, and posts responses back to Linear as comments, all from the safety and security of your own computer.

**Note: Frog is a self-hosted fork of Cyrus with its own Cloudflare Workers proxy. You bring your own Claude Code keys/billing and get a fully independent setup without subscription requirements.**

## Installation

### From Source (recommended)

```bash
git clone https://github.com/johnjames9007/frog.git
cd frog
pnpm install
pnpm build
cd apps/cli
npm install -g .
```

### Verify Installation

```bash
frog --version
frog --help
```

## Quick Start

#### Optional

(optional, if you want Cyrus to push PRs to Github): Have [`gh`](https://cli.github.com/) (Github) installed. `brew install gh` or find your platform instructions at [this link](https://cli.github.com/). Authenticate using `gh auth login` as the user you want PRs to be submitted via.

#### Run the main program:

```bash
frog
```

#### Follow the prompts to:

- Connect your Linear workspace via OAuth (uses built-in Cloudflare Workers proxy)
- Configure your repository settings
- Set up allowed tools (security configuration), and optionally, mcp servers

#### Benefit

Keep `frog` running, and the agent will start monitoring issues assigned to you in Linear and process them automatically, on your very own device.

## Configuration

After initial setup, Frog stores your configuration in `~/.frog/config.json`. You can edit this file to customize the following settings:

### Repository Configuration

Each repository in the `repositories` array can have these optional properties:

#### `allowedTools` (array of strings)
Controls which tools Claude can use when processing issues. Default: all standard tools plus `Bash(git:*)` and `Bash(gh:*)`.

Examples:
- `["Read(**)", "Edit(**)", "Bash(git:*)", "Task"]` - Allow reading, editing, git commands, and task management
- `["Read(**)", "Edit(**)", "Bash(npm:*)", "WebSearch"]` - Allow reading, editing, npm commands, and web search
- `["Read(**)", "Edit(**)", "mcp__github"]` - Allow all tools from the GitHub MCP server
- `["Read(**)", "Edit(**)", "mcp__github__search_repositories"]` - Allow only the search_repositories tool from GitHub MCP

For security configuration details, see: https://docs.anthropic.com/en/docs/claude-code/settings#permissions

#### `mcpConfigPath` (string or array of strings)
Path(s) to MCP (Model Context Protocol) configuration files. MCP allows Claude to access external tools and data sources like databases or APIs.

Can be specified as:
- A single string: `"mcpConfigPath": "/home/user/myapp/mcp-config.json"`
- An array of strings: `"mcpConfigPath": ["/home/user/myapp/mcp-base.json", "/home/user/myapp/mcp-local.json"]`

When multiple files are provided, configurations are composed together. Later files override earlier ones for the same server names.

Expected file format:
```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "command-to-run",
      "args": ["arg1", "arg2"]
    }
  }
}
```

Learn more about MCP: https://docs.anthropic.com/en/docs/claude-code/mcp

#### `teamKeys` (array of strings)
Routes Linear issues from specific teams to this repository. When specified, only issues from matching teams trigger Cyrus.

Example: `["CEE", "FRONT", "BACK"]` - Only process issues from teams CEE, FRONT, and BACK

#### `projectKeys` (array of strings)
Routes Linear issues from specific projects to this repository. When specified, only issues belonging to the listed Linear projects will be processed by this repository.

Example: `["Mobile App", "Web Platform", "API Service"]` - Only process issues that belong to these Linear projects

Note: This is useful when you want to separate work by project rather than by team, especially in organizations where multiple projects span across teams.

#### `routingLabels` (array of strings)
Routes Linear issues with specific labels to this repository. This is useful when you have multiple repositories handling issues from the same Linear team but want to route based on labels (e.g., "backend" vs "frontend" labels).

Example: `["backend", "api"]` - Only process issues that have the "backend" or "api" label

### Routing Priority Order

When multiple routing configurations are present, Cyrus evaluates them in the following priority order:

1. **`routingLabels`** (highest priority) - Label-based routing
2. **`projectKeys`** (medium priority) - Project-based routing  
3. **`teamKeys`** (lowest priority) - Team-based routing

If an issue matches multiple routing configurations, the highest priority match will be used. For example, if an issue has a label that matches `routingLabels` and also belongs to a project in `projectKeys`, the label-based routing will take precedence.

#### `labelPrompts` (object)
Routes issues to different AI modes based on Linear labels and optionally configures allowed tools per mode.

**Simple format (labels only):**
```json
{
  "debugger": ["Bug"],
  "builder": ["Feature", "Improvement"],
  "scoper": ["PRD"]
}
```

**Advanced format (with dynamic tool configuration):**
```json
{
  "debugger": {
    "labels": ["Bug"],
    "allowedTools": "readOnly"  // or ["Read(**)", "Task"] or "safe" or "all"
  },
  "builder": {
    "labels": ["Feature", "Improvement"],
    "allowedTools": "safe"
  },
  "scoper": {
    "labels": ["PRD"],
    "allowedTools": ["Read(**)", "WebFetch", "mcp__linear"]
  }
}
```

**Modes:**
- **debugger**: Systematic problem investigation mode
- **builder**: Feature implementation mode
- **scoper**: Requirements analysis mode

**Tool Presets:**
- **`"readOnly"`**: Only tools that read/view content (7 tools)
  - `Read(**)`, `WebFetch`, `WebSearch`, `TodoRead`, `NotebookRead`, `Task`, `Batch`
- **`"safe"`**: All tools except Bash (10 tools)
  - All readOnly tools plus: `Edit(**)`, `TodoWrite`, `NotebookEdit`
- **`"all"`**: All available tools including Bash (11 tools)
  - All safe tools plus: `Bash`
- **Custom array**: Specify exact tools needed, e.g., `["Read(**)", "Edit(**)", "Task"]`

Note: Linear MCP tools (`mcp__linear`) are always included automatically.

### Global Configuration

In addition to repository-specific settings, you can configure global defaults:

#### `promptDefaults` (object)
Sets default allowed tools for each prompt type across all repositories. Repository-specific configurations override these defaults.

```json
{
  "promptDefaults": {
    "debugger": {
      "allowedTools": "readOnly"
    },
    "builder": {
      "allowedTools": "safe"
    },
    "scoper": {
      "allowedTools": ["Read(**)", "WebFetch", "mcp__linear"]
    }
  }
}
```

### Example Configuration

```json
{
  "promptDefaults": {
    "debugger": {
      "allowedTools": "readOnly"
    },
    "builder": {
      "allowedTools": "safe"
    }
  },
  "repositories": [{
    "id": "workspace-123456",
    "name": "my-app",
    "repositoryPath": "/path/to/repo",
    "allowedTools": ["Read(**)", "Edit(**)", "Bash(git:*)", "Bash(gh:*)", "Task"],
    "mcpConfigPath": "./mcp-config.json",
    "teamKeys": ["BACKEND"],
    "projectKeys": ["API Service", "Backend Infrastructure"],
    "routingLabels": ["backend", "api", "infrastructure"],
    "labelPrompts": {
      "debugger": {
        "labels": ["Bug", "Hotfix"],
        "allowedTools": "all"  // Override global default for this repo
      },
      "builder": {
        "labels": ["Feature"]
        // Uses global promptDefaults.builder.allowedTools ("safe")
      },
      "scoper": {
        "labels": ["RFC", "Design"]
        // Falls back to repository allowedTools or global defaults
      }
    }
  }]
}
```

### Tool Configuration Priority

When determining allowed tools, Cyrus follows this priority order:
1. Repository-specific prompt configuration (`labelPrompts.debugger.allowedTools`)
2. Global prompt defaults (`promptDefaults.debugger.allowedTools`)
3. Repository-level allowed tools (`allowedTools`)
4. Global default allowed tools
5. Safe tools fallback (all tools except Bash)

## Setup on Remote Host

<details>
  
If you want to host Frog on a remote machine for 24/7 availability, follow these steps on a newly created virtual machine to get started.

1. Install `gh`, `npm`, `git`, and `pnpm`

```bash
apt install -y gh npm git
npm install -g pnpm
```

2. Install `claude` and clone `frog`

```bash
npm install -g @anthropic-ai/claude-code
git clone https://github.com/johnjames9007/frog.git
cd frog
pnpm install
pnpm build
cd apps/cli
npm install -g .
```

3. Set up `git` CLI

```bash
ssh-keygen
# Follow the prompts then paste the public key into GitHub

git config --global user.name "John Doe"
git config --global user.email "john.doe@example.com"
```

4. Login to `gh` and paste in an authentication token

```bash
gh auth login
```

5. Clone your repository via SSH into a folder of your choice

```bash
git clone git@github.com:your-org/your-repo.git
```

6. Authenticate `claude`

```bash
claude
# Then follow the prompts


# If you are on subscription based pricing, you can verify this is setup properly by running `/cost` in the claude console and seeing if it specifies your subscription plan.
```

7. Configure an environment variable file to specify your domain and webhook settings

```bash
# Server configuration (handles both webhooks and OAuth callbacks)
CYRUS_SERVER_PORT=3456

# Base URL configuration (required for Linear integration - handles both webhooks and OAuth)
CYRUS_BASE_URL=<your publicly accessible URL>

# Note: Frog uses a built-in Cloudflare Workers proxy, so no additional proxy setup needed
# Legacy environment variables (still supported for backward compatibility)
# CYRUS_WEBHOOK_BASE_URL=<url>  # Use CYRUS_BASE_URL instead
# CYRUS_WEBHOOK_PORT=3456  # Use CYRUS_SERVER_PORT instead
```

### Webhook Configuration Options

Frog needs to receive webhooks from Linear, so you need a publicly accessible URL. Choose one of these options:

**Note:** Frog includes a built-in Cloudflare Workers proxy that handles OAuth and webhook routing automatically.

**Option 1: Using ngrok (for development/testing)**
```bash
# In a separate tmux session
tmux new -s ngrok-session
ngrok http 3456
# Note the ngrok URL (e.g., https://abc123.ngrok-free.app)
# Ctrl+B then D to detach

# Set the environment variables
export CYRUS_BASE_URL=https://abc123.ngrok-free.app
export CYRUS_SERVER_PORT=3456
```

**Option 2: Direct server with domain/IP**
```bash
# If your server has a public IP or domain
export CYRUS_BASE_URL=https://your-domain.com
# or
export CYRUS_BASE_URL=http://your-server-ip
export CYRUS_SERVER_PORT=3456
```

**Option 3: Behind reverse proxy (nginx, caddy, etc.)**
```bash
# Configure your reverse proxy to forward /webhook and /callback to localhost:3456
export CYRUS_BASE_URL=https://your-domain.com
export CYRUS_SERVER_PORT=3456
```

8. Start the frog server

```bash
frog --env-file=<path>

# Optional
# Start frog in a tmux session for
tmux new -s frog-session # Can name whatever you'd like
# Ctrl-B -> D to exit
# To later 'attach' to it again
tmux attach -t frog-session
```
</details>


## Repository Setup Script

Cyrus supports an optional `frog-setup.sh` script that runs automatically when creating new git worktrees for issues. This is useful for repository-specific initialization tasks.

### How it works

1. Place a `frog-setup.sh` script in your repository root
2. When Cyrus processes an issue, it creates a new git worktree
3. If the setup script exists, Cyrus runs it in the new worktree with these environment variables:
   - `LINEAR_ISSUE_ID` - The Linear issue ID
   - `LINEAR_ISSUE_IDENTIFIER` - The issue identifier (e.g., "CEA-123")
   - `LINEAR_ISSUE_TITLE` - The issue title

### Example Usage

```bash
#!/bin/bash
# frog-setup.sh - Repository initialization script

# Copy environment files from a central location
cp /Users/agentops/code/ceedar/packages/evals/.env packages/evals/.env

# Install dependencies if needed
# npm install

# Set up test databases, copy config files, etc.
echo "Repository setup complete for issue: $LINEAR_ISSUE_IDENTIFIER"
```

Make sure the script is executable: `chmod +x frog-setup.sh`

## Submitting Work To GitHub

When Claude creates PRs using the `gh` CLI tool, it uses your local GitHub authentication. This means:

- All PRs and commits will be created under your GitHub account
- Comments and mentions in the PR will notify your account
- Review requests will be attributed to you
- Your repository permissions apply to all operations
- The only indication that Claude assisted is the "Co-Authored-By" commit trailer

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Credits

**Frog** is a fork of [Cyrus](https://github.com/ceedaragents/cyrus) originally developed by [Ceedar](https://ceedar.ai/).

This project builds on the technologies built by the awesome teams at Linear, and Claude by Anthropic:

- [Linear API](https://linear.app/developers)
- [Anthropic Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)
- [Cloudflare Workers](https://workers.cloudflare.com/) (for the proxy infrastructure)

---

_This README was last updated: August 28 2025_
