# KRONVOX MCP server image.
# Lets a sandbox (e.g. Glama) start the server and answer introspection
# (tools/list) without a device. The phone-control tools need adb + a device
# at call time; listing the tools does not.
FROM node:20-slim

WORKDIR /app
COPY . .

RUN npm install --no-audit --no-fund \
 && npm run build -w @kronvox/control \
 && npm run build -w @kronvox/mcp

ENV KRONVOX_ADB=adb

# stdio MCP server
CMD ["node", "packages/mcp/dist/server.js"]
