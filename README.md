<div align="center">

# ⚡ codesaga-ws — Socket Gateway Server

**The real-time WebSocket backbone of CodeSaga**  
*Socket.IO gateway · Redis Streams producer · Pub/Sub subscriber · Prometheus metrics*

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white)](https://kubernetes.io/)

</div>

---

## 🗺️ Ecosystem Navigation — You Are Here

> This repository is **Module 2 of 5** in the **CodeSaga Distributed System**. Every module is an independent, deployable service. Navigate between them easily:

| Module | Repo | Role | Docker Image |
|--------|------|------|--------------|
| ① Client | [`codesaga`](https://github.com/jamesnagar11/codesaga) | Next.js Client — UI, Auth, Problem Pages | `jamesnagar/codesaga-client` |
| **② You are here** | [`codesaga-ws`](https://github.com/jamesnagar11/codesaga-ws) | WebSocket server, Redis Streams producer, Pub/Sub subscriber | `jamesnagar/codesaga-ws` |
| ③ Execution Engine | [`codesaga-engine`](https://github.com/jamesnagar11/codesaga-engine) | Sandboxed code runner (Java, C++, Python) | `jamesnagar/codesaga-engine` |
| ④ Bulk DB Executor | [`bulk-executor`](https://github.com/jamesnagar11/bulk-executor) | Batches up to 100 DB writes in a single SQL statement | `jamesnagar/codesaga-bulk` |
| ⑤ Cron Sweeper | [`bulk-executor-janitor`](https://github.com/jamesnagar11/bulk-executor-janitor) | Auto-claims stale jobs, reconciles Redis memory | `jamesnagar/codesaga-cron` |
| ⚙️ GitOps Config | [`staging-ops`](https://github.com/jamesnagar11/staging-ops) | Kubernetes manifests managed by ArgoCD | — |

---

## 🏗️ Full System Architecture

```
                           ┌─────────────────────────────────────────────────────────────────────┐
                           │                     Kubernetes Cluster (k8s)                         │
                           │                                                                       │
 ┌──────────┐   HTTPS/WS   │  ┌────────────────────────────────────────────────────────────────┐ │
 │  Users   │─────────────►│  │           NGINX Ingress + Load Balancer                        │ │
 └──────────┘              │  └──────┬────────────────────────────────┬────────────────────────┘ │
                           │         │ /                              │ /socket.io               │
                           │  ┌──────▼──────┐             ┌──────────▼──────────────────┐       │
                           │  │  CodeSaga   │◄────────────►│  ★ Socket Servers (THIS)    │       │
                           │  │ (Next.js)   │  REST/Auth  │  KEDA: 1 pod / 10k users    │       │
                           │  └─────────────┘             └──┬──────────────────────┬───┘       │
                           │                                  │ produce               │ subscribe │
                           │                    ┌─────────────▼──┐            ┌──────▼────────┐  │
                           │                    │ Redis Stream    │            │ Redis Pub/Sub │  │
                           │                    │ events:code     │            │ Channels      │  │
                           │                    └─────────────────┘            └───────────────┘  │
                           └─────────────────────────────────────────────────────────────────────┘
```

---

## 📋 What This Module Does

`codesaga-ws` is the **real-time nervous system** of the platform. It sits between the Next.js client and the distributed backend workers — handling all WebSocket connections, routing code submissions into Redis Streams, and delivering execution results back to the exact user who submitted in real-time.

### Responsibilities

| Concern | How it's handled |
|---------|-----------------|
| **Accept user connections** | Socket.IO server on port `9090` |
| **Receive code submissions** | Listens on `codeRequestQueue` socket event |
| **Enqueue for execution** | Publishes to `codesaga:events:code` Redis Stream |
| **Receive execution results** | Subscribes to `code:result:{server-uuid}` Pub/Sub channel |
| **Deliver real-time verdict** | Emits `codeResponse` to the specific `socketId` |
| **Queue DB write jobs** | Produces to `codesaga:events:db` Redis Stream |
| **Expose metrics** | `GET /metrics` — Prometheus-compatible endpoint |
| **Health check** | `GET /health` — used by k8s liveness probe |

---

## 🔄 Data Flow (This Module)

```
┌──────────────────────────────────────────────────────────────────┐
│                    codesaga-ws  (this service)                    │
│                                                                    │
│   User connects via Socket.IO                                     │
│           │                                                        │
│           │ event: codeRequestQueue { code, language, ... }       │
│           ▼                                                        │
│   Redis Stream PRODUCE ──► codesaga:events:code ──► Exec Workers  │
│                                                                    │
│   Redis Pub/Sub SUBSCRIBE ◄── code:result:{server-uuid}           │
│           │                   (published by Execution Engine)      │
│           │                                                        │
│           ▼                                                        │
│   socket.to(socketId).emit('codeResponse', result)               │
│           │                                                        │
│           │ also produces DB write job:                            │
│           ▼                                                        │
│   Redis Stream PRODUCE ──► codesaga:events:db ──► Bulk Executor   │
└──────────────────────────────────────────────────────────────────┘
```

### Why each socket server subscribes to its own Pub/Sub channel?
Each pod runs as a unique subscriber (`code:result:{server-uuid}`). When an execution engine worker publishes the result, **only the socket server that originally received the request** will get it — ensuring the result is delivered to the correct user even across a cluster of 20 socket servers. This is the key to horizontal scalability.

---

## 📊 Performance & Scale Metrics

| Scenario | Without Scaling | With Scaling |
|----------|----------------|--------------|
| Concurrent users | ~1,000 per server | **10,000 per server × up to 20 pods = 200,000** |
| Autoscaling trigger | — | Prometheus metric: `codesaga_ws_active_users` scraped by KEDA |
| Scale-to-zero | No | Yes (KEDA + Prometheus) |
| Deployment strategy | Manual | Zero-touch ArgoCD GitOps |

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (Node.js 22) |
| HTTP Server | Express 5 |
| WebSocket | Socket.IO 4 |
| Message Queue | Redis Streams (`ioredis` / `redis` v6) |
| Pub/Sub | Redis Pub/Sub |
| Metrics | `prom-client` (Prometheus) |
| Container | Docker (node:22-alpine, multi-stage) |
| Autoscaling | KEDA (Prometheus scaler) |

---

## ⚙️ Local Setup

### Prerequisites
- Node.js 22+
- Redis (local: `docker run -d -p 6379:6379 redis:7-alpine`)
- A running instance of [`codesaga`](https://github.com/jamesnagar11/codesaga) (the Next.js client)

---

### Method 1 — Manual Installation

```bash
# 1. Clone the repository
git clone https://github.com/jamesnagar11/codesaga-ws.git
cd codesaga-ws

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env   # then fill in the values below

# 4. Build and start
npm run dev
```

Server starts on `http://localhost:9090`.

---

### Method 2 — Docker (Build Locally)

```bash
docker build -t codesaga-ws .

docker run -d -p 9090:9090 \
  -e NEXT_URL=http://localhost:3000 \
  -e PORT=9090 \
  -e REDIS_URL=redis://localhost:6379 \
  -e STREAM_KEY=codesaga:events:code \
  -e MAXLEN_APPROX=10000 \
  -e CLAIM_MIN_IDLE_MS=15000 \
  -e BULK_STREAM_KEY=codesaga:events:db \
  -e BULK_MAXLEN_APPROX=10000 \
  -e BULK_CLAIM_MIN_IDLE_MS=15000 \
  codesaga-ws
```

---

### Method 3 — Docker (Pre-built Image from DockerHub) ⚡ Fastest

```bash
docker run -d -p 9090:9090 \
  -e NEXT_URL=http://localhost:3000 \
  -e PORT=9090 \
  -e REDIS_URL=redis://localhost:6379 \
  -e STREAM_KEY=codesaga:events:code \
  -e MAXLEN_APPROX=10000 \
  -e CLAIM_MIN_IDLE_MS=15000 \
  -e BULK_STREAM_KEY=codesaga:events:db \
  -e BULK_MAXLEN_APPROX=10000 \
  -e BULK_CLAIM_MIN_IDLE_MS=15000 \
  jamesnagar/codesaga-ws:latest
```

---

### Method 4 — Run Full Platform (All 5 Services)

> See the [full Docker Compose setup in the main client repo →](https://github.com/jamesnagar11/codesaga#method-4--run-full-platform-all-5-services-with-docker-compose)

---

## 🌍 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | ✅ | `9090` | Port the server listens on |
| `NEXT_URL` | ✅ | — | CORS origin — URL of the Next.js client |
| `REDIS_URL` | ✅ | `redis://localhost:6379` | Redis connection URL |
| `STREAM_KEY` | ✅ | `codesaga:events:code` | Redis Stream key for code execution jobs |
| `MAXLEN_APPROX` | ✅ | `10000` | Max approximate length of the code stream |
| `CLAIM_MIN_IDLE_MS` | ✅ | `15000` | Minimum idle time (ms) before a job can be reclaimed |
| `BULK_STREAM_KEY` | ✅ | `codesaga:events:db` | Redis Stream key for DB update jobs |
| `BULK_MAXLEN_APPROX` | ✅ | `10000` | Max approximate length of the DB stream |
| `BULK_CLAIM_MIN_IDLE_MS` | ✅ | `15000` | Min idle time for DB stream claims |

---

## 📈 Prometheus Metrics

This service exposes a `/metrics` endpoint consumed by Prometheus. The key custom gauge:

| Metric | Type | Description |
|--------|------|-------------|
| `codesaga_ws_active_users` | Gauge | Number of currently connected Socket.IO clients |

KEDA uses this metric to autoscale socket server pods: when `active_users > 10000`, a new pod is spawned.

---

## 🚀 Kubernetes / GitOps Deployment

This project uses a **fully declarative GitOps workflow**:

1. Push to `main` → GitHub Actions builds & pushes Docker image to DockerHub
2. GitHub Actions patches the image tag in `staging-ops` manifest
3. ArgoCD detects the diff and auto-syncs — **zero manual steps**

To explore Kubernetes manifests, KEDA ScaledObjects, Prometheus ServiceMonitors, and ArgoCD Applications:

> 👉 **[staging-ops repo →](https://github.com/jamesnagar11/staging-ops)**

---

<div align="center">

**Built with ❤️ by [James Nagar](https://github.com/jamesnagar11)**  
*Part of the CodeSaga distributed platform — 5 microservices, 1 mission*

</div>
