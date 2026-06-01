# MemGo Slack Bot — Clean Architecture Flow Map

This document is the **single truth source** for the MemGo Slack Bot architecture. It is arranged as one end-to-end flow from boot, to message ingestion, to background enrichment, to embedding refresh, to `/memory` command handling, and finally to the data access layer.

The goal is to keep the structure **clean, non-conflicting, and sequential** so the same file can be used as a reference for implementation and review.

---

## 1) Canonical System Flow

```mermaid
flowchart TD
    A[Server boot] --> B[index.js]
    B --> C[env validation]
    B --> D[PostgreSQL pool]
    B --> E[register listeners]
    B --> F[start awareness worker]
    B --> G[start embedding scheduler]

    E --> H[Slack events]
    H --> I[app_mention]
    H --> J[message events]
    H --> K[/memory command]

    J --> L[message.service.js]
    L --> M[insert raw message]
    L --> N[resolve and cache user]
    L --> O[enqueue awareness job]

    O --> P[BullMQ + Redis]
    P --> Q[awareness.worker.js]
    Q --> R[classifyMessage]
    Q --> S[update message enrichment]
    Q --> T[mark thread dirty]

    G --> U[embedding.scheduler.js]
    U --> V[find dirty threads]
    U --> W[build thread content]
    U --> X[generate embedding]
    U --> Y[upsert thread embedding]

    K --> Z[memory listeners]
    Z --> ZA[ask]
    Z --> ZB[search]
    Z --> ZC[summarize]
    Z --> ZD[decisions]
    Z --> ZE[save thread or channel]

    ZA --> ZF[rag.service.js]
    ZB --> ZG[search.service.js]
    ZC --> ZH[summary.service.js]
    ZD --> ZI[message.repository.js]
    ZE --> ZJ[save.service.js]

    ZF --> ZK[context + membership + embedding + Gemini]
    ZG --> ZK
    ZH --> ZK
    ZI --> ZL[filtered SQL lookup]
    ZJ --> ZM[thread/channel embedding now]
```

---

## 2) Boot Sequence

The application starts in this order:

1. `index.js`
2. `src/config/environment.js`
3. `src/config/database.js`
4. `src/listeners/index.js`
5. `src/workers/startAwarenessWorker.js`
6. `src/schedulers/embedding.scheduler.js`

### Boot responsibilities

- `environment.js` validates required environment variables.
- `database.js` creates the PostgreSQL pool.
- `listeners/index.js` registers all Slack listeners and commands.
- `startAwarenessWorker.js` starts the BullMQ worker daemon.
- `embedding.scheduler.js` starts the 5-minute cron job.

---

## 3) Message Ingestion Flow

This is the main real-time Slack event path.

### 3.1 Entry point

`src/listeners/events/message.js` receives Slack `message` events.

### 3.2 Event routing

The handler follows this order:

1. Ignore bot messages.
2. Handle `message_changed` via `handleMessageEdit()`.
3. Handle `message_deleted` via `handleMessageDelete()`.
4. For normal messages, call `handleIncomingMessage()`.

### 3.3 Important guards

- Direct messages and multi-party DMs are skipped in `handleIncomingMessage()` so private content is not indexed.
- This keeps the memory store focused on workspace channel content.

### 3.4 What `handleIncomingMessage()` does

`src/services/message.service.js` performs:

- `createMessageEntity()` from `src/models/message.model.js`
- `insertMessage()` into PostgreSQL
- `resolveAndCacheUser()` in the background
- `awarenessQueue.add()` for async classification

### 3.5 User caching

`resolveAndCacheUser()` calls Slack `client.users.info()` and stores the display profile with `upsertUser()`.

### 3.6 Result of ingestion

A message is stored immediately, while enrichment happens asynchronously.

---

## 4) Edit and Delete Flow

Message lifecycle handling is part of the same message listener.

### 4.1 Edit

When Slack emits `message_changed`:

- `handleMessageEdit()` runs
- `updateMessageText()` updates the stored text
- `upsertThreadDirty()` marks the parent thread for re-embedding

### 4.2 Delete

When Slack emits `message_deleted`:

- `handleMessageDelete()` runs
- `markMessageDeleted()` soft-deletes the row
- `upsertThreadDirty()` marks the thread dirty again

### 4.3 Why this matters

Any edit or delete can change the final thread meaning, so the embedding must be refreshed later by the scheduler.

---

## 5) Background Awareness Worker Flow

This is the asynchronous enrichment pipeline.

### 5.1 Queue

`src/queues/awareness.queue.js` creates the BullMQ queue on Redis.

### 5.2 Worker

`src/workers/startAwarenessWorker.js` starts a `Worker` listening to the `awareness` queue.

### 5.3 Job execution

`src/workers/awareness.worker.js`:

1. Reads `messageId`
2. Fetches the message from PostgreSQL
3. Calls `classifyMessage()`
4. Updates enrichment fields in `messages`
5. Marks the thread dirty if needed

### 5.4 AI classification

`src/services/awareness.service.js` sends text to Gemini and expects a structured JSON classification result.

### 5.5 Output fields

The worker stores data such as:

- `message_type`
- `importance_score`
- `entities`
- `topic_tags`
- `processed = true`

---

## 6) Thread Embedding Scheduler Flow

This is separate from the awareness worker.

### 6.1 Trigger

`src/schedulers/embedding.scheduler.js` runs every 5 minutes.

### 6.2 What it does

For each dirty thread:

