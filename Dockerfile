FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy built files
COPY dist/ ./dist/

# Create data directory
RUN mkdir -p /data

# Environment variables
ENV TAI_DATA_DIR=/data
ENV NODE_ENV=production

# Expose revenue server port
EXPOSE 3402

# Run the agent
CMD ["node", "dist/tai-main.js", "--run"]
