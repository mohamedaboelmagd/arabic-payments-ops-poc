FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package-lock.json ./backend/
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci && npm ci --prefix backend && npm ci --prefix frontend
COPY . .
RUN npm run build --prefix backend && npm run build --prefix frontend
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DEMO_MODE=true
EXPOSE 3000
CMD ["node", "backend/dist/server.js"]
