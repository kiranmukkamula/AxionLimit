# Use lightweight Node.js 18 Alpine image
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Install app dependencies using lockfile for reproducible builds
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source code with unprivileged ownership
COPY --chown=node:node . .

# Switch to standard unprivileged user
USER node

# Expose backend port
EXPOSE 5000

# Set production environment defaults
ENV NODE_ENV=production
ENV PORT=5000

# Container healthcheck querying existing /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

# Start server
CMD [ "node", "server.js" ]
