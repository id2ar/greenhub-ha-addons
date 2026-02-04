
ARG BUILD_FROM
FROM $BUILD_FROM

# Node runtime (alpine)
RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --only=production

COPY src ./src

CMD ["node", "src/index.js"]
