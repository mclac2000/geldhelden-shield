FROM node:18-alpine

WORKDIR /app

# Installiere native Dependencies für better-sqlite3
RUN apk add --no-cache python3 make g++ sqlite

# Kopiere package files
COPY package*.json ./
COPY tsconfig.json ./

# Installiere Dependencies
RUN npm install

# Kopiere Source Code (NUR src/ für Build)
COPY src/ ./src/

# Baue TypeScript (builds nur src/, scripts/ wird ignoriert)
RUN npm run build

# Kopiere scripts/ NACH Build (nur für get-ids, nicht für Build)
COPY scripts/ ./scripts/

# Exponiere Port (optional, für Health Checks)
EXPOSE 8080

# Starte Bot
CMD ["npm", "start"]
