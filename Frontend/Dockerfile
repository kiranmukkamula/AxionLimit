# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build React static assets using Node.js 18 Alpine
# ─────────────────────────────────────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Copy dependency definitions and install using clean install
COPY package*.json ./
RUN npm ci

# Copy frontend source files and compile production bundle
COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Serve static files and reverse proxy API with lightweight Nginx
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.25-alpine

# Copy built production assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration with reverse proxy rules
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port 80
EXPOSE 80

# Run Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
