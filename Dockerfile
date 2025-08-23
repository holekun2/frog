# Use Node.js 18 LTS
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache git openssh-client bash jq

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cli/package.json ./apps/cli/
COPY packages/*/package.json ./packages/*/

# Install pnpm
RUN npm install -g pnpm@10.13.1

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the project
RUN pnpm build

# Set up git (required for Cyrus)
RUN git config --global user.name "Cyrus Agent" && \
    git config --global user.email "cyrus@railway.app"

# Create cyrus home directory
RUN mkdir -p /root/.cyrus

# Expose port
EXPOSE 3456

# Set environment variables
ENV NODE_ENV=production
ENV CYRUS_HOST_EXTERNAL=true
ENV CYRUS_BASE_URL=$RAILWAY_STATIC_URL
ENV CYRUS_SERVER_PORT=3456

# Start the CLI
WORKDIR /app/apps/cli
CMD ["node", "app.js"]