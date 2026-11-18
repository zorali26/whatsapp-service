FROM node:20-bookworm-slim

# Tarayicisiz (Baileys) — hafif imaj, Render Free plana sigar
ENV NODE_ENV=production
ENV DATA_DIR=/data

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 3000
CMD ["node", "src/index.js"]
