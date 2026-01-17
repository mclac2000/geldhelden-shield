FROM node:18-alpine

WORKDIR /app

# Docker CLI für Log-Zugriff
RUN apk add --no-cache docker-cli

# Package files kopieren
COPY package*.json ./
COPY tsconfig.json ./

# Dependencies installieren
RUN npm install

# Source kopieren
COPY src/ ./src/

# TypeScript kompilieren
RUN npm run build

# Starte Monitor (Scheduler-Modus)
CMD ["npm", "start"]
