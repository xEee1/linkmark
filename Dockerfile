FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY db ./db
ENV PORT=3001
EXPOSE 3001
CMD ["node", "src/server.js"]