1. Fetch thread messages
2. Fetch user display names
3. Build a clean text block
4. Generate the embedding
5. Save the thread embedding
6. Clear the dirty flag

### 6.3 Why it is separate

- The awareness worker classifies individual messages.
- The embedding scheduler rebuilds thread-level semantic memory.

### 6.4 Thread-level storage

`message.repository.js` stores one embedding per thread, not per message.

---

## 7) `/memory` Command Flow

`src/listeners/commands/memory.js` is the user-facing memory entry point.

### 7.1 Common command behavior

- Calls `ack()` immediately.
- Reads the subcommand.
- Uses shared context and permissions before any sensitive lookup.
- Logs interaction data for later session memory.

### 7.2 `ask`

Flow:

- `getContextForCommand()`
- `resolveAccessibleChannels()`
- `generateEmbedding()` for the question
- `searchThreads()` gated by channel access
- Gemini answer generation
- `logInteraction()`

### 7.3 `search`

Flow:

- `getContextForCommand()`
- `resolveAccessibleChannels()`
- `generateEmbedding()`
- `searchHybrid()`
- `logInteraction()`

### 7.4 `summarize`

Flow:

- `getContextForCommand()`
- `getSummaryMessages()`
- Gemini summary generation
- `logInteraction()`

### 7.5 `decisions`

Flow:

- `getDecisions()`
- formatted result response
- `logInteraction()`

### 7.6 `save`

Flow:

- `saveThread()` for a specific Slack URL
- `saveChannel()` for the current channel window
- both bypass the scheduled embedding wait and force an immediate save

---

## 8) Shared Security, Context, and Permission Layer

These are cross-cutting helpers used across `/memory` actions.

### 8.1 Membership gate

`src/services/membership.service.js`:

- checks whether cached membership is stale
- syncs `client.users.conversations` when needed
- stores accessible channels in PostgreSQL

This prevents the user from searching threads they should not see.

### 8.2 Session context

`src/services/context.service.js`:

- reads recent command interactions
- keeps a 2-hour context window
- writes `interaction_log`
- formats prior interactions for prompts

### 8.3 Logging

All major command flows write audit data through `logInteraction()`.

---

## 9) File Catalog in Execution Order

### 9.1 Root

- `index.js` — boot entry point, starts DB check, listeners, worker, scheduler
- `debug.js` — maintenance script for fixing missing user cache records

### 9.2 Config

- `src/config/environment.js` — validates required env values
- `src/config/database.js` — PostgreSQL pool configuration

### 9.3 Middleware

- `src/middleware/logger.middleware.js` — request logging

### 9.4 Utils

- `src/utils/text.utils.js` — truncation helpers

### 9.5 Models

- `src/models/message.model.js` — transforms Slack payloads into a message entity

### 9.6 Listeners

- `src/listeners/index.js` — registers all listeners
- `src/listeners/events/app-mention.js` — minimal mention response
- `src/listeners/events/message.js` — new/edit/delete routing
- `src/listeners/commands/memory.js` — `/memory` command entry point

### 9.7 Services

- `src/services/message.service.js` — ingestion, edits, deletes, user cache, queue push
- `src/services/awareness.service.js` — Gemini message classification
- `src/services/embedding.service.js` — build thread content and generate embeddings
- `src/services/rag.service.js` — `ask` flow
- `src/services/summary.service.js` — `summarize` flow
- `src/services/search.service.js` — `search` flow
- `src/services/membership.service.js` — accessible channel resolution
- `src/services/save.service.js` — force-save thread or channel
- `src/services/context.service.js` — session context and interaction logs

### 9.8 Queue and worker

- `src/queues/awareness.queue.js` — Redis queue definition
- `src/workers/awareness.worker.js` — job processor
- `src/workers/startAwarenessWorker.js` — worker daemon bootstrap

### 9.9 Scheduler

- `src/schedulers/embedding.scheduler.js` — 5-minute dirty-thread embedding refresh

### 9.10 Repository

- `src/repositories/message.repository.js` — all SQL access and PostgreSQL operations

---

## 10) Repository Responsibilities

`message.repository.js` is the single SQL boundary for the project.

It owns:

- raw message insertion
- edits and deletes
- processed/enrichment updates
- dirty thread tracking
- thread embedding storage
- hybrid search
- accessible channel membership cache
- user cache
- summary queries
- decision queries
- recent channel message queries

This keeps SQL isolated from the rest of the codebase.

---

## 11) External Services

### PostgreSQL / Supabase

Used for:

- messages
- users
- thread embeddings
- membership cache
- interaction logs

### Redis

Used for:

- BullMQ awareness jobs

### Slack Web API

Used for:

- `users.info`
- `users.conversations`
- replying to commands and events

### Gemini

Used for:

- message classification
- embeddings
- RAG answer generation
- summaries
- search response shaping

---

## 12) Clean Architectural Rule Set

1. New Slack content enters through listeners only.
2. Raw persistence happens before AI work.
3. Message classification is async.
4. Thread embeddings are cron-driven.
5. `/memory` commands always check membership and context.
6. All query-like flows log interaction history.
7. PostgreSQL remains the source of truth.
8. Redis is only for queueing.
9. Gemini is only for inference and embedding.
10. Private DMs stay out of the memory index.

---

## 13) What This Document Now Represents

This version keeps the entire project in one consistent flow:

- boot
- event capture
- storage
- async enrichment
- scheduled embeddings
- command execution
- permissions and context
- repository boundaries
- external dependencies

It is meant to stay clean, linear, and conflict-free.
