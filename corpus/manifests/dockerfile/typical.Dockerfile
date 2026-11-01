# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

# Runtime stage
FROM nginx:1.25
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
