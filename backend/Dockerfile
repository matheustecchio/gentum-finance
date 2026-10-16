FROM golang:1.26.9-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /gentum ./cmd/server

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -S gentum && adduser -S gentum -G gentum
USER gentum
WORKDIR /app
COPY --from=build /gentum /app/gentum
EXPOSE 8080
ENTRYPOINT ["/app/gentum"]
