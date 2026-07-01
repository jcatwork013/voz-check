# ── build ────────────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS build
WORKDIR /src

# modernc.org/sqlite is pure Go → CGO disabled, fully static binary.
ENV CGO_ENABLED=0 GOOS=linux

COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -trimpath -ldflags="-s -w" -o /out/vozcheck .

# ── runtime ──────────────────────────────────────────────────────────────────
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget && adduser -D -u 10001 voz
ENV TZ=Asia/Ho_Chi_Minh VOZ_DB_PATH=/data/vozcheck.db VOZ_ADDR=:8080
WORKDIR /app
COPY --from=build /out/vozcheck /app/vozcheck
RUN mkdir -p /data && chown -R voz:voz /data
USER voz
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8080/api/health >/dev/null 2>&1 || exit 1
ENTRYPOINT ["/app/vozcheck"]
