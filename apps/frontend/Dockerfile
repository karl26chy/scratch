# Lightweight Dockerfile for React Vite frontend
FROM node:20-alpine AS dev

WORKDIR /app

# Copy root workspace configurations
COPY package.json ./
COPY apps/frontend/package.json ./apps/frontend/

# Install dependencies
RUN npm install

# Copy frontend source
COPY apps/frontend ./apps/frontend

WORKDIR /app/apps/frontend

EXPOSE 3000

ENV VITE_API_URL=http://localhost:4000/api/v1

CMD ["npm", "run", "dev"]
