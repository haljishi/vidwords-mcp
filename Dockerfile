ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE}

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src/ ./src/

USER node

# Introspection (initialize, tools/list) works with no credentials; a tool CALL
# needs VIDWORDS_API_TOKEN — get a free one at https://vidwords.com/register
ENTRYPOINT ["node", "src/index.js"]
